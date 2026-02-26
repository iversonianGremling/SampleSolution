import { getSliceDownloadUrl } from '../api/client'
import {
  DEFAULT_LAB_SETTINGS,
  audioBufferToWavArrayBufferAsync,
  renderLabAudioBuffer,
  type LabSettings,
} from './LabAudioEngine'
import type { TunePlaybackMode } from '../utils/tunePlaybackMode'

interface PreparedTunePreviewPlayback {
  url: string
  playbackRate: number
}

interface TunePreviewOptions {
  /**
   * Optional cap for expensive offline rendering. If omitted, mode defaults are used.
   */
  maxRenderSeconds?: number
  /**
   * Keep HQ algorithm for very short clips if needed. Defaults to false for UI responsiveness.
   */
  allowHqPreview?: boolean
  /**
   * Return instant tape-rate fallback while offline render is warming.
   * Keeps UI responsive on first preview hit.
   */
  immediateFallbackToTape?: boolean
  /**
   * If immediate fallback is enabled, wait briefly for rendered audio before
   * falling back to tape. Reduces "first click sounds wrong" perception.
   */
  maxWaitForRenderedMs?: number
  /**
   * Apply formant compensation when using granular/HQ pitch processing.
   */
  preserveFormants?: boolean
}

const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

const semitoneKey = (value: number) => Math.round(value * 1000) / 1000

const decodedBufferCache = new Map<number, Promise<AudioBuffer>>()
const renderedPreviewCache = new Map<string, Promise<string>>()
const renderedPreviewReadyCache = new Map<string, string>()

// Prevent N simultaneous HQ renders from locking the main thread.
let renderQueue: Promise<void> = Promise.resolve()

let decodeContext: AudioContext | null = null

const HQ_PREVIEW_MAX_SECONDS = 3.5
const GRANULAR_PREVIEW_MAX_SECONDS = 6
const MAX_DECODED_CACHE_ENTRIES = 64
const MAX_RENDER_PROMISE_CACHE_ENTRIES = 96
const MAX_RENDER_READY_CACHE_ENTRIES = 96

const getDecodeContext = () => {
  if (!decodeContext) {
    decodeContext = new AudioContext()
  }
  return decodeContext
}

const touchMapEntry = <K, V>(map: Map<K, V>, key: K, value: V) => {
  if (map.has(key)) {
    map.delete(key)
  }
  map.set(key, value)
}

const evictDecodedBufferCacheIfNeeded = () => {
  while (decodedBufferCache.size > MAX_DECODED_CACHE_ENTRIES) {
    const oldest = decodedBufferCache.keys().next().value
    if (oldest === undefined) break
    decodedBufferCache.delete(oldest)
  }
}

const evictRenderPromiseCacheIfNeeded = () => {
  while (renderedPreviewCache.size > MAX_RENDER_PROMISE_CACHE_ENTRIES) {
    const oldest = renderedPreviewCache.keys().next().value
    if (oldest === undefined) break
    renderedPreviewCache.delete(oldest)
  }
}

const evictRenderedReadyCacheIfNeeded = () => {
  while (renderedPreviewReadyCache.size > MAX_RENDER_READY_CACHE_ENTRIES) {
    const oldestKey = renderedPreviewReadyCache.keys().next().value
    if (oldestKey === undefined) break
    const oldestUrl = renderedPreviewReadyCache.get(oldestKey)
    renderedPreviewReadyCache.delete(oldestKey)
    if (oldestUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(oldestUrl)
    }
  }
}

const waitForRenderedWithTimeout = async (
  renderPromise: Promise<string>,
  timeoutMs: number
): Promise<string | null> => {
  const safeTimeout = clamp(timeoutMs, 0, 1000)
  if (safeTimeout <= 0) return null

  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), safeTimeout)
  })

  return Promise.race([renderPromise, timeoutPromise])
}

const createTuneRenderSettings = (
  pitchSemitones: number,
  mode: Exclude<TunePlaybackMode, 'tape'>,
  preserveFormants: boolean
): LabSettings => ({
  ...DEFAULT_LAB_SETTINGS,
  offset: 0,
  pitchSemitones,
  pitchMode: mode,
  preserveFormants,
  tempo: 1,
  velocity: 1,
  outputGain: 1,
  fadeIn: 0,
  fadeOut: 0,
  lowpassEnabled: false,
  highpassEnabled: false,
  peakingEnabled: false,
  delayEnabled: false,
  compressorEnabled: false,
  reverbEnabled: false,
  distortionEnabled: false,
})

const trimAudioBuffer = (source: AudioBuffer, maxSeconds: number): AudioBuffer => {
  const safeSeconds = Math.max(0.1, maxSeconds)
  const maxLength = Math.floor(source.sampleRate * safeSeconds)
  if (source.length <= maxLength) return source

  const trimmed = new AudioBuffer({
    numberOfChannels: source.numberOfChannels,
    length: maxLength,
    sampleRate: source.sampleRate,
  })

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const input = source.getChannelData(channel)
    const output = trimmed.getChannelData(channel)
    output.set(input.subarray(0, maxLength))

    // Tiny fade-out to avoid click at truncation boundary.
    const fadeSamples = Math.min(256, output.length)
    for (let i = 0; i < fadeSamples; i++) {
      const idx = output.length - fadeSamples + i
      const gain = 1 - i / fadeSamples
      output[idx] *= gain
    }
  }

  return trimmed
}

