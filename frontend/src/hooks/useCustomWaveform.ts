import { useEffect, useRef, useState, useCallback } from 'react'
import { getSliceDownloadUrl } from '../api/client'
import { getApiBaseUrl } from '../utils/api-config'
import { logRendererError, logRendererInfo } from '../utils/rendererLog'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum bars rendered in the visible window at any zoom level */
export const MAX_VISIBLE_BARS = 200

/** Extra bars precomputed on each side (scroll buffer) */
export const OFFSCREEN_BARS = 100

const TOTAL_BARS = MAX_VISIBLE_BARS + 2 * OFFSCREEN_BARS

const MIN_ZOOM = 1.0
const ZOOM_SENSITIVITY = 0.003
const MIN_PLAYBACK_RATE = 0.25
const MAX_PLAYBACK_RATE = 4

/** Duration of the fade-in for bars entering from the scroll edge (ms) */
const EDGE_FADE_MS = 220

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const getPlaybackRate = (pitchSemitones: number, speedMultiplier: number) => {
  const safeSpeedMultiplier = Number.isFinite(speedMultiplier) ? speedMultiplier : 1
  const pitchPlaybackRate = Math.pow(2, pitchSemitones / 12)
  return clamp(pitchPlaybackRate * safeSpeedMultiplier, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE)
}

