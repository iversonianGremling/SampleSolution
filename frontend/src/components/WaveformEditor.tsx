import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Play,
  Pause,
  Volume2,
  Repeat,
  ChevronLeft,
  ChevronRight,
  GripHorizontal,
  X,
} from 'lucide-react'
import { useWavesurfer, type WaveformRegion } from '../hooks/useWavesurfer'
import { useSlices, useCreateSlice, useDeleteSlice } from '../hooks/useTracks'
import { getTrackAudioUrl } from '../api/client'
import { SliceList } from './SliceList'
import { WaveformMinimap } from './WaveformMinimap'
import { drawViewportWaveform } from '../utils/waveformSource'
import type { Track } from '../types'

interface WaveformEditorProps {
  track: Track
}

interface PendingRegion {
  start: number
  end: number
}

export function WaveformEditor({ track }: WaveformEditorProps) {
  const [pendingRegion, setPendingRegion] = useState<PendingRegion | null>(null)
  const [sliceName, setSliceName] = useState('')
  const [playingSliceId, setPlayingSliceId] = useState<number | null>(null)
  const [isLoopEnabled, setIsLoopEnabled] = useState(false)

  const { data: slices } = useSlices(track.id)
  const createSlice = useCreateSlice(track.id)
  const deleteSlice = useDeleteSlice(track.id)

  const waveformCanvasRef = useRef<HTMLCanvasElement>(null)

  // Refs for the rAF loop — avoid stale closures without restarting the loop
  const waveformPeaksRef = useRef<number[]>([])
  const durationRef = useRef(0)
  const viewportStartRef = useRef(0)
  const viewportEndRef = useRef(0)

  const {
    containerRef,
    minimapRef,
    audioElRef,
    isPlaying,
    isReady,
    currentTime,
    duration,
    waveformPeaks,
    playPause,
    seekTo,
    playRegion,
    playRegionLoop,
    pause,
    viewportStart,
    viewportEnd,
    setViewportRegion,
    draftSelection,
    handleZoomviewMouseDown,
    error: waveformError,
  } = useWavesurfer({
    audioUrl: getTrackAudioUrl(track.id),
    trackId: track.id,
    onRegionCreated: (region: WaveformRegion) => {
      // Ignore new drags while a pending region is already being named
      if (pendingRegion) return
      setPendingRegion({
        start: region.start,
        end: region.end,
      })
      setSliceName(`${track.title} - Slice ${(slices?.length || 0) + 1}`)
    },
  })

  // Handle play/pause toggle for a specific slice
  const handleTogglePlaySlice = (slice: any) => {
    if (playingSliceId === slice.id && isPlaying) {
      pause()
      setPlayingSliceId(null)
    } else {
      playRegion(slice.startTime, slice.endTime)
      setPlayingSliceId(slice.id)
    }
  }

  // Handle one-shot play
  const handleOneShotPlay = (slice: any) => {
    playRegion(slice.startTime, slice.endTime)
    setPlayingSliceId(null) // Don't track one-shot plays
  }

  // Reset playing slice when playback stops
  useEffect(() => {
    if (!isPlaying) {
      setPlayingSliceId(null)
    }
  }, [isPlaying])

  // Keep refs in sync with latest state so the rAF loop never captures stale values
  useEffect(() => { waveformPeaksRef.current = waveformPeaks }, [waveformPeaks])
  useEffect(() => { durationRef.current = duration }, [duration])
  useEffect(() => { viewportStartRef.current = viewportStart }, [viewportStart])
  useEffect(() => { viewportEndRef.current = viewportEnd }, [viewportEnd])

  // rAF loop: reads audio.currentTime directly each frame for perfectly smooth playhead.
  // No interpolation needed — the browser updates currentTime continuously.
  useEffect(() => {
    let rafId: number
    const tick = () => {
      const canvas = waveformCanvasRef.current
      const peaks = waveformPeaksRef.current
      const dur = durationRef.current
      const vsStart = viewportStartRef.current
      const vsEnd = viewportEndRef.current
      if (canvas && peaks.length && dur) {
        const displayTime = audioElRef.current?.currentTime ?? 0
        const dpr = window.devicePixelRatio || 1
        const w = Math.round(canvas.clientWidth * dpr)
        const h = Math.round(canvas.clientHeight * dpr)
        if (w && h) {
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w
            canvas.height = h
          }
          drawViewportWaveform(canvas, peaks, dur, vsStart, vsEnd, displayTime, {
            waveColor: '#4f46e5',
            progressColor: '#818cf8',
            cursorColor: '#f59e0b',
          })
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  // Compute the yellow selection overlay in percentage coordinates.
  // During drag: comes directly from mouse-tracked percentages (no time round-trip → no offset).
  // After drag: computed from the saved start/end times + current viewport.
  const selectionOverlay = useMemo(() => {
    if (draftSelection) {
      return { left: `${draftSelection.leftPercent}%`, width: `${draftSelection.widthPercent}%` }
    }
    if (pendingRegion && viewportEnd > viewportStart) {
      const span = viewportEnd - viewportStart
      const leftPct = (pendingRegion.start - viewportStart) / span * 100
      const rightPct = (pendingRegion.end - viewportStart) / span * 100
      const clampedLeft = Math.max(0, leftPct)
      const clampedWidth = Math.max(0, Math.min(100, rightPct) - clampedLeft)
      return { left: `${clampedLeft}%`, width: `${clampedWidth}%` }
    }
    return null
  }, [draftSelection, pendingRegion, viewportStart, viewportEnd])

  const handleSaveSlice = () => {
    if (pendingRegion && sliceName.trim()) {
      createSlice.mutate({
        name: sliceName.trim(),
        startTime: pendingRegion.start,
        endTime: pendingRegion.end,
      })
      setPendingRegion(null)
      setSliceName('')
      setIsLoopEnabled(false)
    }
  }

  const handleCancelSlice = () => {
    setPendingRegion(null)
    setSliceName('')
    setIsLoopEnabled(false)
  }

  const handleRegionHandleDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!pendingRegion || !containerRef.current || !duration) return
    e.preventDefault()
    e.stopPropagation()
    const rect = containerRef.current.getBoundingClientRect()
    if (!rect.width) return

    const capturedStart = pendingRegion.start
    const capturedEnd = pendingRegion.end
    const regionDuration = capturedEnd - capturedStart
    const capturedViewportSpan = viewportEnd - viewportStart
    const startClientX = e.clientX

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaTime = ((moveEvent.clientX - startClientX) / rect.width) * capturedViewportSpan
      let newStart = capturedStart + deltaTime
      let newEnd = capturedEnd + deltaTime
      if (newStart < 0) { newStart = 0; newEnd = regionDuration }
      if (newEnd > duration) { newEnd = duration; newStart = duration - regionDuration }
      setPendingRegion({ start: newStart, end: newEnd })
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [pendingRegion, viewportStart, viewportEnd, duration])

  const handleLeftHandleDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!pendingRegion || !containerRef.current || !duration) return
    e.preventDefault()
    e.stopPropagation()
    const rect = containerRef.current.getBoundingClientRect()
    if (!rect.width) return
    const capturedStart = pendingRegion.start
    const capturedEnd = pendingRegion.end
    const capturedViewportSpan = viewportEnd - viewportStart
    const startClientX = e.clientX
    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaTime = ((moveEvent.clientX - startClientX) / rect.width) * capturedViewportSpan
      const newStart = Math.max(0, Math.min(capturedStart + deltaTime, capturedEnd - 0.05))
      setPendingRegion({ start: newStart, end: capturedEnd })
    }
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [pendingRegion, viewportStart, viewportEnd, duration])

  const handleRightHandleDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!pendingRegion || !containerRef.current || !duration) return
    e.preventDefault()
    e.stopPropagation()
    const rect = containerRef.current.getBoundingClientRect()
    if (!rect.width) return
    const capturedStart = pendingRegion.start
    const capturedEnd = pendingRegion.end
    const capturedViewportSpan = viewportEnd - viewportStart
    const startClientX = e.clientX
    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaTime = ((moveEvent.clientX - startClientX) / rect.width) * capturedViewportSpan
      const newEnd = Math.max(capturedStart + 0.05, Math.min(capturedEnd + deltaTime, duration))
      setPendingRegion({ start: capturedStart, end: newEnd })
    }
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [pendingRegion, viewportStart, viewportEnd, duration])

  const handleWaveformDoubleClick = () => {
    if (pendingRegion) {
      setPendingRegion(null)
      setSliceName('')
      setIsLoopEnabled(false)
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface-base">
      {/* Waveform Area */}
      <div className="p-4 flex-shrink-0 bg-surface-raised">
        {/* Minimap for zoom control */}
        <WaveformMinimap
          minimapRef={minimapRef}
          isReady={isReady}
          viewportStart={viewportStart}
          viewportEnd={viewportEnd}
          duration={duration}
          peaks={waveformPeaks}
          currentTime={currentTime}
          onSetViewport={setViewportRegion}
          onSeek={seekTo}
        />

        {/* Main Waveform */}
        <div className="relative">
          {/* Outer wrapper: clipping + background + opacity transition */}
          <div
            className="relative bg-surface-base rounded-lg overflow-hidden"
            style={{ height: 128 }}
          >
            {/* Custom canvas: waveform bars with viewport-aware downsampling */}
            <canvas ref={waveformCanvasRef} className="absolute inset-0 w-full h-full" />
            {/* peaks.js ZoomView: transparent waveform, renders playhead on top */}
            <div
              ref={containerRef}
              className="absolute inset-0"
              onMouseDown={(e) => { if (!pendingRegion) handleZoomviewMouseDown(e) }}
              onDoubleClick={handleWaveformDoubleClick}
            />
            {/* Yellow selection overlay — pure CSS div so position always matches the mouse exactly */}
            {selectionOverlay && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  left: selectionOverlay.left,
                  width: selectionOverlay.width,
                  backgroundColor: 'rgba(245, 158, 11, 0.35)',
                  borderLeft: '2px solid rgba(245, 158, 11, 0.8)',
                  borderRight: '2px solid rgba(245, 158, 11, 0.8)',
                }}
              >
                {pendingRegion && !draftSelection && (
                  <>
                    {/* Top drag handle — move entire region */}
                    <div
                      className="absolute top-0 left-0 right-0 flex items-center justify-center cursor-grab active:cursor-grabbing"
                      style={{ height: '0.35rem', backgroundColor: 'rgba(245, 158, 11, 0.85)', pointerEvents: 'auto' }}
                      onMouseDown={handleRegionHandleDrag}
                    >
                      <GripHorizontal size={10} className="text-white/90 pointer-events-none" />
                    </div>
                    {/* Left resize handle */}
                    <div
                      className="absolute top-0 bottom-0 left-0 flex items-center justify-center cursor-ew-resize"
                      style={{ width: '0.5rem', backgroundColor: 'rgba(245, 158, 11, 0.08)', pointerEvents: 'auto' }}
                      onMouseDown={handleLeftHandleDrag}
                    >
                      <ChevronRight size={8} className="text-white/90 pointer-events-none" />
                    </div>
                    {/* Right resize handle */}
                    <div
                      className="absolute top-0 bottom-0 right-0 flex items-center justify-center cursor-ew-resize"
                      style={{ width: '0.5rem', backgroundColor: 'rgba(245, 158, 11, 0.08)', pointerEvents: 'auto' }}
                      onMouseDown={handleRightHandleDrag}
                    >
                      <ChevronLeft size={8} className="text-white/90 pointer-events-none" />
                    </div>
                    {/* X dismiss button — top-right corner */}
                    <button
                      className="absolute flex items-center justify-center rounded-full bg-amber-500/70 hover:bg-amber-400 text-white transition-colors"
                      style={{ top: '0.25rem', right: '0.25rem', width: '1.1rem', height: '1.1rem', pointerEvents: 'auto', zIndex: 10 }}
                      onClick={handleCancelSlice}
                    >
                      <X size={9} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          {/* Loading animation */}
          {!isReady && !waveformError && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-base rounded-lg">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 border-4 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
                <span className="text-sm text-slate-400">Loading waveform...</span>
              </div>
            </div>
          )}
          {waveformError && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-base/95 rounded-lg px-4">
              <span className="text-sm text-amber-300 text-center">{waveformError}</span>
            </div>
          )}
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-4">
            <button
              onClick={playPause}
              disabled={!isReady}
              className="w-12 h-12 rounded-full bg-accent-primary flex items-center justify-center text-white hover:bg-accent-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
            </button>
            <div className="flex items-center gap-3">
              <div className="text-sm text-slate-400">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>
          </div>
          <div className="text-sm text-slate-500">
            Drag on waveform to create a slice
          </div>
        </div>
      </div>

      {/* Pending Slice Form */}
      {pendingRegion && (
        <div className="px-4 pb-4 bg-surface-raised border-surface-border flex-shrink-0">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={sliceName}
                onChange={(e) => setSliceName(e.target.value)}
                placeholder="Slice name..."
                className="flex-1 px-3 py-2 bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
              />
              <span className="text-sm text-slate-400">
                {formatTime(pendingRegion.start)} - {formatTime(pendingRegion.end)}
              </span>
              <button
                onClick={() => {
                  if (isPlaying) {
                    pause()
                  } else {
                    playRegionLoop(pendingRegion.start, pendingRegion.end, isLoopEnabled)
                  }
                }}
                className="p-2 text-slate-400 hover:text-white hover:bg-surface-base rounded-lg transition-colors"
                title={isPlaying ? 'Stop' : 'Preview'}
              >
                <Volume2 size={18} />
              </button>
              <button
                onClick={() => {
                  const newLoopState = !isLoopEnabled
                  setIsLoopEnabled(newLoopState)
                  // If disabling loop while playing, stop playback
                  if (!newLoopState && isPlaying) {
                    pause()
                  }
                }}
                className={`p-2 rounded-lg transition-colors ${
                  isLoopEnabled
                    ? 'text-accent-primary bg-accent-primary/20 hover:bg-accent-primary/30'
                    : 'text-slate-400 hover:text-white hover:bg-surface-base'
                }`}
                title={isLoopEnabled ? 'Loop enabled' : 'Loop disabled'}
              >
                <Repeat size={18} />
              </button>
              <button
                onClick={handleSaveSlice}
                disabled={!sliceName.trim() || createSlice.isPending}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-surface-base disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Save
              </button>
              <button
                onClick={handleCancelSlice}
                className="px-4 py-2 bg-surface-base hover:bg-slate-700 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slices List */}
      <div className="flex-1 overflow-y-auto bg-surface-base border-t border-surface-border">
        <SliceList
          slices={slices || []}
          trackId={track.id}
          playingSliceId={playingSliceId}
          onTogglePlay={handleTogglePlaySlice}
          onOneShotPlay={handleOneShotPlay}
          onDelete={(slice) => deleteSlice.mutate(slice.id)}
          formatTime={formatTime}
        />
      </div>
    </div>
  )
}
