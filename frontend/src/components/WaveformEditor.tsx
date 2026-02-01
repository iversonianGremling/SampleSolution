import { useState, useEffect } from 'react'
import {
  Play,
  Pause,
  Volume2,
  Repeat,
} from 'lucide-react'
import { useWavesurfer } from '../hooks/useWavesurfer'
import { useSlices, useCreateSlice, useDeleteSlice } from '../hooks/useTracks'
import { getTrackAudioUrl } from '../api/client'
import { SliceList } from './SliceList'
import { WaveformMinimap } from './WaveformMinimap'
import type { Track } from '../types'

interface WaveformEditorProps {
  track: Track
}

interface PendingRegion {
  id: string
  start: number
  end: number
}

export function WaveformEditor({ track }: WaveformEditorProps) {
  const [pendingRegion, setPendingRegion] = useState<PendingRegion | null>(null)
  const [sliceName, setSliceName] = useState('')
  const [showContent, setShowContent] = useState(false)
  const [playingSliceId, setPlayingSliceId] = useState<number | null>(null)
  const [isLoopEnabled, setIsLoopEnabled] = useState(false)

  const { data: slices } = useSlices(track.id)
  const createSlice = useCreateSlice(track.id)
  const deleteSlice = useDeleteSlice(track.id)

  const {
    containerRef,
    minimapRef,
    isPlaying,
    isReady,
    currentTime,
    duration,
    playPause,
    playRegion,
    playRegionLoop,
    updatePlayingRegionBounds,
    pause,
    clearRegions,
    removeRegion,
    viewportStart,
    viewportEnd,
    setViewportRegion,
  } = useWavesurfer({
    audioUrl: getTrackAudioUrl(track.id),
    onRegionCreated: (region: any) => {
      // If there's already a pending region, remove the newly created one
      if (pendingRegion) {
        removeRegion(region.id)
        return
      }
      setPendingRegion({
        id: region.id,
        start: region.start,
        end: region.end,
      })
      setSliceName(`${track.title} - Slice ${(slices?.length || 0) + 1}`)
    },
    onRegionUpdated: (region: any) => {
      if (pendingRegion && region.id === pendingRegion.id) {
        setPendingRegion({
          ...pendingRegion,
          start: region.start,
          end: region.end,
        })
        // Update the playing region bounds if currently playing
        updatePlayingRegionBounds(region.start, region.end, isLoopEnabled)
      }
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

  // Fade in the waveform after a delay once ready
  useEffect(() => {
    if (isReady) {
      const timer = setTimeout(() => {
        setShowContent(true)
      }, 300)
      return () => clearTimeout(timer)
    } else {
      setShowContent(false)
    }
  }, [isReady])

  // Don't load existing slices as regions on the waveform
  // This keeps the waveform clean and focused on creating new slices
  useEffect(() => {
    if (isReady) {
      clearRegions()
    }
  }, [isReady, clearRegions])

  const handleSaveSlice = () => {
    if (pendingRegion && sliceName.trim()) {
      // Immediately remove the pending region from the waveform
      removeRegion(pendingRegion.id)
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
    // Immediately remove the pending region from the waveform
    if (pendingRegion) {
      removeRegion(pendingRegion.id)
    }
    setPendingRegion(null)
    setSliceName('')
    setIsLoopEnabled(false)
  }

  const handleWaveformDoubleClick = () => {
    // Clear pending selection on double-click
    if (pendingRegion) {
      removeRegion(pendingRegion.id)
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
          onSetViewport={setViewportRegion}
        />

        {/* Main Waveform */}
        <div className="relative">
          <div
            ref={containerRef}
            className={`bg-surface-base rounded-lg overflow-x-auto overflow-y-hidden transition-opacity duration-300 ${
              showContent ? 'opacity-100' : 'opacity-0'
            }`}
            onDoubleClick={handleWaveformDoubleClick}
          />
          {/* Loading animation */}
          {!showContent && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-base rounded-lg">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 border-4 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
                <span className="text-sm text-slate-400">Loading waveform...</span>
              </div>
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
            <div className="text-sm text-slate-400">
              {formatTime(currentTime)} / {formatTime(duration)}
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
