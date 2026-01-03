import { Trash2 } from 'lucide-react'
import type { Track } from '../types'

interface TrackItemProps {
  track: Track
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
  statusIcon: React.ReactNode
}

export function TrackItem({
  track,
  isSelected,
  onSelect,
  onDelete,
  statusIcon,
}: TrackItemProps) {
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
          <h3 className="font-medium text-white truncate">{track.title}</h3>
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
