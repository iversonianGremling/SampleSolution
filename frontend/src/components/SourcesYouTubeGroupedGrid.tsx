import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Heart, ChevronDown, ChevronRight, GripVertical, Scissors } from 'lucide-react'
import { CustomCheckbox } from './CustomCheckbox'
import { createDragPreview } from './DragPreview'
import type { SliceWithTrackExtended, SourceTree } from '../types'
import { getSliceDownloadUrl } from '../api/client'

export type PlayMode = 'normal' | 'one-shot' | 'reproduce-while-clicking'

interface VideoGroup {
  trackId: number
  trackTitle: string
  youtubeId: string
  thumbnailUrl?: string
  slices: SliceWithTrackExtended[]
  sliceCount: number
}

interface SourcesYouTubeGroupedGridProps {
  samples: SliceWithTrackExtended[]
  selectedId: number | null
  selectedIds?: Set<number>
  onSelect: (id: number) => void
  onToggleSelect?: (id: number) => void
  onToggleSelectAll?: () => void
  onToggleFavorite?: (id: number) => void
  onEditTrack?: (trackId: number) => void
  onTagClick?: (tagId: number) => void
  isLoading?: boolean
  playMode?: PlayMode
  loopEnabled?: boolean
  sourceTree?: SourceTree | undefined
}

