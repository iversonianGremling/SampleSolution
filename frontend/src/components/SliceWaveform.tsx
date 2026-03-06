import { useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react'
import { getSliceDownloadUrl } from '../api/client'
import { logRendererError } from '../utils/rendererLog'
import { useCustomWaveform } from '../hooks/useCustomWaveform'

interface SliceWaveformProps {
  sliceId: number
  sourceUrl?: string
  height?: number
  pitchSemitones?: number
  /** Kept for API compatibility; the visualizer decodes audio directly. */
  peaksData?: number[]
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
    const didRetryRef = useRef(false)
    const [audioError, setAudioError] = useState<string | null>(null)
    const [isDragging, setIsDragging] = useState(false)

    const {
      canvasRef,
      audioRef,
      isDecoding,
      decodeError,
      isAudioReady,
      handleMouseDown: _handleMouseDown,
      handleMouseMove,
      handleMouseUp: _handleMouseUp,
      handleMouseLeave: _handleMouseLeave,
      handleClick,
      handleAudioPlay,
      handleAudioPause,
      handleAudioEnded,
      handleAudioMetadata,
      play,
      pause,
      getZoom,
    } = useCustomWaveform({
      sliceId,
      sourceUrl,
      pitchSemitones,
      waveColor: '#6366f1',
      progressColor: '#818cf8',
      cursorColor: '#ffffff',
      onReady,
      onPlay,
      onPause,
      onFinish,
    })

    // Wrap mouse handlers to track drag state for cursor styling
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      setIsDragging(true)
      _handleMouseDown(e)
    }, [_handleMouseDown])

    const handleMouseUp = useCallback(() => {
      setIsDragging(false)
      _handleMouseUp()
    }, [_handleMouseUp])

    const handleMouseLeave = useCallback(() => {
      setIsDragging(false)
      _handleMouseLeave()
    }, [_handleMouseLeave])

    useImperativeHandle(ref, () => ({
      play,
      pause,
      isPlaying: () => !!audioRef.current && !audioRef.current.paused,
      getCurrentTime: () => audioRef.current?.currentTime ?? 0,
      getDuration: () => audioRef.current?.duration ?? 0,
    }))

    const handleAudioError = useCallback(() => {
      const audio = audioRef.current
      if (!audio) return
      const downloadUrl = getSliceDownloadUrl(sliceId)
      if (!didRetryRef.current && audio.src !== downloadUrl) {
        didRetryRef.current = true
        logRendererError('SliceWaveform.errorRetry', `slice=${sliceId}`)
        audio.src = downloadUrl
        audio.load()
      } else {
        logRendererError('SliceWaveform.error', `slice=${sliceId}`)
        setAudioError('Audio failed to load')
      }
    }, [sliceId, audioRef])

    // Reset error state on source change
    useEffect(() => {
      didRetryRef.current = false
      setAudioError(null)
    }, [sliceId, sourceUrl])

    const isZoomed = getZoom() > 1
    const cursorStyle = isDragging ? 'grabbing' : isZoomed ? 'grab' : 'pointer'

    return (
      <div className="bg-surface-base rounded-lg p-3">
        {(audioError || decodeError) && (
          <div className="mb-2 rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
            {audioError || decodeError}
          </div>
        )}
        <div className="relative" style={{ height }}>
          {isDecoding && !isAudioReady && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-[10px] text-slate-500">Decoding waveform…</div>
            </div>
          )}
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block', cursor: cursorStyle }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
          />
        </div>
        {/* Hidden audio element for playback */}
        <audio
          ref={audioRef}
          preload="metadata"
          onLoadedMetadata={handleAudioMetadata}
          onPlay={handleAudioPlay}
          onPause={handleAudioPause}
          onEnded={handleAudioEnded}
          onError={handleAudioError}
        />
      </div>
    )
  }
)

SliceWaveform.displayName = 'SliceWaveform'