const enqueueRender = <T>(task: () => Promise<T>): Promise<T> => {
  const run = renderQueue.then(task, task)
  renderQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

const getDecodedSampleBuffer = async (sampleId: number, sourceUrl: string) => {
  const cached = decodedBufferCache.get(sampleId)
  if (cached) return cached

  const promise = (async () => {
    const ctx = getDecodeContext()
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    const response = await fetch(sourceUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch sample ${sampleId} (${response.status})`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return ctx.decodeAudioData(arrayBuffer.slice(0))
  })().catch((error) => {
    decodedBufferCache.delete(sampleId)
    throw error
  })

  touchMapEntry(decodedBufferCache, sampleId, promise)
  evictDecodedBufferCacheIfNeeded()
  return promise
}

export const prepareTunePreviewPlayback = async (
  sampleId: number,
  pitchSemitones: number,
  mode: TunePlaybackMode,
  sourceUrl: string = getSliceDownloadUrl(sampleId),
  options: TunePreviewOptions = {}
): Promise<PreparedTunePreviewPlayback> => {
  const safeSemitones = Number.isFinite(pitchSemitones) ? pitchSemitones : 0
  const tapePlaybackRate = clamp(Math.pow(2, safeSemitones / 12), 0.25, 4)

  if (Math.abs(safeSemitones) <= 0.0001) {
    return { url: sourceUrl, playbackRate: 1 }
  }

  if (mode === 'tape') {
    return {
      url: sourceUrl,
      playbackRate: tapePlaybackRate,
    }
  }

  const sourceBuffer = await getDecodedSampleBuffer(sampleId, sourceUrl)
  const defaultMaxSeconds = mode === 'hq' ? HQ_PREVIEW_MAX_SECONDS : GRANULAR_PREVIEW_MAX_SECONDS
  const maxRenderSeconds = clamp(options.maxRenderSeconds ?? defaultMaxSeconds, 0.1, 60)
  const trimmedSource = trimAudioBuffer(sourceBuffer, maxRenderSeconds)

  // HQ is significantly heavier and can freeze interaction during preview generation.
  // For responsive UI previews we default to granular unless explicitly enabled.
  const effectiveMode: Exclude<TunePlaybackMode, 'tape'> =
    mode === 'hq' && !options.allowHqPreview ? 'granular' : mode

  const preserveFormants = Boolean(options.preserveFormants)
  const renderKey = `${sampleId}|${mode}|${effectiveMode}|${maxRenderSeconds}|${semitoneKey(safeSemitones)}|${preserveFormants ? 'formants' : 'raw'}`
  const immediateFallback = options.immediateFallbackToTape ?? true
  const readyRendered = renderedPreviewReadyCache.get(renderKey)
  if (readyRendered) {
    touchMapEntry(renderedPreviewReadyCache, renderKey, readyRendered)
    return { url: readyRendered, playbackRate: 1 }
  }

  const cachedRendered = renderedPreviewCache.get(renderKey)
  if (cachedRendered) {
    if (immediateFallback) {
      const waitedUrl = await waitForRenderedWithTimeout(
        cachedRendered,
        options.maxWaitForRenderedMs ?? 120
      )
      if (waitedUrl) {
        return { url: waitedUrl, playbackRate: 1 }
      }
      return { url: sourceUrl, playbackRate: tapePlaybackRate }
    }
    const url = await cachedRendered
    return { url, playbackRate: 1 }
  }

  const renderPromise = enqueueRender(async () => {
    // Yield once before expensive CPU work to keep input responsive.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const renderedBuffer = await renderLabAudioBuffer(
      trimmedSource,
      createTuneRenderSettings(safeSemitones, effectiveMode, preserveFormants)
    )
    const wavArrayBuffer = await audioBufferToWavArrayBufferAsync(renderedBuffer)
    return URL.createObjectURL(new Blob([wavArrayBuffer], { type: 'audio/wav' }))
  })
    .then((url) => {
      touchMapEntry(renderedPreviewReadyCache, renderKey, url)
      evictRenderedReadyCacheIfNeeded()
      return url
    })
    .catch((error) => {
      renderedPreviewCache.delete(renderKey)
      const readyUrl = renderedPreviewReadyCache.get(renderKey)
      renderedPreviewReadyCache.delete(renderKey)
      if (readyUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(readyUrl)
      }
      throw error
    })

  touchMapEntry(renderedPreviewCache, renderKey, renderPromise)
  evictRenderPromiseCacheIfNeeded()

  if (immediateFallback) {
    const waitedUrl = await waitForRenderedWithTimeout(
      renderPromise,
      options.maxWaitForRenderedMs ?? 120
    )
    if (waitedUrl) {
      return { url: waitedUrl, playbackRate: 1 }
    }

    // Warm the cache in background and play instantly with tape-rate fallback now.
    void renderPromise.catch(() => {
      // no-op: callers already handle future misses
    })
    return { url: sourceUrl, playbackRate: tapePlaybackRate }
  }

  const url = await renderPromise
  return { url, playbackRate: 1 }
}
