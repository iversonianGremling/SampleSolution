import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { getSliceDownloadUrl } from '../api/client'

interface SliceWaveformProps {
  sliceId: number
  height?: number
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
  ({ sliceId, height = 80, onReady, onPlay, onPause, onFinish }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const wavesurferRef = useRef<WaveSurfer | null>(null)

    // Store callbacks in refs so they're always current without triggering effect re-runs
    const onReadyRef = useRef(onReady)
    const onPlayRef = useRef(onPlay)
    const onPauseRef = useRef(onPause)
    const onFinishRef = useRef(onFinish)

    useEffect(() => {
      onReadyRef.current = onReady
      onPlayRef.current = onPlay
      onPauseRef.current = onPause
      onFinishRef.current = onFinish
    }, [onReady, onPlay, onPause, onFinish])

    useImperativeHandle(ref, () => ({
      play: async () => {
        console.log('play() called, wavesurfer exists:', !!wavesurferRef.current)
        try {
          await wavesurferRef.current?.play()
          console.log('play() completed')
        } catch (error) {
          console.error('Play failed:', error)
        }
      },
      pause: () => {
        console.log('pause() called, wavesurfer exists:', !!wavesurferRef.current, 'isPlaying:', wavesurferRef.current?.isPlaying())
        wavesurferRef.current?.pause()
        console.log('pause() completed')
      },
      isPlaying: () => wavesurferRef.current?.isPlaying() || false,
      getCurrentTime: () => wavesurferRef.current?.getCurrentTime() || 0,
      getDuration: () => wavesurferRef.current?.getDuration() || 0,
    }))

    useEffect(() => {
      if (!containerRef.current) return

      // Create WaveSurfer instance
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
        console.log('WaveSurfer ready')
        onReadyRef.current?.()
      })
      ws.on('play', () => {
        console.log('WaveSurfer play event')
        onPlayRef.current?.()
      })
      ws.on('pause', () => {
        console.log('WaveSurfer pause event')
        onPauseRef.current?.()
      })
      ws.on('finish', () => {
        console.log('WaveSurfer finish event')
        onFinishRef.current?.()
      })
      ws.on('error', (error) => {
        console.error('WaveSurfer error:', error)
      })

      // Load audio
      ws.load(getSliceDownloadUrl(sliceId))

      // Cleanup
      return () => {
        ws.destroy()
      }
    }, [sliceId, height])

    return (
      <div className="bg-surface-base rounded-lg p-3">
        <div ref={containerRef} />
      </div>
    )
  }
)

SliceWaveform.displayName = 'SliceWaveform'
