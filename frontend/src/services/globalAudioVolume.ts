let globalMasterVolume = 0.9

const activeAudio = new Map<HTMLAudioElement, number>()
const trackedAudioElements = new Set<HTMLAudioElement>()
const trackedBufferSources = new Set<AudioBufferSourceNode>()
const volumeListeners = new Set<(volume: number) => void>()
let isGlobalAudioTrackingInstalled = false

const BUFFER_SOURCE_PATCH_FLAG = '__sampleSolutionPanicStopPatched__'
export const PANIC_STOP_AUDIO_EVENT = 'sample-solution:panic-stop-audio'

const clamp01 = (value: number) => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

const applyVolume = (audio: HTMLAudioElement, baseVolume: number) => {
  audio.volume = clamp01(baseVolume) * globalMasterVolume
}

const trackAudioElement = (audio: HTMLAudioElement) => {
  if (trackedAudioElements.has(audio)) return
  trackedAudioElements.add(audio)

  const cleanup = () => {
    trackedAudioElements.delete(audio)
    audio.removeEventListener('ended', cleanup)
    audio.removeEventListener('error', cleanup)
  }

  audio.addEventListener('ended', cleanup)
  audio.addEventListener('error', cleanup)
}

const trackBufferSource = (source: AudioBufferSourceNode) => {
  if (trackedBufferSources.has(source)) return
  trackedBufferSources.add(source)

  const cleanup = () => {
    trackedBufferSources.delete(source)
    source.removeEventListener('ended', cleanup)
  }

  source.addEventListener('ended', cleanup)
}

const patchAudioContextCreateBufferSource = (ctor: unknown) => {
  if (!ctor || typeof ctor !== 'function') return

  const prototype = (ctor as {
    prototype?: {
      createBufferSource?: (...args: unknown[]) => AudioBufferSourceNode
      [BUFFER_SOURCE_PATCH_FLAG]?: boolean
    }
  }).prototype

  if (!prototype || typeof prototype.createBufferSource !== 'function') return
  if (prototype[BUFFER_SOURCE_PATCH_FLAG]) return

  const originalCreateBufferSource = prototype.createBufferSource
  prototype.createBufferSource = function (...args: unknown[]) {
    const source = originalCreateBufferSource.apply(this, args)
    trackBufferSource(source)
    return source
  }
  prototype[BUFFER_SOURCE_PATCH_FLAG] = true
}

const disablePitchPreservation = (audio: HTMLAudioElement) => {
  const media = audio as HTMLAudioElement & {
    preservesPitch?: boolean
    mozPreservesPitch?: boolean
    webkitPreservesPitch?: boolean
  }

  if (typeof media.preservesPitch === 'boolean') {
    media.preservesPitch = false
  }
  if (typeof media.mozPreservesPitch === 'boolean') {
    media.mozPreservesPitch = false
  }
  if (typeof media.webkitPreservesPitch === 'boolean') {
    media.webkitPreservesPitch = false
  }
}

const stopAudioElement = (audio: HTMLAudioElement) => {
  try {
    audio.pause()
  } catch {
    // no-op
  }
  try {
    audio.currentTime = 0
  } catch {
    // no-op
  }
}

export function ensureGlobalAudioTracking() {
  if (isGlobalAudioTrackingInstalled) return
  if (typeof window === 'undefined') return

  const nativeAudio = window.Audio
  if (typeof nativeAudio === 'function') {
    const trackedAudioConstructor = function (this: HTMLAudioElement, src?: string) {
      const audio = new nativeAudio(src)
      trackAudioElement(audio)
      return audio
    } as unknown as typeof window.Audio

    trackedAudioConstructor.prototype = nativeAudio.prototype

    try {
      window.Audio = trackedAudioConstructor
    } catch {
      // no-op
    }
  }

  patchAudioContextCreateBufferSource(window.AudioContext)

  const webkitWindow = window as Window & { webkitAudioContext?: unknown }
  patchAudioContextCreateBufferSource(webkitWindow.webkitAudioContext)

  isGlobalAudioTrackingInstalled = true
}

export function getGlobalAudioVolume() {
  return globalMasterVolume
}

export function setGlobalAudioVolume(volume: number) {
  globalMasterVolume = clamp01(volume)

  for (const [audio, baseVolume] of activeAudio.entries()) {
    applyVolume(audio, baseVolume)
  }
  for (const listener of volumeListeners) {
    listener(globalMasterVolume)
  }
}

export function subscribeGlobalAudioVolume(listener: (volume: number) => void) {
  volumeListeners.add(listener)
  return () => { volumeListeners.delete(listener) }
}

export function createManagedAudio(
  src: string,
  options?: {
    baseVolume?: number
    loop?: boolean
  }
) {
  const audio = new Audio(src)
  const baseVolume = clamp01(options?.baseVolume ?? 1)

  audio.loop = options?.loop ?? false
  trackAudioElement(audio)
  disablePitchPreservation(audio)
  activeAudio.set(audio, baseVolume)
  applyVolume(audio, baseVolume)

  const cleanup = () => {
    activeAudio.delete(audio)
    audio.removeEventListener('ended', cleanup)
    audio.removeEventListener('error', cleanup)
  }

  audio.addEventListener('ended', cleanup)
  audio.addEventListener('error', cleanup)

  return audio
}

export function releaseManagedAudio(audio: HTMLAudioElement | null) {
  if (!audio) return

  activeAudio.delete(audio)
}

export function panicStopAllAudio() {
  for (const audio of Array.from(activeAudio.keys())) {
    stopAudioElement(audio)
    activeAudio.delete(audio)
  }

  for (const audio of Array.from(trackedAudioElements)) {
    stopAudioElement(audio)
    trackedAudioElements.delete(audio)
  }

  for (const source of Array.from(trackedBufferSources)) {
    try {
      source.stop()
    } catch {
      // no-op
    }
    trackedBufferSources.delete(source)
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PANIC_STOP_AUDIO_EVENT))
  }
}
