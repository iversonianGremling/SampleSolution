import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { getSliceDownloadUrl } from '../api/client'

interface SliceWaveformProps {
  sliceId: number
  sourceUrl?: string
  height?: number
  pitchSemitones?: number
  onReady?: () => void
  onPlay?: () => void
  onPause?: () => void
  onFinish?: () => void
}

export interface SliceWaveformRef {
  play: () => Promise<void>
  pause: () => void
  isPlaying: () => boolean
  getCurrentTime: () => number
  getDuration: () => number
}

export const SliceWaveform = forwardRef<SliceWaveformRef, SliceWaveformProps>(
  ({ sliceId, sourceUrl, height = 80, pitchSemitones = 0, onReady, onPlay, onPause, onFinish }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const wavesurferRef = useRef<WaveSurfer | null>(null)

    // Store callbacks in refs so they're always current without triggering effect re-runs
    const onReadyRef = useRef(onReady)
    const onPlayRef = useRef(onPlay)
    const onPauseRef = useRef(onPause)
    const onFinishRef = useRef(onFinish)
    const pitchSemitonesRef = useRef(pitchSemitones)

    useEffect(() => {
      onReadyRef.current = onReady
      onPlayRef.current = onPlay
      onPauseRef.current = onPause
      onFinishRef.current = onFinish
    }, [onReady, onPlay, onPause, onFinish])

    // Update playback rate when pitchSemitones changes
    useEffect(() => {
      pitchSemitonesRef.current = pitchSemitones
      if (!wavesurferRef.current) return
      const rate = Math.pow(2, pitchSemitones / 12)
      wavesurferRef.current.setPlaybackRate(rate)
    }, [pitchSemitones])

    useImperativeHandle(ref, () => ({
      play: async () => {
        try {
          await wavesurferRef.current?.play()
        } catch (error) {
          console.error('Play failed:', error)
        }
      },
      pause: () => {
        wavesurferRef.current?.pause()
      },
      isPlaying: () => wavesurferRef.current?.isPlaying() || false,
      getCurrentTime: () => wavesurferRef.current?.getCurrentTime() || 0,
      getDuration: () => wavesurferRef.current?.getDuration() || 0,
    }))

    useEffect(() => {
      if (!containerRef.current) return

      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: '#6366f1',
        progressColor: '#818cf8',
        cursorWidth: 2,
        cursorColor: '#fff',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height,
        normalize: true,
        interact: true,
        backend: 'WebAudio',
      })

      wavesurferRef.current = ws

      // Set up event listeners
      ws.on('ready', () => {
        const rate = Math.pow(2, pitchSemitonesRef.current / 12)
        ws.setPlaybackRate(rate)
        onReadyRef.current?.()
      })
      ws.on('play', () => {
        onPlayRef.current?.()
      })
      ws.on('pause', () => {
        onPauseRef.current?.()
      })
      ws.on('finish', () => {
        onFinishRef.current?.()
      })
      ws.on('error', (error) => {
        console.error('WaveSurfer error:', error)
      })

      // Cleanup
      return () => {
        wavesurferRef.current = null
        ws.destroy()
      }
    }, [height])

    useEffect(() => {
      const ws = wavesurferRef.current
      if (!ws) return
      onPauseRef.current?.()
      ws.load(sourceUrl || getSliceDownloadUrl(sliceId))
    }, [sliceId, sourceUrl])

    return (
      <div className="bg-surface-base rounded-lg p-3">
        <div ref={containerRef} />
      </div>
    )
  }
)

SliceWaveform.displayName = 'SliceWaveform'
