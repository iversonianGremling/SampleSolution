import { useState, useEffect } from 'react'
import {
  Play,
  Pause,
  Plus,
  Volume2,
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
    addRegion,
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
      }
    },
  })


  // Load existing slices as regions (read-only)
  useEffect(() => {
    if (isReady && slices) {
      clearRegions()
      slices.forEach((slice, index) => {
        const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6']
        const region = addRegion(
          `slice-${slice.id}`,
          slice.startTime,
          slice.endTime,
          colors[index % colors.length] + '40'
        )
        // Make saved slices read-only (not draggable or resizable)
        if (region) {
          region.setOptions({ drag: false, resize: false })
        }
      })
    }
  }, [isReady, slices, addRegion, clearRegions])

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
    }
  }

  const handleCancelSlice = () => {
    // Immediately remove the pending region from the waveform
    if (pendingRegion) {
      removeRegion(pendingRegion.id)
    }
    setPendingRegion(null)
    setSliceName('')
  }

  const handleWaveformDoubleClick = () => {
    // Clear pending selection on double-click
    if (pendingRegion) {
      removeRegion(pendingRegion.id)
      setPendingRegion(null)
      setSliceName('')
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex-shrink-0 bg-gray-800">
        <h2 className="font-semibold text-white truncate">{track.title}</h2>
      </div>

      {/* Waveform Area */}
      <div className="p-4 flex-shrink-0 bg-gray-800">
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
        <div
          ref={containerRef}
          className="bg-gray-900 rounded-lg overflow-x-auto overflow-y-hidden"
          onDoubleClick={handleWaveformDoubleClick}
        />

        {/* Playback Controls */}
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-4">
            <button
              onClick={playPause}
              disabled={!isReady}
              className="p-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 text-white rounded-full transition-colors"
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <div className="text-sm text-gray-400">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>
          <div className="text-sm text-gray-500">
            Drag on waveform to create a slice
          </div>
        </div>
      </div>

      {/* Pending Slice Form */}
      {pendingRegion && (
        <div className="px-4 pb-4 bg-gray-800 border-t border-gray-700 flex-shrink-0">
          <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Plus className="text-yellow-500" size={18} />
              <span className="font-medium text-yellow-500">New Slice</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={sliceName}
                onChange={(e) => setSliceName(e.target.value)}
                placeholder="Slice name..."
                className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
              <span className="text-sm text-gray-400">
                {formatTime(pendingRegion.start)} - {formatTime(pendingRegion.end)}
              </span>
              <button
                onClick={() => playRegion(pendingRegion.start, pendingRegion.end)}
                className="p-2 text-gray-400 hover:text-white transition-colors"
                title="Preview"
              >
                <Volume2 size={18} />
              </button>
              <button
                onClick={handleSaveSlice}
                disabled={!sliceName.trim() || createSlice.isPending}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white rounded transition-colors"
              >
                Save
              </button>
              <button
                onClick={handleCancelSlice}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slices List */}
      <div className="flex-1 overflow-y-auto bg-gray-800 border-t border-gray-700">
        <SliceList
          slices={slices || []}
          trackId={track.id}
          onPlay={(slice) => playRegion(slice.startTime, slice.endTime)}
          onDelete={(slice) => deleteSlice.mutate(slice.id)}
          formatTime={formatTime}
        />
      </div>
    </div>
  )
}
