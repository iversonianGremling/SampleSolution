import { Play, Pause, Star } from 'lucide-react'
import type { SliceWithTrack } from '../types'

interface CompactSliceRowProps {
  slice: SliceWithTrack
  isPlaying: boolean
  isSelected: boolean
  isBatchSelected: boolean
  onSelect: () => void
  onToggleBatchSelect: () => void
  onPlay: () => void
  formatTime: (s: number) => string
}

export function CompactSliceRow({
  slice,
  isPlaying,
  isSelected,
  isBatchSelected,
  onSelect,
  onToggleBatchSelect,
  onPlay,
  formatTime,
}: CompactSliceRowProps) {
  const duration = slice.endTime - slice.startTime
  const maxVisibleTags = 3
  const visibleTags = slice.tags.slice(0, maxVisibleTags)
  const remainingTags = slice.tags.length - maxVisibleTags

  return (
    <div
      onClick={onSelect}
      className={`px-3 py-1.5 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-indigo-900/40 border-l-2 border-indigo-400'
          : isBatchSelected
          ? 'bg-indigo-900/20 border-l-2 border-indigo-400/50'
          : 'hover:bg-gray-700/30 border-l-2 border-transparent'
      }`}
    >
      {/* Top row: Checkbox, Play, Name, Duration, Favorite */}
      <div className="flex items-center gap-2">
        {/* Selection checkbox */}
        <input
          type="checkbox"
          checked={isBatchSelected}
          onChange={(e) => {
            e.stopPropagation()
            onToggleBatchSelect()
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500 flex-shrink-0"
        />

        {/* Play button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPlay()
          }}
          className={`p-1 rounded-full transition-colors flex-shrink-0 ${
            isPlaying
              ? 'bg-green-600 text-white'
              : 'text-gray-400 hover:text-green-400 hover:bg-gray-700'
          }`}
        >
          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
        </button>

        {/* Name */}
        <span className="font-medium text-white text-sm truncate flex-1 min-w-0">
          {slice.name}
        </span>

        {/* Duration */}
        <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">
          {formatTime(duration)}
        </span>

        {/* Favorite indicator */}
        {slice.favorite && (
          <Star
            size={12}
            className="text-yellow-400 fill-current flex-shrink-0"
          />
        )}
      </div>

      {/* Bottom row: Tags (smaller) */}
      {slice.tags.length > 0 && (
        <div className="flex items-center gap-1 mt-1 ml-7">
          {visibleTags.map((tag) => (
            <span
              key={tag.id}
              className="px-1 py-0 rounded text-[10px] leading-4"
              style={{ backgroundColor: tag.color + '25', color: tag.color }}
              title={tag.name}
            >
              {tag.name.length > 10 ? tag.name.slice(0, 10) + '…' : tag.name}
            </span>
          ))}
          {remainingTags > 0 && (
            <span className="text-[10px] text-gray-500">+{remainingTags}</span>
          )}
        </div>
      )}
    </div>
  )
}
