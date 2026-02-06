import { useState, useRef, useEffect, useMemo } from 'react'
import { Play, Pause, Heart, GripVertical, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { CustomCheckbox } from './CustomCheckbox'
import { createDragPreview } from './DragPreview'
import { InstrumentIcon } from './InstrumentIcon'
import type { SliceWithTrackExtended } from '../types'
import { getSliceDownloadUrl } from '../api/client'

type SortField = 'name' | 'duration'
type SortOrder = 'asc' | 'desc'
export type PlayMode = 'normal' | 'one-shot' | 'reproduce-while-clicking'

interface SourcesSampleGridProps {
  samples: SliceWithTrackExtended[]
  selectedId: number | null
  selectedIds?: Set<number>
  onSelect: (id: number) => void
  onToggleSelect?: (id: number) => void
  onToggleSelectAll?: () => void
  onToggleFavorite?: (id: number) => void
  onTagClick?: (tagId: number) => void
  isLoading?: boolean
  playMode?: PlayMode
  loopEnabled?: boolean
  scaleDegreeGroups?: Map<string, SliceWithTrackExtended[]> | null
}

export function SourcesSampleGrid({
  samples,
  selectedId,
  selectedIds = new Set(),
  onSelect,
  onToggleSelect,
  onToggleSelectAll,
  onToggleFavorite,
  onTagClick,
  isLoading = false,
  playMode = 'normal',
  loopEnabled = false,
  scaleDegreeGroups = null,
}: SourcesSampleGridProps) {
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [tagPopupId, setTagPopupId] = useState<number | null>(null)
  const [popupPosition, setPopupPosition] = useState<Record<number, { bottom: number; left: number }>>({})
  const dragPreviewRef = useRef<HTMLElement | null>(null)
  const tagTriggerRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const closeTimeoutRef = useRef<number | null>(null)

  // Stop audio when unmounting
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
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

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      // Toggle order if same field
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      // Set new field with ascending order
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const sortedSamples = useMemo(() => {
    if (!sortField) return samples

    return [...samples].sort((a, b) => {
      let compareValue = 0

      if (sortField === 'name') {
        compareValue = a.name.localeCompare(b.name)
      } else if (sortField === 'duration') {
        const durationA = a.endTime - a.startTime
        const durationB = b.endTime - b.startTime
        compareValue = durationA - durationB
      }

      return sortOrder === 'asc' ? compareValue : -compareValue
    })
  }, [samples, sortField, sortOrder])

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
        audio.loop = loopEnabled
        audio.onended = () => {
          setPlayingId(null)
          audioRef.current = null
        }
        audio.play()
        audioRef.current = audio
        setPlayingId(id)
      }
    } else if (playMode === 'one-shot') {
      // One-shot mode: always play the whole sample, stop others (loop disabled)
      // Stop previous
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      // Play new
      const audio = new Audio(getSliceDownloadUrl(id))
      audio.loop = false
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
      audio.loop = loopEnabled
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

  if (samples.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <p className="text-lg">No samples found</p>
        <p className="text-sm mt-1">Try adjusting your filters or selecting a different source</p>
      </div>
    )
  }

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown size={14} className="ml-1" />
    }
    return sortOrder === 'asc' ? <ArrowUp size={14} className="ml-1" /> : <ArrowDown size={14} className="ml-1" />
  }

  // Determine if select-all checkbox should be indeterminate
  const selectAllIndeterminate = selectedIds.size > 0 && selectedIds.size < sortedSamples.length
  const selectAllChecked = selectedIds.size === sortedSamples.length && sortedSamples.length > 0

  const renderSampleCard = (sample: SliceWithTrackExtended) => {
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
            className={`group relative bg-surface-raised rounded-lg overflow-hidden cursor-pointer transition-all ${
              isSelected
                ? 'ring-2 ring-accent-primary shadow-lg shadow-accent-primary/20'
                : isChecked
                ? 'ring-2 ring-indigo-400/60 shadow-md shadow-indigo-400/10'
                : 'hover:bg-surface-base hover:shadow-md'
            } ${isDragging ? 'opacity-50' : ''}`}
          >
            {/* Waveform placeholder / thumbnail area */}
            <div className="aspect-[4/3] bg-gradient-to-br from-slate-800 to-slate-900 relative flex items-center justify-center">
              {/* Simple waveform visualization placeholder */}
              <div className="absolute inset-0 flex items-center justify-center px-2">
                <div className="flex items-end gap-0.5 h-8 w-full">
                  {Array.from({ length: 24 }).map((_, i) => {
                    // Create consistent waveform based on sample.id (not random)
                    const baseHeight = 30
                    const variation = Math.abs(Math.sin((i / 24) * Math.PI * 4 + (sample.id % 100) / 10)) * 70
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-accent-primary/40 rounded-t"
                        style={{
                          height: `${baseHeight + variation}%`,
                        }}
                      />
                    )
                  })}
                </div>
              </div>

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
                className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                  isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                  isPlaying ? 'bg-accent-primary' : 'bg-black/60 hover:bg-black/80'
                }`}>
                  {isPlaying && playMode === 'normal' ? (
                    <Pause size={18} className="text-white" />
                  ) : (
                    <Play size={18} className="text-white ml-0.5" />
                  )}
                </div>
              </button>

              {/* Checkbox for selection */}
              {onToggleSelect && (
                <div
                  className={`absolute top-1.5 left-1.5 transition-opacity ${
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
                  className={`absolute top-1.5 right-1.5 p-1 rounded transition-all ${
                    sample.favorite
                      ? 'text-amber-400 bg-amber-400/20'
                      : 'text-slate-400 opacity-0 group-hover:opacity-100 hover:text-amber-400 hover:bg-amber-400/20'
                  }`}
                >
                  <Heart size={14} className={sample.favorite ? 'fill-current' : ''} />
                </button>
              )}

              {/* Drag handle */}
              {!onToggleSelect && (
                <div className="absolute top-1.5 left-1.5 p-1 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
                  <GripVertical size={14} />
                </div>
              )}

              {/* Duration badge */}
              <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0 text-[10px] font-medium bg-black/60 rounded text-white inline-block">
                {formatDuration(sample.startTime, sample.endTime)}
              </span>

              {/* Instrument type badge */}
              {(sample.instrumentType || sample.instrumentPrimary) && (
                <div className="absolute bottom-1.5 left-1.5 p-1 bg-black/60 rounded text-slate-300" title={sample.instrumentType || sample.instrumentPrimary || ''}>
                  <InstrumentIcon type={sample.instrumentType || sample.instrumentPrimary || 'other'} size={12} />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="p-2">
              <p className="text-sm font-medium text-white truncate" title={sample.name}>
                {sample.name}
              </p>

              {/* Tags preview */}
              {sample.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                  {sample.tags.slice(0, 2).map(tag => (
                    <span
                      key={tag.id}
                      onClick={(e) => {
                        if (onTagClick) {
                          e.stopPropagation()
                          onTagClick(tag.id)
                        }
                      }}
                      className={`inline-block px-1.5 py-0 text-[10px] rounded-full ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                      style={{
                        backgroundColor: tag.color + '25',
                        color: tag.color,
                      }}
                      title={onTagClick ? `Filter by ${tag.name}` : tag.name}
                    >
                      {tag.name}
                    </span>
                  ))}
                  {sample.tags.length > 2 && (
                    <div
                      ref={(el) => { tagTriggerRefs.current[sample.id] = el }}
                      className="relative inline-block"
                      onMouseEnter={() => handleTagPopupOpen(sample.id)}
                      onMouseLeave={handleTagPopupClose}
                    >
                      <span className="inline-block px-1.5 py-0 text-[10px] text-slate-500 cursor-default leading-none">
                        +{sample.tags.length - 2}
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
                            {sample.tags.slice(2).map((tag) => (
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
                                className={`inline-block px-1.5 py-0 text-[10px] rounded-full whitespace-nowrap ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
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
  }

  const gridClass = "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 p-4"

  return (
    <div className="flex flex-col">
      {/* Sort controls */}
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
        <span className="text-sm text-slate-400">Sort by:</span>
        <button
          onClick={() => handleSortClick('name')}
          className={`flex items-center px-3 py-1.5 text-sm rounded transition-colors ${
            sortField === 'name'
              ? 'bg-accent-primary text-white'
              : 'bg-surface-raised text-slate-300 hover:bg-surface-base'
          }`}
        >
          Name
          {getSortIcon('name')}
        </button>
        <button
          onClick={() => handleSortClick('duration')}
          className={`flex items-center px-3 py-1.5 text-sm rounded transition-colors ${
            sortField === 'duration'
              ? 'bg-accent-primary text-white'
              : 'bg-surface-raised text-slate-300 hover:bg-surface-base'
          }`}
        >
          Duration
          {getSortIcon('duration')}
        </button>
      </div>

      {/* Grid - grouped or flat */}
      {scaleDegreeGroups ? (
        <div className="px-4 pb-4">
          {Array.from(scaleDegreeGroups.entries()).map(([degree, groupSamples]) => (
            <div key={degree} className="mb-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-2 px-1 border-l-2 border-accent-primary pl-2">
                {degree}
                <span className="text-xs text-slate-500 ml-2">({groupSamples.length})</span>
              </h3>
              <div className={gridClass.replace('p-4', '')}>
                {groupSamples.map(sample => renderSampleCard(sample))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={gridClass}>
          {sortedSamples.map(sample => renderSampleCard(sample))}
        </div>
      )}
    </div>
  )
}
