import { Search, X } from 'lucide-react'
import type { SliceFilterState, Tag, Collection } from '../types'

interface SliceFilterPanelProps {
  filterState: SliceFilterState
  onSearchChange: (query: string) => void
  onFavoritesChange: (showFavoritesOnly: boolean) => void
  onTrackFilterChange?: (trackId: number | null) => void
  onTagFilterChange?: (tagId: number) => void
  onTagFilterClear?: () => void
  onDurationChange?: (min: number, max: number) => void
  onCollectionChange?: (collectionId: number | null) => void
  allTags?: Tag[]
  collections?: Collection[]
  maxDuration?: number
  sliceTrackTitle?: string
  formatTime?: (seconds: number) => string
}

export function SliceFilterPanel({
  filterState,
  onSearchChange,
  onFavoritesChange,
  onTrackFilterChange,
  onTagFilterChange,
  onTagFilterClear,
  onDurationChange,
  onCollectionChange,
  allTags = [],
  collections = [],
  maxDuration = 60,
  sliceTrackTitle,
  formatTime = (s) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`,
}: SliceFilterPanelProps) {
  const { searchQuery, showFavoritesOnly, selectedTrackId, selectedTags, minDuration, maxDuration: statMaxDuration, selectedCollectionId } = filterState

  // Default handlers for optional callbacks
  const handleTrackFilterChange = onTrackFilterChange ?? (() => {})
  const handleTagFilterChange = onTagFilterChange ?? (() => {})
  const handleTagFilterClear = onTagFilterClear ?? (() => {})
  const handleDurationChange = onDurationChange ?? (() => {})
  const handleCollectionChange = onCollectionChange ?? (() => {})

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      <h2 className="font-semibold text-white">Filters</h2>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by name or track..."
          className="w-full pl-10 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Favorites Filter */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={showFavoritesOnly}
          onChange={(e) => onFavoritesChange(e.target.checked)}
          className="w-4 h-4 rounded accent-indigo-500"
        />
        <span className="text-sm text-gray-300">Favorites only</span>
      </label>

      {/* Track Filter */}
      {selectedTrackId !== null && sliceTrackTitle && onTrackFilterChange && (
        <div className="flex items-center gap-2 px-3 py-2 bg-indigo-900/40 border border-indigo-700/50 rounded-lg">
          <span className="text-sm text-indigo-300">
            Filtering by track: <span className="font-medium text-white">{sliceTrackTitle}</span>
          </span>
          <button
            onClick={() => handleTrackFilterChange(null)}
            className="p-1 text-indigo-400 hover:text-white hover:bg-indigo-700/50 rounded transition-colors"
            title="Clear track filter"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Tag Filter */}
      {onTagFilterChange && (
        <div>
          <label className="text-sm text-gray-400 block mb-2">Filter by tags (must match ALL)</label>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => handleTagFilterChange(tag.id)}
                className={`px-2 py-1 rounded text-sm transition-all ${
                  selectedTags.includes(tag.id)
                    ? 'ring-2 ring-white'
                    : 'opacity-60 hover:opacity-100'
                }`}
                style={{
                  backgroundColor: tag.color + '40',
                  color: tag.color,
                }}
              >
                {tag.name}
              </button>
            ))}
            {selectedTags.length > 0 && (
              <button
                onClick={() => handleTagFilterClear()}
                className="px-2 py-1 text-sm text-gray-400 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Duration Filter */}
      {onDurationChange && (
        <div>
          <label className="text-sm text-gray-400 block mb-2">
            Duration: {formatTime(minDuration)} - {formatTime(statMaxDuration)}
          </label>
          <div className="flex gap-4 items-center">
            <input
              type="range"
              min={0}
              max={maxDuration}
              step={0.1}
              value={minDuration}
              onChange={(e) => handleDurationChange(parseFloat(e.target.value), statMaxDuration)}
              className="flex-1"
            />
            <input
              type="range"
              min={0}
              max={maxDuration}
              step={0.1}
              value={statMaxDuration}
              onChange={(e) => handleDurationChange(minDuration, parseFloat(e.target.value))}
              className="flex-1"
            />
          </div>
        </div>
      )}

      {/* Collection Filter */}
      {onCollectionChange && collections.length > 0 && (
        <div>
          <label className="text-sm text-gray-400 block mb-2">Filter by collection</label>
          <div className="flex flex-wrap gap-2">
            {selectedCollectionId !== null && (
              <button
                onClick={() => handleCollectionChange(null)}
                className="px-3 py-1.5 rounded text-sm bg-gray-700 text-white opacity-100 hover:opacity-100"
              >
                Clear
              </button>
            )}
            {collections.map((col) => (
              <button
                key={col.id}
                onClick={() => handleCollectionChange(selectedCollectionId === col.id ? null : col.id)}
                className={`px-3 py-1.5 rounded text-sm transition-all ${
                  selectedCollectionId === col.id
                    ? 'ring-2 ring-white'
                    : 'opacity-80 hover:opacity-100'
                }`}
                style={{
                  backgroundColor: col.color + '40',
                  color: col.color,
                }}
              >
                {col.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
