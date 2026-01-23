import { Search, Star } from 'lucide-react'
import type { SliceFilterState } from '../types'

interface SliceFilterPanelProps {
  filterState: SliceFilterState
  onSearchChange: (query: string) => void
  onFavoritesChange: (showFavoritesOnly: boolean) => void
}

export function SliceFilterPanel({
  filterState,
  onSearchChange,
  onFavoritesChange,
}: SliceFilterPanelProps) {
  const { searchQuery, showFavoritesOnly } = filterState

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
        <Search size={16} />
        Filters
      </h3>

      {/* Search Input */}
      <div>
        <input
          type="text"
          placeholder="Search samples..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Favorites Toggle */}
      <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-700/50 px-2 py-1.5 rounded transition-colors">
        <input
          type="checkbox"
          checked={showFavoritesOnly}
          onChange={(e) => onFavoritesChange(e.target.checked)}
          className="rounded accent-indigo-500"
        />
        <Star size={16} className={showFavoritesOnly ? 'fill-yellow-400 text-yellow-400' : 'text-gray-400'} />
        <span className="text-sm text-gray-300">Favorites only</span>
      </label>
    </div>
  )
}
