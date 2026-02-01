import { useState, useRef, useEffect, useMemo } from 'react'
import { Loader2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { SourcesSampleListRow } from './SourcesSampleListRow'
import { CustomCheckbox } from './CustomCheckbox'
import { createDragPreview } from './DragPreview'
import type { SliceWithTrackExtended } from '../types'
import { getSliceDownloadUrl } from '../api/client'

type SortField = 'name' | 'duration' | 'bpm' | 'key'
type SortOrder = 'asc' | 'desc'
export type PlayMode = 'normal' | 'one-shot' | 'reproduce-while-clicking'

interface SourcesSampleListProps {
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
  playMode?: PlayMode
  loopEnabled?: boolean
}

export function SourcesSampleList({
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
  playMode = 'normal',
  loopEnabled = false,
}: SourcesSampleListProps) {
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const listContainerRef = useRef<HTMLDivElement>(null)
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const dragPreviewRef = useRef<HTMLElement | null>(null)

  // Stop audio when unmounting
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

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
      } else if (sortField === 'bpm') {
        const bpmA = a.bpm ?? -1
        const bpmB = b.bpm ?? -1
        // Sort null/undefined values last
        if (bpmA === -1 && bpmB === -1) return 0
        if (bpmA === -1) return 1
        if (bpmB === -1) return -1
        compareValue = bpmA - bpmB
      } else if (sortField === 'key') {
        const keyA = a.keyEstimate ?? ''
        const keyB = b.keyEstimate ?? ''
        // Sort null/undefined values last
        if (!keyA && !keyB) return 0
        if (!keyA) return 1
        if (!keyB) return -1
        compareValue = keyA.localeCompare(keyB)
      }

      return sortOrder === 'asc' ? compareValue : -compareValue
    })
  }, [samples, sortField, sortOrder])

  // Determine if select-all checkbox should be indeterminate
  const selectAllIndeterminate = selectedIds.size > 0 && selectedIds.size < sortedSamples.length
  const selectAllChecked = selectedIds.size === sortedSamples.length && sortedSamples.length > 0

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

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown size={12} className="ml-1 opacity-50" />
    }
    return sortOrder === 'asc' ? <ArrowUp size={12} className="ml-1" /> : <ArrowDown size={12} className="ml-1" />
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

          {/* Column headers */}
          <span className="w-8 sm:w-10 flex-shrink-0 text-xs font-semibold text-slate-400 uppercase text-left">Play</span>

          {/* Name column with sort */}
          <button
            onClick={() => handleSortClick('name')}
            className={`flex-1 min-w-0 flex items-center text-left text-xs font-semibold uppercase transition-colors hover:text-slate-200 pl-1 ${
              sortField === 'name' ? 'text-accent-primary' : 'text-slate-400'
            }`}
          >
            Name
            {getSortIcon('name')}
          </button>

          {/* Tags */}
          <span className="hidden sm:block text-xs font-semibold text-slate-400 uppercase text-left pl-1">Tags</span>

          {/* BPM column with sort */}
          <button
            onClick={() => handleSortClick('bpm')}
            className={`hidden md:flex w-14 flex-shrink-0 items-center justify-end text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
              sortField === 'bpm' ? 'text-accent-primary' : 'text-slate-400'
            }`}
          >
            BPM
            {getSortIcon('bpm')}
          </button>

          {/* Key column with sort */}
          <button
            onClick={() => handleSortClick('key')}
            className={`hidden lg:flex w-16 flex-shrink-0 items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
              sortField === 'key' ? 'text-accent-primary' : 'text-slate-400'
            }`}
          >
            Key
            {getSortIcon('key')}
          </button>

          {/* Envelope Type column */}
          <span className="hidden xl:flex w-20 flex-shrink-0 justify-center text-xs font-semibold text-slate-400 uppercase">
            Envelope
          </span>

          {/* Duration column with sort */}
          <button
            onClick={() => handleSortClick('duration')}
            className={`w-16 sm:w-20 flex-shrink-0 flex items-center justify-end text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
              sortField === 'duration' ? 'text-accent-primary' : 'text-slate-400'
            }`}
          >
            Duration
            {getSortIcon('duration')}
          </button>

          {/* Actions */}
          <span className="w-12 sm:w-16 flex-shrink-0 text-right text-xs font-semibold text-slate-400 uppercase">Actions</span>
        </div>
      </div>

      {/* List items */}
      <div ref={listContainerRef} className="flex-1 overflow-y-auto divide-y divide-surface-border">
        {sortedSamples.map((sample) => (
          <SourcesSampleListRow
            key={sample.id}
            sample={sample}
            isSelected={selectedId === sample.id}
            isChecked={selectedIds.has(sample.id)}
            isPlaying={playingId === sample.id}
            onSelect={() => onSelect(sample.id)}
            onToggleCheck={() => onToggleSelect(sample.id)}
            onPlay={(e) => handlePlay(sample.id, e as any)}
            onMouseDown={(e) => handleMouseDown(sample.id, e as any)}
            onMouseUp={handleMouseUp}
            onToggleFavorite={() => onToggleFavorite(sample.id)}
            onUpdateName={(name) => onUpdateName(sample.id, name)}
            onDelete={() => onDelete(sample.id)}
            onTagClick={onTagClick}
            onDragStart={handleDragStart(sample)}
            onDragEnd={handleDragEnd}
            playMode={playMode}
          />
        ))}
      </div>
    </div>
  )
}
