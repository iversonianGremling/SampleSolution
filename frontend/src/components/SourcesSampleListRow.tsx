import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Heart, Trash2, Pencil } from 'lucide-react'
import type { SliceWithTrackExtended } from '../types'

interface SourcesSampleListRowProps {
  sample: SliceWithTrackExtended
  isSelected: boolean
  isChecked: boolean
  isPlaying: boolean
  onSelect: () => void
  onToggleCheck: () => void
  onPlay: (e: React.MouseEvent) => void
  onToggleFavorite: () => void
  onUpdateName: (name: string) => void
  onDelete: () => void
}

export function SourcesSampleListRow({
  sample,
  isSelected,
  isChecked,
  isPlaying,
  onSelect,
  onToggleCheck,
  onPlay,
  onToggleFavorite,
  onUpdateName,
  onDelete,
}: SourcesSampleListRowProps) {
  const [isEditingName, setIsEditingName] = useState(false)
  const [editingName, setEditingName] = useState(sample.name)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [isEditingName])

  const saveName = () => {
    if (editingName.trim() && editingName !== sample.name) {
      onUpdateName(editingName.trim())
    }
    setIsEditingName(false)
  }

  const formatDuration = (startTime: number, endTime: number) => {
    const dur = endTime - startTime
    if (dur < 60) {
      return `${dur.toFixed(1)}s`
    }
    const mins = Math.floor(dur / 60)
    const secs = Math.floor(dur % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const maxVisibleTags = 3
  const visibleTags = sample.tags.slice(0, maxVisibleTags)
  const remainingTags = sample.tags.length - maxVisibleTags

  return (
    <div
      onClick={onSelect}
      className={`px-4 py-2 cursor-pointer transition-colors border-l-2 ${
        isSelected
          ? 'bg-accent-primary/10 border-accent-primary ring-2 ring-accent-primary/40'
          : isChecked
          ? 'bg-accent-primary/20 border-accent-primary/50'
          : 'hover:bg-surface-base border-transparent'
      }`}
    >
      {/* Main row */}
      <div className="flex items-center gap-3">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(e) => {
            e.stopPropagation()
            onToggleCheck()
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded border-surface-border bg-surface-base text-accent-primary focus:ring-accent-primary flex-shrink-0"
        />

        {/* Play button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPlay(e)
          }}
          className={`p-1.5 rounded transition-colors flex-shrink-0 ${
            isPlaying
              ? 'bg-accent-primary text-white'
              : 'text-slate-400 hover:text-accent-primary hover:bg-surface-base'
          }`}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>

        {/* Sample name (editable) */}
        <div className="flex-1 min-w-0">
          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') setIsEditingName(false)
              }}
              onBlur={saveName}
              className="w-full px-2 py-1 bg-surface-base border border-accent-primary rounded text-white text-sm focus:outline-none"
            />
          ) : (
            <div
              className="group flex items-center gap-2"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditingName(sample.name)
                setIsEditingName(true)
              }}
            >
              <span className="font-medium text-white text-sm truncate">
                {sample.name}
              </span>
              <Pencil size={12} className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </div>
          )}
        </div>

        {/* Track title */}
        <div className="w-48 flex-shrink-0">
          <span className="text-xs text-slate-400 truncate block">
            {sample.track.title}
          </span>
        </div>

        {/* Tags */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {visibleTags.map((tag) => (
            <span
              key={tag.id}
              className="px-1.5 py-0.5 text-[10px] rounded-full flex-shrink-0"
              style={{
                backgroundColor: tag.color + '25',
                color: tag.color,
              }}
              title={tag.name}
            >
              {tag.name.length > 10 ? tag.name.slice(0, 10) + '…' : tag.name}
            </span>
          ))}
          {remainingTags > 0 && (
            <span className="text-[10px] text-slate-500 flex-shrink-0">
              +{remainingTags}
            </span>
          )}
        </div>

        {/* Duration */}
        <div className="w-20 flex-shrink-0 text-right">
          <span className="text-xs text-slate-400">
            {formatDuration(sample.startTime, sample.endTime)}
          </span>
        </div>

        {/* Favorite button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite()
          }}
          className={`p-1.5 rounded transition-colors flex-shrink-0 ${
            sample.favorite
              ? 'text-amber-400 bg-amber-400/20'
              : 'text-slate-400 hover:text-amber-400 hover:bg-amber-400/20'
          }`}
          title={sample.favorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart size={16} className={sample.favorite ? 'fill-current' : ''} />
        </button>

        {/* Delete button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-400/20 transition-colors flex-shrink-0"
          title="Delete"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  )
}