const setPitchPreservation = (audio: HTMLAudioElement, preservePitch: boolean) => {
  const media = audio as HTMLAudioElement & {
    preservesPitch?: boolean
    mozPreservesPitch?: boolean
    webkitPreservesPitch?: boolean
  }

  if (typeof media.preservesPitch === 'boolean') {
    media.preservesPitch = preservePitch
  }
  if (typeof media.mozPreservesPitch === 'boolean') {
    media.mozPreservesPitch = preservePitch
  }
  if (typeof media.webkitPreservesPitch === 'boolean') {
    media.webkitPreservesPitch = preservePitch
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseCustomWaveformOptions {
  sourceUrl?: string
  sliceId: number
  pitchSemitones?: number
  speedMultiplier?: number
  preservePitch?: boolean
  waveColor?: string
  progressColor?: string
  cursorColor?: string
  barWidth?: number
  barGap?: number
  onReady?: () => void
  onPlay?: () => void
  onPause?: () => void
  onFinish?: () => void
}

interface RenderBuffer {
  tops: Float32Array  // positive peaks  [0, 1]
  bots: Float32Array  // abs of negative peaks  [0, 1]
}

interface PeakData {
  tops: Float32Array  // full-resolution positive peaks from backend
  bots: Float32Array  // full-resolution negative peak magnitudes from backend
}

interface BufferMeta {
  bufferStartSample: number
  samplesPerBar: number
  totalSamples: number
  visibleBarOffset: number
}

interface EdgeFade {
  direction: 'left' | 'right'
  barCount: number   // how many bars entered from that side
  startTime: number
}

// ─── Peak computation ─────────────────────────────────────────────────────────
//
// Two regimes:
//   samplesPerBar >= 1  → find the max positive and min negative value in each
//                         bar's sample range  (standard waveform at low zoom)
//   samplesPerBar <  1  → linearly interpolate between adjacent PCM samples
//                         (individual sample view at extreme zoom)
//
function computeBufferPeaks(
  pcm: Float32Array,
  bufferStartSample: number,
  samplesPerBar: number,
  numBars: number,
): RenderBuffer {
  const tops = new Float32Array(numBars)
  const bots = new Float32Array(numBars)

  if (samplesPerBar >= 1) {
    for (let i = 0; i < numBars; i++) {
      const start = Math.max(0, Math.floor(bufferStartSample + i * samplesPerBar))
      const end   = Math.min(pcm.length, Math.ceil(bufferStartSample + (i + 1) * samplesPerBar))
      let maxPos = 0, minNeg = 0
      for (let j = start; j < end; j++) {
        const v = pcm[j]
        if (v > maxPos) maxPos = v
        else if (v < minNeg) minNeg = v
      }
      tops[i] = maxPos
      bots[i] = -minNeg  // stored as positive
    }
  } else {
    // Zoomed past 1 sample/bar: interpolate for smooth sub-sample rendering
    for (let i = 0; i < numBars; i++) {
      const pos = bufferStartSample + i * samplesPerBar
      if (pos < 0 || pos >= pcm.length) continue
      const lo = Math.floor(pos)
      const hi = Math.min(pcm.length - 1, lo + 1)
      const v = pcm[lo] + (pcm[hi] - pcm[lo]) * (pos - lo)
      if (v > 0) tops[i] = v
      else       bots[i] = -v
    }
  }

  return { tops, bots }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCustomWaveform({
  sourceUrl,
  sliceId,
  pitchSemitones = 0,
  speedMultiplier = 1,
  preservePitch = true,
  waveColor    = '#6366f1',
  progressColor = '#818cf8',
  cursorColor  = '#ffffff',
  barWidth = 2,
  barGap   = 1,
  onReady, onPlay, onPause, onFinish,
}: UseCustomWaveformOptions) {

  // ── DOM ────────────────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioRef  = useRef<HTMLAudioElement  | null>(null)

  // ── Data ───────────────────────────────────────────────────────────────────
  const pcmRef          = useRef<Float32Array | null>(null)   // legacy raw PCM (unused now)
  const peakDataRef     = useRef<PeakData | null>(null)       // bidirectional peaks from backend
  const renderBufferRef = useRef<RenderBuffer>({
    tops: new Float32Array(TOTAL_BARS),
    bots: new Float32Array(TOTAL_BARS),
  })
  const bufferMetaRef = useRef<BufferMeta | null>(null)

  // ── Zoom / scroll (refs so canvas updates bypass React batching) ───────────
  const zoomRef   = useRef(MIN_ZOOM)
  const scrollRef = useRef(0)

  // ── Animation ──────────────────────────────────────────────────────────────
  const mainLoopRef    = useRef(0)
  const isPlayingRef   = useRef(false)   // audio is running
  const isFadingRef    = useRef(false)   // edge fade in progress

  // ── Scroll-edge fade ───────────────────────────────────────────────────────
  const edgeFadeRef = useRef<EdgeFade | null>(null)

  // ── Drag ───────────────────────────────────────────────────────────────────
  const dragRef    = useRef<{ startX: number; startScroll: number } | null>(null)
  const didDragRef = useRef(false)

  // ── Stable prop refs (keeps useCallback deps at []) ────────────────────────
  const waveColorRef    = useRef(waveColor)
  const progressColorRef = useRef(progressColor)
  const cursorColorRef  = useRef(cursorColor)
  const barWidthRef     = useRef(barWidth)
  const barGapRef       = useRef(barGap)
  const onReadyRef  = useRef(onReady)
  const onPlayRef   = useRef(onPlay)
  const onPauseRef  = useRef(onPause)
  const onFinishRef = useRef(onFinish)

  useEffect(() => {
    waveColorRef.current    = waveColor
    progressColorRef.current = progressColor
    cursorColorRef.current  = cursorColor
    barWidthRef.current     = barWidth
    barGapRef.current       = barGap
  }, [waveColor, progressColor, cursorColor, barWidth, barGap])

  useEffect(() => {
    onReadyRef.current  = onReady
    onPlayRef.current   = onPlay
    onPauseRef.current  = onPause
    onFinishRef.current = onFinish
  }, [onReady, onPlay, onPause, onFinish])

  // ── React state (only what needs to drive JSX re-renders) ─────────────────
  const [isDecoding,   setIsDecoding]   = useState(false)
  const [decodeError,  setDecodeError]  = useState<string | null>(null)
  const [isAudioReady, setIsAudioReady] = useState(false)
  const [isPlaying,    setIsPlaying]    = useState(false)
  const [duration,     setDuration]     = useState(0)

  // ─────────────────────────────────────────────────────────────────────────
  // refreshRenderBuffer — recompute tops/bots for the entire TOTAL_BARS window
  // ─────────────────────────────────────────────────────────────────────────
  const refreshRenderBuffer = useCallback(() => {
    // ── Backend bidirectional peaks path ──────────────────────────────────
    const pd = peakDataRef.current
    if (pd) {
      const totalSamples      = pd.tops.length  // treat each backend bar as one "sample"
      const samplesPerBar     = totalSamples / (zoomRef.current * MAX_VISIBLE_BARS)
      const visibleStartSample = scrollRef.current * totalSamples
      const bufferStartSample  = Math.max(0, visibleStartSample - OFFSCREEN_BARS * samplesPerBar)
      const visibleBarOffset   = Math.round((visibleStartSample - bufferStartSample) / samplesPerBar)

      const tops = new Float32Array(TOTAL_BARS)
      const bots = new Float32Array(TOTAL_BARS)

      if (samplesPerBar >= 1) {
        // Downsample: take the max positive and max negative in each bar range
        for (let i = 0; i < TOTAL_BARS; i++) {
          const start = Math.max(0, Math.floor(bufferStartSample + i * samplesPerBar))
          const end   = Math.min(totalSamples, Math.ceil(bufferStartSample + (i + 1) * samplesPerBar))
          let maxTop = 0, maxBot = 0
          for (let j = start; j < end; j++) {
            if (pd.tops[j] > maxTop) maxTop = pd.tops[j]
            if (pd.bots[j] > maxBot) maxBot = pd.bots[j]
          }
          tops[i] = maxTop
          bots[i] = maxBot
        }
      } else {
        // Upsample: interpolate between adjacent bars
        for (let i = 0; i < TOTAL_BARS; i++) {
          const pos = bufferStartSample + i * samplesPerBar
          if (pos < 0 || pos >= totalSamples) continue
          const lo = Math.floor(pos)
          const hi = Math.min(totalSamples - 1, lo + 1)
          const t  = pos - lo
          tops[i] = pd.tops[lo] + (pd.tops[hi] - pd.tops[lo]) * t
          bots[i] = pd.bots[lo] + (pd.bots[hi] - pd.bots[lo]) * t
        }
      }

      renderBufferRef.current = { tops, bots }
      bufferMetaRef.current   = { bufferStartSample, samplesPerBar, totalSamples, visibleBarOffset }
      return
    }

    // ── Fallback: raw PCM path ─────────────────────────────────────────────
    const pcm = pcmRef.current
    if (!pcm) return

    const totalSamples     = pcm.length
    const samplesPerBar    = totalSamples / (zoomRef.current * MAX_VISIBLE_BARS)
    const visibleStartSample = scrollRef.current * totalSamples
    const bufferStartSample  = Math.max(0, visibleStartSample - OFFSCREEN_BARS * samplesPerBar)
    const visibleBarOffset   = Math.round((visibleStartSample - bufferStartSample) / samplesPerBar)

    renderBufferRef.current = computeBufferPeaks(pcm, bufferStartSample, samplesPerBar, TOTAL_BARS)
    bufferMetaRef.current   = { bufferStartSample, samplesPerBar, totalSamples, visibleBarOffset }
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // drawFrame — render the current buffer to canvas as a smooth continuous waveform
  // ─────────────────────────────────────────────────────────────────────────
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current
    const audio  = audioRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width, h = canvas.height
    ctx.clearRect(0, 0, w, h)

    const meta = bufferMetaRef.current
    if (!meta) return

    const { visibleBarOffset } = meta
    const { tops, bots } = renderBufferRef.current
    const centerY = h / 2

    // ── Playhead ──────────────────────────────────────────────────────────
    const dur          = audio?.duration ?? 0
    const timeFraction = dur > 0 ? (audio!.currentTime / dur) : 0
    const visibleFrac  = 1 / zoomRef.current
    const playheadX    = visibleFrac > 0
      ? ((timeFraction - scrollRef.current) / visibleFrac) * w
      : 0

    // Advance edge fade timer (keeps animation loop running; no longer affects alpha)
    const ef = edgeFadeRef.current
    if (ef) {
      const efT = Math.min(1, (performance.now() - ef.startTime) / EDGE_FADE_MS)
      if (efT >= 1) {
        edgeFadeRef.current = null
        isFadingRef.current = false
      }
    }

    // ── Build continuous waveform path ────────────────────────────────────
    // One sample point every ~2 physical pixels for smooth rendering
    const numPts = Math.max(2, Math.min(MAX_VISIBLE_BARS, Math.ceil(w / 2)))

    const topYs = new Float32Array(numPts)
    const botYs = new Float32Array(numPts)
    const xs    = new Float32Array(numPts)

    for (let i = 0; i < numPts; i++) {
      const frac   = i / (numPts - 1)
      const bufIdx = visibleBarOffset + frac * MAX_VISIBLE_BARS
      const lo     = Math.max(0, Math.min(TOTAL_BARS - 2, Math.floor(bufIdx)))
      const hi     = lo + 1
      const t      = bufIdx - lo

      const top = (tops[lo] ?? 0) * (1 - t) + (tops[hi] ?? 0) * t
      const bot = (bots[lo] ?? 0) * (1 - t) + (bots[hi] ?? 0) * t

      xs[i]    = frac * w
      // Ensure a minimum visible height even for silent regions
      topYs[i] = centerY - Math.max(0.01, top) * centerY * 0.95
      botYs[i] = centerY + Math.max(0.01, bot) * centerY * 0.95
    }

    // Build smooth path using midpoint quadratic bezier
    const path = new Path2D()
    path.moveTo(xs[0], topYs[0])
    for (let i = 0; i < numPts - 1; i++) {
      const mx = (xs[i] + xs[i + 1]) / 2
      const my = (topYs[i] + topYs[i + 1]) / 2
      path.quadraticCurveTo(xs[i], topYs[i], mx, my)
    }
    path.lineTo(xs[numPts - 1], topYs[numPts - 1])
    path.lineTo(xs[numPts - 1], botYs[numPts - 1])
    for (let i = numPts - 1; i > 0; i--) {
      const mx = (xs[i] + xs[i - 1]) / 2
      const my = (botYs[i] + botYs[i - 1]) / 2
      path.quadraticCurveTo(xs[i], botYs[i], mx, my)
    }
    path.lineTo(xs[0], botYs[0])
    path.closePath()

    const wc = waveColorRef.current
    const pc = progressColorRef.current

    // ── Draw played region (left of playhead) ─────────────────────────────
    if (playheadX > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, Math.min(playheadX, w), h)
      ctx.clip()
      ctx.fillStyle = pc
      ctx.fill(path)
      ctx.restore()
    }

    // ── Draw unplayed region (right of playhead) ───────────────────────────
    if (playheadX < w) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(Math.max(0, playheadX), 0, w, h)
      ctx.clip()
      ctx.fillStyle = wc
      ctx.fill(path)
      ctx.restore()
    }

    // ── Playhead cursor ───────────────────────────────────────────────────
    if (dur > 0 && playheadX >= 0 && playheadX < w) {
      ctx.fillStyle = cursorColorRef.current
      ctx.fillRect(Math.round(playheadX) - 0.5, 0, 1.5, h)
    }
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // Main animation loop — runs while audio plays or edge fade is active
  // ─────────────────────────────────────────────────────────────────────────
  const startMainLoop = useCallback(() => {
    cancelAnimationFrame(mainLoopRef.current)
    const loop = () => {
      drawFrame()
      if (isPlayingRef.current || isFadingRef.current) {
        mainLoopRef.current = requestAnimationFrame(loop)
      }
    }
    mainLoopRef.current = requestAnimationFrame(loop)
  }, [drawFrame])

  // ── Canvas resize observer ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      canvas.width  = canvas.offsetWidth  * dpr
      canvas.height = canvas.offsetHeight * dpr
      refreshRenderBuffer()
      drawFrame()
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [refreshRenderBuffer, drawFrame])

  // ── Pitch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    setPitchPreservation(audio, preservePitch)
    audio.playbackRate = getPlaybackRate(pitchSemitones, speedMultiplier)
  }, [pitchSemitones, preservePitch, speedMultiplier])

  // ── Audio source ───────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    setPitchPreservation(audio, preservePitch)
    const url = sourceUrl || getSliceDownloadUrl(sliceId)
    audio.pause()
    audio.currentTime = 0
    audio.playbackRate = getPlaybackRate(pitchSemitones, speedMultiplier)
    audio.src = url
    audio.load()
    zoomRef.current   = MIN_ZOOM
    scrollRef.current = 0
    setIsAudioReady(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preservePitch, sliceId, sourceUrl])

  // ── Waveform peaks fetch ────────────────────────────────────────────────────
  //
  // Replaces the old decodeAudioData path. Backend generates bidirectional peaks
  // via ffmpeg, avoiding Chromium's codec stack which crashes the Windows Electron
  // renderer (exit -1073741819, 0xC0000005) on certain audio formats (24-bit AIFF etc).
  //
  useEffect(() => {
    logRendererInfo('useCustomWaveform.peaks', `slice=${sliceId}`)
    setIsDecoding(true)
    setDecodeError(null)
    pcmRef.current        = null
    peakDataRef.current   = null
    bufferMetaRef.current = null
    edgeFadeRef.current   = null
    zoomRef.current       = MIN_ZOOM
    scrollRef.current     = 0

    let cancelled = false

    ;(async () => {
      try {
        const peaksUrl = `${getApiBaseUrl()}/slices/${sliceId}/peaks?n=8000`
        const res = await fetch(peaksUrl, { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { tops: number[]; bots: number[] }
        if (cancelled) return

        if (!Array.isArray(data.tops) || !Array.isArray(data.bots)) {
          throw new Error('Unexpected peaks response format')
        }

        peakDataRef.current = {
          tops: new Float32Array(data.tops),
          bots: new Float32Array(data.bots),
        }

        setIsDecoding(false)
        refreshRenderBuffer()
        drawFrame()
      } catch (err) {
        if (!cancelled) {
          logRendererError('useCustomWaveform.peaks.error', `slice=${sliceId} ${String(err)}`)
          setDecodeError('Waveform load failed')
          setIsDecoding(false)
        }
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceId])

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => () => cancelAnimationFrame(mainLoopRef.current), [])

  // ── Audio element handlers ─────────────────────────────────────────────────

  const handleAudioPlay = useCallback(() => {
    setIsPlaying(true)
    onPlayRef.current?.()
    isPlayingRef.current = true
    startMainLoop()
  }, [startMainLoop])

  const handleAudioPause = useCallback(() => {
    setIsPlaying(false)
    onPauseRef.current?.()
    isPlayingRef.current = false
    drawFrame()
  }, [drawFrame])

  const handleAudioEnded = useCallback(() => {
    setIsPlaying(false)
    onFinishRef.current?.()
    isPlayingRef.current = false
    drawFrame()
  }, [drawFrame])

  const handleAudioMetadata = useCallback(() => {
    setDuration(audioRef.current?.duration ?? 0)
    setIsAudioReady(true)
    onReadyRef.current?.()
    drawFrame()
  }, [drawFrame])

  // ── Wheel zoom ────────────────────────────────────────────────────────────

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!pcmRef.current || !canvas) return

    const rect    = canvas.getBoundingClientRect()
    const cursorX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const factor  = Math.pow(2, -e.deltaY * ZOOM_SENSITIVITY)
    const newZoom = Math.max(MIN_ZOOM, zoomRef.current * factor)

    // Keep the sample under the cursor stationary
    const cursorTimeFrac = scrollRef.current + cursorX / zoomRef.current
    let newScroll = cursorTimeFrac - cursorX / newZoom
    const maxScroll = Math.max(0, 1 - 1 / newZoom)
    newScroll = Math.max(0, Math.min(maxScroll, newScroll))

    zoomRef.current   = newZoom
    scrollRef.current = newScroll
    refreshRenderBuffer()
    drawFrame()
  }, [refreshRenderBuffer, drawFrame])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // ── Drag to pan ───────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    dragRef.current    = { startX: e.clientX, startScroll: scrollRef.current }
    didDragRef.current = false
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return

    const dx = e.clientX - dragRef.current.startX
    if (Math.abs(dx) > 4) didDragRef.current = true

    const rect = canvas.getBoundingClientRect()
    const scrollDelta = -dx / (rect.width * zoomRef.current)
    const maxScroll   = Math.max(0, 1 - 1 / zoomRef.current)
    const prevScroll  = scrollRef.current
    scrollRef.current = Math.max(0, Math.min(maxScroll, dragRef.current.startScroll + scrollDelta))

    // Start an edge fade for bars entering view from the scroll direction
    const moved = scrollRef.current - prevScroll
    if (moved !== 0) {
      const newBars = Math.round(Math.abs(moved) * zoomRef.current * MAX_VISIBLE_BARS)
      if (newBars >= 1) {
        edgeFadeRef.current = {
          direction: moved > 0 ? 'right' : 'left',
          barCount:  Math.min(newBars, MAX_VISIBLE_BARS),
          startTime: performance.now(),
        }
        isFadingRef.current = true
        startMainLoop()
      }
    }

    refreshRenderBuffer()
    drawFrame()
  }, [refreshRenderBuffer, drawFrame, startMainLoop])

  const handleMouseUp    = useCallback(() => { dragRef.current = null }, [])
  const handleMouseLeave = useCallback(() => { dragRef.current = null }, [])

  // ── Click to seek ─────────────────────────────────────────────────────────

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (didDragRef.current) { didDragRef.current = false; return }
    const audio = audioRef.current
    if (!audio?.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const timeFraction = scrollRef.current + clickX / zoomRef.current
    audio.currentTime = Math.max(0, Math.min(audio.duration, timeFraction * audio.duration))
    drawFrame()
  }, [drawFrame])

  // ── Imperative API ────────────────────────────────────────────────────────

  const play = useCallback(async () => {
    try { await audioRef.current?.play() } catch { /* ignored */ }
  }, [])

  const pause = useCallback(() => { audioRef.current?.pause() }, [])

  const resetZoom = useCallback(() => {
    zoomRef.current   = MIN_ZOOM
    scrollRef.current = 0
    refreshRenderBuffer()
    drawFrame()
  }, [refreshRenderBuffer, drawFrame])

  return {
    canvasRef,
    audioRef,
    isDecoding,
    decodeError,
    isAudioReady,
    isPlaying,
    duration,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    handleClick,
    handleAudioPlay,
    handleAudioPause,
    handleAudioEnded,
    handleAudioMetadata,
    play,
    pause,
    resetZoom,
    getZoom: () => zoomRef.current,
  }
}
