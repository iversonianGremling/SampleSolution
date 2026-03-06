import { useRef, useState, useEffect, useCallback } from 'react'
import { logRendererError } from '../utils/rendererLog'
import {
  buildWaveformAccessMessage,
  checkWaveformSourceAccessible,
  drawWaveformBars,
  getWaveformSourceLabel,
} from '../utils/waveformSource'

interface UseCompactWaveformOptions {
  audioUrl: string
  peaksData?: number[]
  onPlayStateChange?: (isPlaying: boolean) => void
}

export function useCompactWaveform({
  audioUrl,
  peaksData,
  onPlayStateChange,
}: UseCompactWaveformOptions) {
  const containerRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const animFrameRef = useRef<number>(0)
  const peaksDataRef = useRef(peaksData)

  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    peaksDataRef.current = peaksData
  }, [peaksData])

  const redrawCanvas = useCallback(() => {
    const canvas = containerRef.current
    const audio = audioRef.current
    if (!canvas || !peaksDataRef.current) return
    drawWaveformBars(canvas, peaksDataRef.current, audio?.currentTime || 0, audio?.duration || 0, {
      waveColor: '#3b82f6',
      progressColor: '#22d3ee',
      cursorColor: '#22d3ee',
    })
  }, [])

  // Canvas sizing via ResizeObserver
  useEffect(() => {
    const canvas = containerRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
      redrawCanvas()
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [redrawCanvas])

  // Redraw when peaks data arrives
  useEffect(() => {
    redrawCanvas()
  }, [peaksData, redrawCanvas])

  // Initialize audio element when audioUrl changes
  useEffect(() => {
    if (!audioUrl) return

    setIsReady(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setError(null)

    // Tear down previous audio element
    const prevAudio = audioRef.current
    if (prevAudio) {
      prevAudio.pause()
      prevAudio.src = ''
    }
    cancelAnimationFrame(animFrameRef.current)

    const audio = new Audio()
    audioRef.current = audio

    let cancelled = false

    void (async () => {
      const check = await checkWaveformSourceAccessible(audioUrl)
      if (cancelled) return

      if (!check.ok) {
        const reason = check.reason ?? 'unknown problem'
        setError(buildWaveformAccessMessage(getWaveformSourceLabel(audioUrl), reason))
        logRendererError('CompactWaveform.preflightFailed', `url=${audioUrl} reason=${reason}`)
        return
      }

      audio.src = audioUrl
      audio.preload = 'metadata'
      audio.load()
    })().catch((loadError) => {
      if (cancelled) return
      const reason = loadError instanceof Error ? loadError.message : String(loadError)
      setError(buildWaveformAccessMessage(getWaveformSourceLabel(audioUrl), reason))
      logRendererError('CompactWaveform.loadFailed', `url=${audioUrl} reason=${reason}`)
    })

    const startLoop = () => {
      const loop = () => {
        if (!peaksDataRef.current) return
        const canvas = containerRef.current
        if (!canvas) return
        drawWaveformBars(canvas, peaksDataRef.current, audio.currentTime, audio.duration || 1, {
          waveColor: '#3b82f6',
          progressColor: '#22d3ee',
          cursorColor: '#22d3ee',
        })
        animFrameRef.current = requestAnimationFrame(loop)
      }
      animFrameRef.current = requestAnimationFrame(loop)
    }

    const stopLoop = () => {
      cancelAnimationFrame(animFrameRef.current)
      redrawCanvas()
    }

    audio.addEventListener('loadedmetadata', () => {
      if (cancelled) return
      setDuration(audio.duration)
      setIsReady(true)
      setError(null)
      redrawCanvas()
    })
    audio.addEventListener('canplay', () => {
      if (cancelled) return
      setIsReady(true)
    })
    audio.addEventListener('error', () => {
      if (cancelled) return
      setError('Failed to load audio')
      setIsReady(false)
    })
    audio.addEventListener('play', () => {
      if (cancelled) return
      setIsPlaying(true)
      onPlayStateChange?.(true)
      startLoop()
    })
    audio.addEventListener('pause', () => {
      if (cancelled) return
      setIsPlaying(false)
      onPlayStateChange?.(false)
      stopLoop()
    })
    audio.addEventListener('ended', () => {
      if (cancelled) return
      setIsPlaying(false)
      onPlayStateChange?.(false)
      stopLoop()
    })
    audio.addEventListener('timeupdate', () => {
      if (cancelled) return
      setCurrentTime(audio.currentTime)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(animFrameRef.current)
      audio.pause()
      audio.src = ''
      audioRef.current = null
    }
  }, [audioUrl, onPlayStateChange, redrawCanvas])

  const play = useCallback(() => {
    audioRef.current?.play()
  }, [])

  const pause = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  const seek = useCallback((time: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = time
    redrawCanvas()
  }, [redrawCanvas])

  return {
    containerRef,
    isReady,
    isPlaying,
    currentTime,
    duration,
    error,
    play,
    pause,
    seek,
  }
}
