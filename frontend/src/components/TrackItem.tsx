import { useState, useRef, useEffect } from 'react'
import { Trash2, Pencil, Check, X } from 'lucide-react'
import type { Track } from '../types'

interface TrackItemProps {
  track: Track
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
  onUpdateTitle: (title: string) => void
  statusIcon: React.ReactNode
}

export function TrackItem({
  track,
  isSelected,
  onSelect,
  onDelete,
  onUpdateTitle,
  statusIcon,
}: TrackItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingTitle, setEditingTitle] = useState(track.title)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const saveTitle = () => {
    if (editingTitle.trim() && editingTitle !== track.title) {
      onUpdateTitle(editingTitle.trim())
    }
    setIsEditing(false)
  }

  // DEBUG
  console.log('[TrackItem] track:', track.id, track.title)
  console.log('[TrackItem] track.tags:', track.tags, 'isArray:', Array.isArray(track.tags))

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${
        isSelected ? 'bg-indigo-900/30' : 'hover:bg-gray-700/50'
      }`}
    >
      {/* Thumbnail */}
      <img
        src={track.thumbnailUrl}
        alt={track.title}
        className="w-16 h-12 object-cover rounded"
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {statusIcon}
          {isEditing ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                ref={inputRef}
                type="text"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') saveTitle()
                  if (e.key === 'Escape') setIsEditing(false)
                }}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 px-2 py-0.5 bg-gray-900 border border-indigo-500 rounded text-white text-sm focus:outline-none"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  saveTitle()
                }}
                className="p-1 text-green-400 hover:text-green-300"
                title="Save"
              >
                <Check size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsEditing(false)
                }}
                className="p-1 text-gray-400 hover:text-gray-300"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div
              className="group flex items-center gap-1 cursor-pointer min-w-0"
              onClick={(e) => {
                e.stopPropagation()
                setEditingTitle(track.title)
                setIsEditing(true)
              }}
            >
              <h3 className="font-medium text-white truncate">{track.title}</h3>
              <Pencil size={12} className="text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm text-gray-400">
            {formatDuration(track.duration)}
          </span>
          {track.tags.length > 0 && (
            <div className="flex gap-1">
              {track.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  className="px-1.5 py-0.5 text-xs rounded"
                  style={{ backgroundColor: tag.color + '40', color: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
              {track.tags.length > 3 && (
                <span className="text-xs text-gray-500">
                  +{track.tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="p-2 text-gray-400 hover:text-red-400 transition-colors"
          title="Delete track"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  )
}