export function SourcesYouTubeGroupedGrid({
  samples,
  selectedId,
  selectedIds = new Set(),
  onSelect,
  onToggleSelect,
  onToggleSelectAll,
  onToggleFavorite,
  onEditTrack,
  onTagClick,
  isLoading = false,
  playMode = 'normal',
  loopEnabled: _loopEnabled = false,
  sourceTree,
}: SourcesYouTubeGroupedGridProps) {
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const dragPreviewRef = useRef<HTMLElement | null>(null)
  const [expandedVideos, setExpandedVideos] = useState<Set<number>>(new Set())
  const [tagPopupId, setTagPopupId] = useState<number | null>(null)
  const [popupPosition, setPopupPosition] = useState<Record<number, { bottom: number; left: number }>>({})
  const tagTriggerRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stop audio when unmounting
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  // Group samples by video - use sourceTree if available to show all videos
  const videoGroups: VideoGroup[] = (() => {
    if (sourceTree?.youtube) {
      // Create groups from source tree to include videos with 0 samples
      const samplesByTrack = samples.reduce((acc, sample) => {
        if (!acc[sample.trackId]) {
          acc[sample.trackId] = []
        }
        acc[sample.trackId].push(sample)
        return acc
      }, {} as Record<number, SliceWithTrackExtended[]>)

      return sourceTree.youtube.map(video => {
        const videoSamples = samplesByTrack[video.id] || []
        // Try to get track info from first sample if available
        const firstSample = videoSamples[0]
        return {
          trackId: video.id,
          trackTitle: video.title,
          youtubeId: firstSample?.track.youtubeId || '',
          thumbnailUrl: video.thumbnailUrl,
          slices: videoSamples,
          sliceCount: video.sliceCount,
        }
      })
    }

    // Fallback to old behavior if sourceTree is not available
    return Object.values(
      samples.reduce((acc, sample) => {
        const trackId = sample.trackId
        if (!acc[trackId]) {
          acc[trackId] = {
            trackId,
            trackTitle: sample.track.title,
            youtubeId: sample.track.youtubeId,
            thumbnailUrl: `https://i.ytimg.com/vi/${sample.track.youtubeId}/mqdefault.jpg`,
            slices: [],
            sliceCount: 0,
          }
        }
        acc[trackId].slices.push(sample)
        acc[trackId].sliceCount = acc[trackId].slices.length
        return acc
      }, {} as Record<number, VideoGroup>)
    )
  })()

  // Auto-expand all videos on mount
  useEffect(() => {
    setExpandedVideos(new Set(videoGroups.map(v => v.trackId)))
  }, [])

  const formatDuration = (startTime: number, endTime: number) => {
    const duration = endTime - startTime
    if (duration < 60) {
      return `${duration.toFixed(1)}s`
    }
    const mins = Math.floor(duration / 60)
    const secs = Math.floor(duration % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handlePlay = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()

    if (playMode === 'normal') {
      // Normal mode: toggle play/pause
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
    } else if (playMode === 'one-shot') {
      // One-shot mode: always play the whole sample, stop others
      // Stop previous
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
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

  const handleMouseDown = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()

    if (playMode === 'reproduce-while-clicking') {
      // Stop current if playing
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      // Play from the beginning
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

  const handleMouseUp = (e: React.MouseEvent) => {
    e.stopPropagation()

    if (playMode === 'reproduce-while-clicking') {
      // Stop playing when mouse is released
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      setPlayingId(null)
    }
  }

  const handleDragStart = (e: React.DragEvent, sample: SliceWithTrackExtended) => {
    setDraggedId(sample.id)

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
      slice: samplesToDrag.length === 1 ? sample : undefined,
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
    setDraggedId(null)

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

  const handleTagPopupOpen = (sampleId: number) => {
    // Clear any pending close timeout
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }

    // Calculate fixed position for the popup - always upward and to the left
    const triggerElement = tagTriggerRefs.current[sampleId]
    if (triggerElement) {
      const rect = triggerElement.getBoundingClientRect()

      setPopupPosition(prev => ({
        ...prev,
        [sampleId]: {
          bottom: window.innerHeight - rect.top + 2,
          left: rect.right
        }
      }))
    }
    setTagPopupId(sampleId)
  }

  const handleTagPopupClose = () => {
    // Add a small delay before closing to make it easier to move mouse to popup
    closeTimeoutRef.current = setTimeout(() => {
      setTagPopupId(null)
    }, 150)
  }

  const handleTagPopupEnter = (sampleId: number) => {
    // Cancel close if mouse enters popup
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setTagPopupId(sampleId)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        Loading samples...
      </div>
    )
  }

  if (samples.length === 0 && videoGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <p className="text-lg">No samples found</p>
        <p className="text-sm mt-1">Try adjusting your filters or selecting a different source</p>
      </div>
    )
  }

  // Determine if select-all checkbox should be indeterminate
  const selectAllIndeterminate = selectedIds.size > 0 && selectedIds.size < samples.length
  const selectAllChecked = selectedIds.size === samples.length && samples.length > 0

  return (
    <div className="flex flex-col">
      {/* Controls */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        {onToggleSelect && onToggleSelectAll && (
          <>
            <CustomCheckbox
              checked={selectAllChecked}
              indeterminate={selectAllIndeterminate}
              onChange={onToggleSelectAll}
              className="flex-shrink-0"
              title="Select all samples"
            />
            <div className="w-px h-5 bg-surface-border" />
          </>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-slate-400">
          {videoGroups.length} video{videoGroups.length !== 1 ? 's' : ''}{samples.length > 0 && `, ${samples.length} slice${samples.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Video groups */}
      <div className="space-y-4 p-4">
        {videoGroups.map(group => {
          const isExpanded = expandedVideos.has(group.trackId)

          // Calculate selection state for this video's slices
          const videoSliceIds = group.slices.map(s => s.id)
          const selectedInVideo = videoSliceIds.filter(id => selectedIds.has(id)).length
          const allVideoSlicesSelected = selectedInVideo === videoSliceIds.length && videoSliceIds.length > 0
          const someVideoSlicesSelected = selectedInVideo > 0 && selectedInVideo < videoSliceIds.length

          const toggleVideoSelection = () => {
            if (!onToggleSelect) return
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

          const handleVideoCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            e.stopPropagation()
            toggleVideoSelection()
          }

          return (
            <div key={group.trackId} className="bg-surface-raised rounded-lg overflow-hidden">
              {/* Video header */}
              <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 hover:bg-surface-base transition-colors">
                <button
                  onClick={() => {
                    if (group.sliceCount > 0) {
                      toggleVideoExpanded(group.trackId)
                    } else if (onEditTrack) {
                      onEditTrack(group.trackId)
                    }
                  }}
                  className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0"
                >
                  {group.sliceCount > 0 ? (
                    isExpanded ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />
                  ) : (
                    <div className="w-[18px]" />
                  )}

                  {/* YouTube thumbnail */}
                  {group.thumbnailUrl && (
                    <img
                      src={group.thumbnailUrl}
                      alt={group.trackTitle}
                      className="w-16 h-10 sm:w-24 sm:h-14 object-cover rounded flex-shrink-0"
                    />
                  )}

                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-xs sm:text-sm font-medium text-white truncate">{group.trackTitle}</p>
                    <p className={`text-[10px] sm:text-xs mt-0.5 truncate ${group.sliceCount === 0 ? 'text-slate-500' : 'text-slate-400'}`}>
                      {group.sliceCount} slice{group.sliceCount !== 1 ? 's' : ''}
                      {group.sliceCount === 0 && onEditTrack && <span className="ml-1 text-slate-500">(click to cut)</span>}
                    </p>
                  </div>
                </button>

                {/* Open sample cut editor for this video */}
                {onEditTrack && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditTrack(group.trackId)
                    }}
                    className="p-1.5 sm:p-2 flex-shrink-0 text-slate-400 hover:text-white hover:bg-surface-base rounded transition-colors"
                    title="Open sample cut view"
                  >
                    <Scissors size={16} />
                  </button>
                )}

                {/* Select all checkbox for this video */}
                {onToggleSelect && (
                  <CustomCheckbox
                    checked={allVideoSlicesSelected}
                    indeterminate={someVideoSlicesSelected}
                    onChange={handleVideoCheckboxChange}
                    className="flex-shrink-0"
                    title={`Select all slices from ${group.trackTitle}`}
                  />
                )}
              </div>

              {/* Slices grid */}
              {isExpanded && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2 p-3 pt-0">
                  {group.slices.map(sample => {
                    const isSelected = selectedId === sample.id
                    const isChecked = selectedIds.has(sample.id)
                    const isPlaying = playingId === sample.id
                    const isDragging = draggedId === sample.id

                    return (
                      <div
                        key={sample.id}
                        onClick={() => onSelect(sample.id)}
                        draggable
                        onDragStart={(e) => handleDragStart(e, sample)}
                        onDragEnd={handleDragEnd}
                        className={`group relative bg-surface-base rounded-lg overflow-hidden cursor-pointer transition-all ${
                          isSelected
                            ? 'ring-2 ring-accent-primary shadow-lg shadow-accent-primary/20'
                            : isChecked
                            ? 'ring-2 ring-indigo-400/60 shadow-md shadow-indigo-400/10'
                            : 'hover:bg-surface-raised hover:shadow-md'
                        } ${isDragging ? 'opacity-50' : ''}`}
                      >
                        {/* YouTube thumbnail as background */}
                        <div className="aspect-[4/3] relative flex items-center justify-center overflow-hidden">
                          <img
                            src={group.thumbnailUrl}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover opacity-40"
                          />

                          {/* Overlay gradient */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

                          {/* Play button overlay */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (playMode !== 'reproduce-while-clicking') {
                                handlePlay(sample.id, e)
                              }
                            }}
                            onMouseDown={playMode === 'reproduce-while-clicking' ? (e) => handleMouseDown(sample.id, e) : undefined}
                            onMouseUp={playMode === 'reproduce-while-clicking' ? handleMouseUp : undefined}
                            onMouseLeave={playMode === 'reproduce-while-clicking' ? handleMouseUp : undefined}
                            className={`relative z-10 transition-opacity ${
                              isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                            }`}
                          >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                              isPlaying ? 'bg-accent-primary' : 'bg-black/60 hover:bg-black/80'
                            }`}>
                              {isPlaying && playMode === 'normal' ? (
                                <Pause size={14} className="text-white" />
                              ) : (
                                <Play size={14} className="text-white ml-0.5" />
                              )}
                            </div>
                          </button>

                          {/* Checkbox for selection */}
                          {onToggleSelect && (
                            <div
                              className={`absolute top-1 left-1 transition-opacity z-10 ${
                                isChecked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                              }`}
                              onClick={(e) => {
                                e.stopPropagation()
                                onToggleSelect(sample.id)
                              }}
                            >
                              <CustomCheckbox
                                checked={isChecked}
                                onChange={() => {}}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onToggleSelect(sample.id)
                                }}
                              />
                            </div>
                          )}

                          {/* Favorite button */}
                          {onToggleFavorite && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onToggleFavorite(sample.id)
                              }}
                              className={`absolute top-1 right-1 p-1 rounded transition-all z-10 ${
                                sample.favorite
                                  ? 'text-amber-400 bg-amber-400/20'
                                  : 'text-slate-400 opacity-0 group-hover:opacity-100 hover:text-amber-400 hover:bg-amber-400/20'
                              }`}
                            >
                              <Heart size={12} className={sample.favorite ? 'fill-current' : ''} />
                            </button>
                          )}

                          {/* Drag handle */}
                          {!onToggleSelect && (
                            <div className="absolute top-1 left-1 p-1 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab z-10">
                              <GripVertical size={12} />
                            </div>
                          )}

                          {/* Duration badge */}
                          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 text-[10px] font-medium bg-black/80 rounded text-white z-10">
                            {formatDuration(sample.startTime, sample.endTime)}
                          </span>
                        </div>

                        {/* Info */}
                        <div className="p-1.5">
                          <p className="text-xs font-medium text-white truncate" title={sample.name}>
                            {sample.name}
                          </p>

                          {/* Tags preview */}
                          {sample.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {sample.tags.slice(0, 1).map(tag => (
                                <span
                                  key={tag.id}
                                  onClick={(e) => {
                                    if (onTagClick) {
                                      e.stopPropagation()
                                      onTagClick(tag.id)
                                    }
                                  }}
                                  className={`px-1 py-0.5 text-[9px] rounded-full ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                                  style={{
                                    backgroundColor: tag.color + '25',
                                    color: tag.color,
                                  }}
                                  title={onTagClick ? `Filter by ${tag.name}` : tag.name}
                                >
                                  {tag.name}
                                </span>
                              ))}
                              {sample.tags.length > 1 && (
                                <div
                                  ref={(el) => { tagTriggerRefs.current[sample.id] = el }}
                                  className="relative inline-block"
                                  onMouseEnter={() => handleTagPopupOpen(sample.id)}
                                  onMouseLeave={handleTagPopupClose}
                                >
                                  <span className="px-1 py-0.5 text-[9px] text-slate-500 cursor-default">
                                    +{sample.tags.length - 1}
                                  </span>
                                  {tagPopupId === sample.id && popupPosition[sample.id] && (
                                    <div
                                      className="fixed z-50 bg-surface-raised border border-surface-border rounded-lg shadow-lg py-1 px-2 max-w-[200px]"
                                      style={{
                                        bottom: popupPosition[sample.id].bottom !== undefined ? `${popupPosition[sample.id].bottom}px` : undefined,
                                        left: `${popupPosition[sample.id].left}px`,
                                        transform: 'translateX(-100%)'
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseEnter={() => handleTagPopupEnter(sample.id)}
                                      onMouseLeave={handleTagPopupClose}
                                    >
                                      <div className="flex flex-col gap-1">
                                        {sample.tags.slice(1).map((tag) => (
                                          <span
                                            key={tag.id}
                                            onClick={(e) => {
                                              if (onTagClick) {
                                                e.stopPropagation()
                                                onTagClick(tag.id)
                                                setTagPopupId(null)
                                                if (closeTimeoutRef.current) {
                                                  clearTimeout(closeTimeoutRef.current)
                                                  closeTimeoutRef.current = null
                                                }
                                              }
                                            }}
                                            className={`px-1 py-0.5 text-[9px] rounded-full whitespace-nowrap ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                                            style={{
                                              backgroundColor: tag.color + '25',
                                              color: tag.color,
                                            }}
                                            title={onTagClick ? `Filter by ${tag.name}` : tag.name}
                                          >
                                            {tag.name}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
