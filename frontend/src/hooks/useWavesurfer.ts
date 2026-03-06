import { useEffect, useRef, useState, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { logRendererError } from '../utils/rendererLog'
import {
  buildWaveformAccessMessage,
  checkWaveformSourceAccessible,
  getWaveformSourceLabel,
} from '../utils/waveformSource'
import { getTrackPeaks } from '../api/client'
// peaks.js removed — all rendering is handled by the custom canvas in WaveformEditor.
// Transport and events are wired directly to a plain <audio> element, which avoids
// the peaks.js init crash on Windows Electron (contextIsolation:true).

// Base resolution fetched on load. When zoomed in enough to require more detail,
// a higher-resolution fetch is triggered (up to MAX_PEAKS_RESOLUTION).
const BASE_PEAKS_RESOLUTION = 4000
const MAX_PEAKS_RESOLUTION = 200000
// Only upgrade resolution when the viewport covers less than this fraction of
// the full track duration (zoomed in past ~10%).
const ZOOM_UPGRADE_THRESHOLD = 0.50
// Debounce zoom-triggered re-fetches to avoid spamming the backend.
const ZOOM_FETCH_DEBOUNCE_MS = 400

export interface WaveformRegion {
  id: string
  start: number
  end: number
}

interface UseWavesurferOptions {
  audioUrl: string
  trackId: number
  onRegionCreated?: (region: WaveformRegion) => void
  onRegionUpdated?: (region: WaveformRegion) => void
}

export function useWavesurfer({
  audioUrl,
  trackId,
  onRegionCreated,
}: UseWavesurferOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLDivElement>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const playingRegionBoundsRef = useRef<{ start: number; end: number; loop: boolean } | null>(null)

  const onRegionCreatedRef = useRef(onRegionCreated)
  useEffect(() => { onRegionCreatedRef.current = onRegionCreated }, [onRegionCreated])

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isReady, setIsReady] = useState(false)
  const [viewportStart, setViewportStart] = useState(0)
  const [viewportEnd, setViewportEnd] = useState(0)
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([])
  const [draftSelection, setDraftSelection] = useState<{ leftPercent: number; widthPercent: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Capture viewport in a ref so the mousedown handler never goes stale
  const viewportStartRef = useRef(0)
  const viewportEndRef = useRef(0)
  useEffect(() => { viewportStartRef.current = viewportStart }, [viewportStart])
  useEffect(() => { viewportEndRef.current = viewportEnd }, [viewportEnd])

  // Track the currently-fetched peaks resolution so we don't re-fetch unnecessarily.
  const currentPeaksResolutionRef = useRef(0)

  // When zoomed in past ZOOM_UPGRADE_THRESHOLD, fetch higher-resolution peaks so
  // bars show real detail rather than repeating the same handful of base values.
  useEffect(() => {
    if (!duration || !trackId) return
    const viewportDuration = viewportEnd - viewportStart
    if (viewportDuration <= 0) return

    const zoomFraction = viewportDuration / duration

    // Calculate how many peaks we need so the visible portion has ~BASE_PEAKS_RESOLUTION bars.
    const needed = zoomFraction < ZOOM_UPGRADE_THRESHOLD
      ? Math.min(MAX_PEAKS_RESOLUTION, Math.ceil(BASE_PEAKS_RESOLUTION / zoomFraction))
      : BASE_PEAKS_RESOLUTION

    // Don't re-fetch if the current resolution is already sufficient (within 20%).
    // Also skip if we haven't finished the initial load yet (resolution = 0 means
    // the initial fetch in the audio setup effect will handle it).
    if (currentPeaksResolutionRef.current === 0) return
    if (needed <= currentPeaksResolutionRef.current * 1.2) return

    const timer = setTimeout(async () => {
      try {
        const peaks = await getTrackPeaks(trackId, needed)
        if (peaks?.length) {
          currentPeaksResolutionRef.current = peaks.length
          setWaveformPeaks(peaks)
        }
      } catch {
        // Non-fatal — keep using existing peaks
      }
    }, ZOOM_FETCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [viewportStart, viewportEnd, duration, trackId])

  useEffect(() => {
    if (!audioUrl) return

    setError(null)
    setIsReady(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setViewportStart(0)
    setViewportEnd(0)
    currentPeaksResolutionRef.current = 0

    let cancelled = false
    let boundaryIntervalId = 0

    void (async () => {
      // 1. Preflight — verify the audio URL is reachable before touching the DOM
      const check = await checkWaveformSourceAccessible(audioUrl)
      if (cancelled) return
      if (!check.ok) {
        const reason = check.reason ?? 'unknown problem'
        setError(buildWaveformAccessMessage(getWaveformSourceLabel(audioUrl), reason))
        logRendererError('useWavesurfer.preflightFailed', `url=${audioUrl} reason=${reason}`)
        return
      }

      // Fetch backend-generated peaks (ffmpeg PCM analysis — safe on Windows Electron,
      // no AudioContext.decodeAudioData involved, see electron/electron#42271).
      try {
        const rawPeaks = await getTrackPeaks(trackId)
        if (cancelled) return
        if (rawPeaks?.length) {
          currentPeaksResolutionRef.current = rawPeaks.length
          setWaveformPeaks(rawPeaks)
        }
      } catch {
        // Non-fatal — waveform renders flat if peaks are unavailable
      }

      if (cancelled) return

      // 2. Create audio element. Appending to document.body ensures playback works across
      //    all browsers and Electron (a detached element may be paused by the browser GC).
      const audioEl = document.createElement('audio')
      audioEl.src = audioUrl
      audioEl.preload = 'metadata'
      audioEl.style.display = 'none'
      document.body.appendChild(audioEl)
      audioElRef.current = audioEl

      // 3. Wait for metadata (duration). The preflight probe above already hit the URL,
      //    so the browser typically serves it from cache — this resolves near-instantly.
      const audioDuration = await new Promise<number>((resolve) => {
        if (audioEl.readyState >= 1 && audioEl.duration > 0) {
          resolve(audioEl.duration)
          return
        }
        const timeout = setTimeout(() => resolve(0), 5000)
        const onMeta = () => { clearTimeout(timeout); resolve(audioEl.duration || 0) }
        const onErr  = () => { clearTimeout(timeout); resolve(0) }
        audioEl.addEventListener('loadedmetadata', onMeta, { once: true })
        audioEl.addEventListener('error', onErr, { once: true })
      })

      if (cancelled) return

      const initViewport = (dur: number) => {
        if (dur <= 0 || cancelled) return
        setDuration(dur)
        setViewportStart(0)
        setViewportEnd(dur)
        setIsReady(true)
      }

      // 4. Wire playback events directly to the audio element
      audioEl.addEventListener('play', () => {
        if (cancelled) return
        setIsPlaying(true)
      })
      audioEl.addEventListener('pause', () => {
        if (cancelled) return
        setIsPlaying(false)
      })
      audioEl.addEventListener('ended', () => {
        if (cancelled) return
        setIsPlaying(false)
        playingRegionBoundsRef.current = null
      })
      audioEl.addEventListener('seeked', () => {
        if (cancelled) return
        setCurrentTime(audioEl.currentTime)
      })

      // Region boundary check via 1ms setInterval — tighter than rAF (~16ms) and far
      // tighter than timeupdate (~250ms), enabling sub-millisecond loop accuracy.
      boundaryIntervalId = window.setInterval(() => {
        if (cancelled) return
        const bounds = playingRegionBoundsRef.current
        if (bounds && !audioEl.paused && audioEl.currentTime >= bounds.end) {
          if (bounds.loop) {
            audioEl.currentTime = bounds.start
          } else {
            audioEl.pause()
            playingRegionBoundsRef.current = null
          }
        }
      }, 1)

      if (audioDuration > 0) {
        initViewport(audioDuration)
      } else {
        audioEl.addEventListener('loadedmetadata', () => initViewport(audioEl.duration), { once: true })
        audioEl.addEventListener('canplay', () => {
          if (audioEl.duration > 0) initViewport(audioEl.duration)
        }, { once: true })
      }
    })().catch((initError) => {
      if (cancelled) return
      const reason = initError instanceof Error ? initError.message : String(initError)
      setError(buildWaveformAccessMessage(getWaveformSourceLabel(audioUrl), reason))
      logRendererError('useWavesurfer.asyncFailed', `url=${audioUrl} reason=${reason}`)
    })

    return () => {
      cancelled = true
      if (boundaryIntervalId) clearInterval(boundaryIntervalId)
      const audioEl = audioElRef.current
      if (audioEl) {
        audioEl.pause()
        audioEl.src = ''
        audioEl.remove()
        audioElRef.current = null
      }
      playingRegionBoundsRef.current = null
    }
  }, [audioUrl])

  const setViewportRegion = useCallback((start: number, end: number) => {
    const dur = duration
    if (!dur) return
    const finalStart = Math.max(0, Math.min(start, dur))
    const finalEnd = Math.max(finalStart + 0.01, Math.min(end, dur))
    flushSync(() => {
      setViewportStart(finalStart)
      setViewportEnd(finalEnd)
    })
  }, [duration])

  // Playback controls
  const play = useCallback(() => { audioElRef.current?.play() }, [])

  const pause = useCallback(() => {
    audioElRef.current?.pause()
    playingRegionBoundsRef.current = null
  }, [])

  const playPause = useCallback(() => {
    const audio = audioElRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play()
    } else {
      audio.pause()
    }
  }, [])

  const seekTo = useCallback((time: number) => {
    const audio = audioElRef.current
    if (!audio) return
    audio.currentTime = time
  }, [])

  const playRegion = useCallback((start: number, end: number) => {
    const audio = audioElRef.current
    if (!audio) return
    playingRegionBoundsRef.current = { start, end, loop: false }
    audio.currentTime = start
    audio.play()
  }, [])

  const playRegionLoop = useCallback((start: number, end: number, loop: boolean) => {
    const audio = audioElRef.current
    if (!audio) return
    playingRegionBoundsRef.current = { start, end, loop }
    audio.currentTime = start
    audio.play()
  }, [])

  const updatePlayingRegionBounds = useCallback((start: number, end: number, loop: boolean) => {
    if (playingRegionBoundsRef.current) {
      playingRegionBoundsRef.current = { start, end, loop }
    }
  }, [])

  // Region stubs — kept for API compatibility with WaveformEditor
  const addRegion = useCallback((_id: string, _start: number, _end: number, _color?: string): WaveformRegion | undefined => undefined, [])
  const clearRegions = useCallback(() => {}, [])
  const removeRegion = useCallback((_id: string) => {}, [])
  const getRegions = useCallback((): WaveformRegion[] => [], [])

  // Drag-to-create slice region on the zoomview canvas div.
  // Tracks position as percentages so the CSS overlay always matches the mouse exactly.
  const handleZoomviewMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current
    const dur = duration
    if (!container || !dur) return
    if (e.button !== 0) return

    const rect = container.getBoundingClientRect()
    if (!rect.width) return

    const vsStart = viewportStartRef.current
    const zoomSeconds = viewportEndRef.current - vsStart

    const toPercent = (clientX: number) =>
      Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))

    const startXPercent = toPercent(e.clientX)
    const startTime = vsStart + (startXPercent / 100) * zoomSeconds

    let hasDragged = false

    const onMouseMove = (moveEvent: MouseEvent) => {
      const currentXPercent = toPercent(moveEvent.clientX)
      const leftPercent = Math.min(startXPercent, currentXPercent)
      const widthPercent = Math.abs(currentXPercent - startXPercent)
      if (widthPercent < 0.5) return
      hasDragged = true
      flushSync(() => setDraftSelection({ leftPercent, widthPercent }))
    }

    const onMouseUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      setDraftSelection(null)
      if (!hasDragged) return
      const endTime = vsStart + (toPercent(upEvent.clientX) / 100) * zoomSeconds
      const segStart = Math.min(startTime, endTime)
      const segEnd = Math.max(startTime, endTime)
      if (segEnd - segStart < 0.001) return
      onRegionCreatedRef.current?.({ id: `region-${Date.now()}`, start: segStart, end: segEnd })
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [duration])

  return {
    containerRef,
    minimapRef,
    audioElRef,
    isPlaying,
    isReady,
    currentTime,
    duration,
    waveformPeaks,
    play,
    pause,
    playPause,
    seekTo,
    playRegion,
    playRegionLoop,
    updatePlayingRegionBounds,
    addRegion,
    clearRegions,
    removeRegion,
    getRegions,
    viewportStart,
    viewportEnd,
    setViewportRegion,
    draftSelection,
    handleZoomviewMouseDown,
    error,
  }
}
