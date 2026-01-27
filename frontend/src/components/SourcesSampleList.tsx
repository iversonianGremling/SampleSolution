import { useState, useRef, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { SourcesSampleListRow } from './SourcesSampleListRow'
import type { SliceWithTrackExtended } from '../types'
import { getSliceDownloadUrl } from '../api/client'

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
  isLoading?: boolean
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
  isLoading = false,
}: SourcesSampleListProps) {
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const listContainerRef = useRef<HTMLDivElement>(null)

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
        <div className="flex items-center gap-3">
          {/* Select all checkbox */}
          <input
            type="checkbox"
            checked={selectAllChecked}
            ref={(el) => {
              if (el) {
                el.indeterminate = selectAllIndeterminate
              }
            }}
            onChange={onToggleSelectAll}
            className="w-4 h-4 rounded border-surface-border bg-surface-base text-accent-primary focus:ring-accent-primary flex-shrink-0"
            title="Select all samples"
          />

          {/* Column headers */}
          <span className="w-10 flex-shrink-0 text-xs font-semibold text-slate-400 uppercase">Play</span>
          <span className="flex-1 text-xs font-semibold text-slate-400 uppercase">Name</span>
          <span className="w-48 flex-shrink-0 text-xs font-semibold text-slate-400 uppercase">Track</span>
          <span className="text-xs font-semibold text-slate-400 uppercase">Tags</span>
          <span className="w-20 flex-shrink-0 text-right text-xs font-semibold text-slate-400 uppercase">Duration</span>
          <span className="w-16 flex-shrink-0 text-right text-xs font-semibold text-slate-400 uppercase">Actions</span>
        </div>
      </div>

      {/* List items */}
      <div ref={listContainerRef} className="flex-1 overflow-y-auto divide-y divide-surface-border">
        {samples.map((sample) => (
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
          />
        ))}
      </div>
    </div>
  )
}
