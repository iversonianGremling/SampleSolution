import { useRef, useState, useEffect, useCallback } from 'react'
import WaveSurfer from 'wavesurfer.js'

interface UseCompactWaveformOptions {
  audioUrl: string
  onPlayStateChange?: (isPlaying: boolean) => void
}

export function useCompactWaveform({
  audioUrl,
  onPlayStateChange,
}: UseCompactWaveformOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)

  // State
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Initialize WaveSurfer when audioUrl changes
  useEffect(() => {
    if (!containerRef.current || !audioUrl) return

    // Reset state
    setIsReady(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setError(null)

    // Destroy previous instance
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy()
      wavesurferRef.current = null
    }

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#3b82f6',
      progressColor: '#22d3ee',
      cursorColor: '#22d3ee',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 48,
      normalize: true,
      backend: 'WebAudio',
    })

    wavesurferRef.current = ws

    ws.load(audioUrl)

    ws.on('ready', () => {
      setDuration(ws.getDuration())
      setIsReady(true)
      setError(null)
    })

    ws.on('error', () => {
      setError('Failed to load audio')
      setIsReady(false)
    })

    ws.on('play', () => {
      setIsPlaying(true)
      onPlayStateChange?.(true)
    })

    ws.on('pause', () => {
      setIsPlaying(false)
      onPlayStateChange?.(false)
    })

    ws.on('timeupdate', (time) => {
      setCurrentTime(time)
    })

    ws.on('finish', () => {
      setIsPlaying(false)
      onPlayStateChange?.(false)
    })

    return () => {
      ws.destroy()
      wavesurferRef.current = null
    }
  }, [audioUrl, onPlayStateChange])

  const play = useCallback(() => {
    wavesurferRef.current?.play()
  }, [])

  const pause = useCallback(() => {
    wavesurferRef.current?.pause()
  }, [])

  const seek = useCallback(
    (time: number) => {
      if (wavesurferRef.current && duration > 0) {
        wavesurferRef.current.seekTo(time / duration)
      }
    },
    [duration]
  )

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
