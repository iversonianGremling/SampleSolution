import { useState, useRef, useEffect } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { SourcesSampleListRow } from './SourcesSampleListRow'
import { CustomCheckbox } from './CustomCheckbox'
import { createDragPreview } from './DragPreview'
import type { SliceWithTrackExtended } from '../types'
import { getSliceDownloadUrl } from '../api/client'

interface VideoGroup {
  trackId: number
  trackTitle: string
  youtubeId: string
  thumbnailUrl?: string
  slices: SliceWithTrackExtended[]
}

interface SourcesYouTubeGroupedListProps {
  samples: SliceWithTrackExtended[]
  selectedId: number | null
  selectedIds: Set<number>
  onSelect: (id: number) => void
  onToggleSelect: (id: number) => void
  onToggleSelectAll: () => void
  onToggleFavorite: (id: number) => void
  onUpdateName: (id: number, name: string) => void
  onDelete: (id: number) => void
  onTagClick?: (tagId: number) => void
  isLoading?: boolean
}

export function SourcesYouTubeGroupedList({
  samples,
  selectedId,
  selectedIds,
  onSelect,
  onToggleSelect,
  onToggleSelectAll,
  onToggleFavorite,
  onUpdateName,
  onDelete,
  onTagClick,
  isLoading = false,
}: SourcesYouTubeGroupedListProps) {
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const dragPreviewRef = useRef<HTMLElement | null>(null)
  const [expandedVideos, setExpandedVideos] = useState<Set<number>>(new Set())

  // Stop audio when unmounting
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  // Group samples by video
  const videoGroups: VideoGroup[] = Object.values(
    samples.reduce((acc, sample) => {
      const trackId = sample.trackId
      if (!acc[trackId]) {
        acc[trackId] = {
          trackId,
          trackTitle: sample.track.title,
          youtubeId: sample.track.youtubeId,
          thumbnailUrl: `https://i.ytimg.com/vi/${sample.track.youtubeId}/mqdefault.jpg`,
          slices: [],
        }
      }
      acc[trackId].slices.push(sample)
      return acc
    }, {} as Record<number, VideoGroup>)
  )

  // Auto-expand all videos on mount
  useEffect(() => {
    setExpandedVideos(new Set(videoGroups.map(v => v.trackId)))
  }, [])

  const handlePlay = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()

    if (playingId === id) {
      // Stop playing
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      setPlayingId(null)
    } else {
      // Stop previous
      if (audioRef.current) {
        audioRef.current.pause()
      }
      // Play new
      const audio = new Audio(getSliceDownloadUrl(id))
      audio.onended = () => {
        setPlayingId(null)
        audioRef.current = null
      }
      audio.play()
      audioRef.current = audio
      setPlayingId(id)
    }
  }

  const handleDragStart = (sample: SliceWithTrackExtended) => (e: React.DragEvent) => {
    // Determine which samples to drag
    let samplesToDrag: number[]
    if (selectedIds.has(sample.id)) {
      // If the dragged sample is selected, drag all selected samples
      samplesToDrag = Array.from(selectedIds)
    } else {
      // Otherwise, just drag this one sample
      samplesToDrag = [sample.id]
    }

    // Set drag data
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'samples',
      sampleIds: samplesToDrag,
    }))
    e.dataTransfer.effectAllowed = 'copy'

    // Create and set custom drag preview
    const sampleName = samplesToDrag.length === 1 ? sample.name : undefined
    const preview = createDragPreview(samplesToDrag.length, sampleName)
    dragPreviewRef.current = preview

    // Set the drag image synchronously
    try {
      e.dataTransfer.setDragImage(preview, 35, 20)
    } catch (err) {
      console.error('Failed to set drag image:', err)
    }
  }

  const handleDragEnd = () => {
    // Clean up preview element
    if (dragPreviewRef.current && dragPreviewRef.current.parentNode) {
      document.body.removeChild(dragPreviewRef.current)
      dragPreviewRef.current = null
    }
  }

  const toggleVideoExpanded = (trackId: number) => {
    setExpandedVideos(prev => {
      const next = new Set(prev)
      if (next.has(trackId)) {
        next.delete(trackId)
      } else {
        next.add(trackId)
      }
      return next
    })
  }

  // Determine if select-all checkbox should be indeterminate
  const selectAllIndeterminate = selectedIds.size > 0 && selectedIds.size < samples.length
  const selectAllChecked = selectedIds.size === samples.length && samples.length > 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} />
        Loading samples...
      </div>
    )
  }

  if (samples.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <p className="text-lg">No samples found</p>
        <p className="text-sm mt-1">Try adjusting your filters or selecting a different source</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header row */}
      <div className="sticky top-0 bg-surface-raised border-b border-surface-border px-4 py-2 flex-shrink-0 z-10">
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Select all checkbox */}
          <CustomCheckbox
            checked={selectAllChecked}
            indeterminate={selectAllIndeterminate}
            onChange={onToggleSelectAll}
            className="flex-shrink-0"
            title="Select all samples"
          />

          {/* Info */}
          <span className="text-sm text-slate-400">
            {videoGroups.length} video{videoGroups.length !== 1 ? 's' : ''}, {samples.length} slice{samples.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* List items grouped by video */}
      <div className="flex-1 overflow-y-auto">
        {videoGroups.map(group => {
          const isExpanded = expandedVideos.has(group.trackId)

          // Calculate selection state for this video's slices
          const videoSliceIds = group.slices.map(s => s.id)
          const selectedInVideo = videoSliceIds.filter(id => selectedIds.has(id)).length
          const allVideoSlicesSelected = selectedInVideo === videoSliceIds.length && videoSliceIds.length > 0
          const someVideoSlicesSelected = selectedInVideo > 0 && selectedInVideo < videoSliceIds.length

          const handleToggleVideoSelection = (e: React.MouseEvent) => {
            e.stopPropagation()

            if (allVideoSlicesSelected) {
              // Deselect all slices from this video
              videoSliceIds.forEach(id => {
                if (selectedIds.has(id)) {
                  onToggleSelect(id)
                }
              })
            } else {
              // Select all slices from this video
              videoSliceIds.forEach(id => {
                if (!selectedIds.has(id)) {
                  onToggleSelect(id)
                }
              })
            }
          }

          return (
            <div key={group.trackId} className="border-b border-surface-border">
              {/* Video header */}
              <div className="flex items-center gap-3 p-3 bg-surface-raised hover:bg-surface-base transition-colors">
                <button
                  onClick={() => toggleVideoExpanded(group.trackId)}
                  className="flex items-center gap-3 flex-1"
                >
                  {isExpanded ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}

                  {/* YouTube thumbnail */}
                  {group.thumbnailUrl && (
                    <img
                      src={group.thumbnailUrl}
                      alt={group.trackTitle}
                      className="w-24 h-14 object-cover rounded"
                    />
                  )}

                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-white truncate">{group.trackTitle}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{group.slices.length} slice{group.slices.length !== 1 ? 's' : ''}</p>
                  </div>
                </button>

                {/* Select all checkbox for this video */}
                <div onClick={handleToggleVideoSelection}>
                  <CustomCheckbox
                    checked={allVideoSlicesSelected}
                    indeterminate={someVideoSlicesSelected}
                    onChange={() => {}}
                    title={`Select all slices from ${group.trackTitle}`}
                  />
                </div>
              </div>

              {/* Slices list */}
              {isExpanded && (
                <div className="divide-y divide-surface-border bg-surface-base">
                  {group.slices.map((sample) => (
                    <SourcesSampleListRow
                      key={sample.id}
                      sample={sample}
                      isSelected={selectedId === sample.id}
                      isChecked={selectedIds.has(sample.id)}
                      isPlaying={playingId === sample.id}
                      onSelect={() => onSelect(sample.id)}
                      onToggleCheck={() => onToggleSelect(sample.id)}
                      onPlay={(e) => handlePlay(sample.id, e as any)}
                      onToggleFavorite={() => onToggleFavorite(sample.id)}
                      onUpdateName={(name) => onUpdateName(sample.id, name)}
                      onDelete={() => onDelete(sample.id)}
                      onTagClick={onTagClick}
                      onDragStart={handleDragStart(sample)}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
