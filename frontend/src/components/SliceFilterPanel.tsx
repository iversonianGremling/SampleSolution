import { Search, X, Heart, Plus, ChevronDown } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import type { SliceFilterState, Tag, Folder, FeatureWeights } from '../types'
import type { ReductionMethod } from '../hooks/useDimensionReduction'
import type { ClusterMethod } from '../hooks/useClustering'
import { FeatureWeightsPanel } from './FeatureWeightsPanel'

interface SliceFilterPanelProps {
  filterState: SliceFilterState
  onSearchChange: (query: string) => void
  onFavoritesChange: (showFavoritesOnly: boolean) => void
  onTrackFilterChange?: (trackId: number | null) => void
  onTagFilterChange?: (tagIds: number[]) => void
  onDurationChange?: (min: number, max: number) => void
  onFolderChange?: (folderIds: number[]) => void
  onCreateFolder?: (name: string) => void
  allTags?: Tag[]
  folders?: Folder[]
  maxDuration?: number
  sliceTrackTitle?: string
  formatTime?: (seconds: number) => string
  totalSampleCount?: number
  favoriteSampleCount?: number
  vertical?: boolean
  // Feature weights props
  weights?: FeatureWeights
  onWeightsChange?: (weights: FeatureWeights) => void
  reductionMethod?: ReductionMethod
  onReductionMethodChange?: (method: ReductionMethod) => void
  clusterMethod?: ClusterMethod
  onClusterMethodChange?: (method: ClusterMethod) => void
  clusterCount?: number
  onClusterCountChange?: (count: number) => void
  dbscanEpsilon?: number
  onDbscanEpsilonChange?: (epsilon: number) => void
}

export function SliceFilterPanel({
  filterState,
  onSearchChange,
  onFavoritesChange,
  onTrackFilterChange,
  onTagFilterChange,
  onDurationChange,
  onFolderChange,
  onCreateFolder,
  allTags = [],
  folders = [],
  maxDuration = 60,
  sliceTrackTitle,
  formatTime = (s) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`,
  totalSampleCount = 0,
  favoriteSampleCount = 0,
  vertical = false,
  // Feature weights props
  weights,
  onWeightsChange,
  reductionMethod,
  onReductionMethodChange,
  clusterMethod,
  onClusterMethodChange,
  clusterCount,
  onClusterCountChange,
  dbscanEpsilon,
  onDbscanEpsilonChange,
}: SliceFilterPanelProps) {
  const { searchQuery, showFavoritesOnly, selectedTrackId, selectedTags, minDuration, maxDuration: statMaxDuration, selectedFolderIds } = filterState

  // Tag search state
  const [tagSearchQuery, setTagSearchQuery] = useState('')
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false)
  const tagContainerRef = useRef<HTMLDivElement>(null)

  // Folder dropdown state
  const [isFolderDropdownOpen, setIsFolderDropdownOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const folderContainerRef = useRef<HTMLDivElement>(null)

  // Default handlers for optional callbacks
  const handleTrackFilterChange = onTrackFilterChange ?? (() => {})
  const handleTagFilterChange = onTagFilterChange ?? (() => {})
  const handleDurationChange = onDurationChange ?? (() => {})
  const handleFolderChange = onFolderChange ?? (() => {})

  // Filter available tags
  const availableTags = allTags.filter(tag => !selectedTags.includes(tag.id))
  const filteredAvailableTags = availableTags.filter(tag =>
    tag.name.toLowerCase().includes(tagSearchQuery.toLowerCase())
  )

  // Filter available folders (not yet selected)
  const availableFolders = folders.filter(col => !selectedFolderIds.includes(col.id))
  const selectedFolders = folders.filter(col => selectedFolderIds.includes(col.id))

  const handleCreateFolder = () => {
    if (newFolderName.trim() && onCreateFolder) {
      onCreateFolder(newFolderName.trim())
      setNewFolderName('')
      setIsCreatingFolder(false)
      setIsFolderDropdownOpen(false)
    }
  }

  // Click outside handler for tag dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tagContainerRef.current && !tagContainerRef.current.contains(e.target as Node)) {
        setIsTagDropdownOpen(false)
        setTagSearchQuery('')
      }
      if (folderContainerRef.current && !folderContainerRef.current.contains(e.target as Node)) {
        setIsFolderDropdownOpen(false)
        setIsCreatingFolder(false)
        setNewFolderName('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleTag = (tagId: number) => {
    if (selectedTags.includes(tagId)) {
      handleTagFilterChange(selectedTags.filter(id => id !== tagId))
    } else {
      handleTagFilterChange([...selectedTags, tagId])
    }
  }

  const toggleFolder = (folderId: number) => {
    if (selectedFolderIds.includes(folderId)) {
      handleFolderChange(selectedFolderIds.filter(id => id !== folderId))
    } else {
      handleFolderChange([...selectedFolderIds, folderId])
    }
  }

  return (
    <div className={`space-y-3 ${vertical ? 'bg-gray-800 rounded-lg p-4' : ''}`}>
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by name or track..."
          className="input-field pl-10"
        />
      </div>

      {/* Folder & Favorites Filter - Multi-select */}
      <div className="border-b border-surface-border/50 pb-2">
        <label className="text-xs font-semibold text-slate-300 block mb-1.5 tracking-wider uppercase">Category</label>
        <div className="flex flex-wrap gap-1.5 items-center">
          {/* All Option */}
          <button
            onClick={() => {
              onFavoritesChange(false)
              handleFolderChange([])
            }}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
              !showFavoritesOnly && selectedFolderIds.length === 0
                ? 'bg-slate-600 text-white shadow-sm'
                : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-300'
            }`}
          >
            All ({totalSampleCount})
          </button>

          {/* Favorites Option */}
          <button
            onClick={() => onFavoritesChange(!showFavoritesOnly)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200 flex items-center gap-1 ${
              showFavoritesOnly
                ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-300'
            }`}
          >
            <Heart size={11} className={showFavoritesOnly ? 'fill-current' : ''} />
            Favorites ({favoriteSampleCount})
          </button>

          {/* Selected Folders as removable chips */}
          {selectedFolders.map((col) => (
            <span
              key={col.id}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border shadow-sm"
              style={{
                backgroundColor: col.color + '20',
                color: col.color,
                borderColor: col.color + '50',
              }}
            >
              {col.name} ({col.sliceCount})
              <button
                onClick={() => toggleFolder(col.id)}
                className="hover:opacity-70 transition-opacity"
              >
                <X size={12} />
              </button>
            </span>
          ))}

          {/* Add Folder Dropdown */}
          <div className="relative" ref={folderContainerRef}>
            <button
              onClick={() => setIsFolderDropdownOpen(!isFolderDropdownOpen)}
              className="px-2 py-1 rounded-md text-xs font-medium transition-all duration-200 bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-300 flex items-center gap-1"
            >
              <Plus size={12} />
              <ChevronDown size={10} className={`transition-transform ${isFolderDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown */}
            {isFolderDropdownOpen && (
              <div className="absolute top-full mt-1 left-0 z-20 min-w-48 bg-surface-raised border border-surface-border rounded-lg shadow-xl overflow-hidden">
                {/* Available folders */}
                {availableFolders.length > 0 && (
                  <div className="max-h-40 overflow-y-auto">
                    {availableFolders.map((col) => (
                      <button
                        key={col.id}
                        onClick={() => {
                          toggleFolder(col.id)
                          setIsFolderDropdownOpen(false)
                        }}
                        className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-base flex items-center gap-2"
                      >
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: col.color }}
                        />
                        <span style={{ color: col.color }}>{col.name}</span>
                        <span className="text-slate-500 ml-auto">({col.sliceCount})</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Create new folder */}
                {onCreateFolder && (
                  <>
                    {availableFolders.length > 0 && <div className="border-t border-surface-border" />}
                    {isCreatingFolder ? (
                      <div className="p-2">
                        <input
                          type="text"
                          value={newFolderName}
                          onChange={(e) => setNewFolderName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreateFolder()
                            if (e.key === 'Escape') {
                              setIsCreatingFolder(false)
                              setNewFolderName('')
                            }
                          }}
                          placeholder="Folder name..."
                          className="w-full px-2 py-1.5 bg-surface-base border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                          autoFocus
                        />
                        <div className="flex gap-1 mt-2">
                          <button
                            onClick={handleCreateFolder}
                            disabled={!newFolderName.trim()}
                            className="flex-1 px-2 py-1 text-xs bg-accent-primary text-white rounded hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Create
                          </button>
                          <button
                            onClick={() => {
                              setIsCreatingFolder(false)
                              setNewFolderName('')
                            }}
                            className="px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setIsCreatingFolder(true)}
                        className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-base flex items-center gap-2 text-slate-400"
                      >
                        <Plus size={14} />
                        New category...
                      </button>
                    )}
                  </>
                )}

                {/* Empty state */}
                {availableFolders.length === 0 && !onCreateFolder && (
                  <div className="px-3 py-2 text-sm text-slate-500">
                    All categories selected
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Track Filter */}
      {selectedTrackId !== null && sliceTrackTitle && onTrackFilterChange && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-primary/10 border border-accent-primary/30 rounded-lg">
          <span className="text-sm text-slate-300">
            Filtering by: <span className="font-medium text-white">{sliceTrackTitle}</span>
          </span>
          <button
            onClick={() => handleTrackFilterChange(null)}
            className="p-1 text-slate-400 hover:text-white hover:bg-surface-base rounded transition-colors ml-auto"
            title="Clear track filter"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Tag Filter with Search */}
      {onTagFilterChange && (
        <div className="border-t border-surface-border pt-3">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-slate-400">Filter by instruments</label>
            {selectedTags.length > 0 && (
              <button
                onClick={() => handleTagFilterChange([])}
                className="text-xs text-slate-400 hover:text-white transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Selected Instruments */}
          {selectedTags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedTags.map((tagId) => {
                const tag = allTags.find(t => t.id === tagId)
                if (!tag) return null
                return (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ring-2 ring-offset-0"
                    style={{
                      backgroundColor: tag.color + '30',
                      color: tag.color,
                    }}
                    title={tag.name}
                  >
                    {tag.name}
                    <button
                      onClick={() => toggleTag(tag.id)}
                      className="hover:opacity-70 transition-opacity"
                    >
                      <X size={12} />
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          {/* Tag Search Input */}
          <div className="relative" ref={tagContainerRef}>
            <input
              type="text"
              value={tagSearchQuery}
              onChange={(e) => {
                setTagSearchQuery(e.target.value)
                setIsTagDropdownOpen(true)
              }}
              onFocus={() => setIsTagDropdownOpen(true)}
              placeholder="Search instruments..."
              className="w-full px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary transition-colors"
            />

            {/* Tag Dropdown */}
            {isTagDropdownOpen && filteredAvailableTags.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 z-20 max-h-48 overflow-y-auto bg-surface-raised border border-surface-border rounded-lg shadow-xl">
                {filteredAvailableTags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => {
                      toggleTag(tag.id)
                      setTagSearchQuery('')
                      setIsTagDropdownOpen(false)
                    }}
                    className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-base flex items-center gap-2"
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span style={{ color: tag.color }} title={tag.name}>{tag.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Duration Filter with Dual-Handle Slider */}
      {onDurationChange && (
        <div className="border-t border-surface-border pt-3">
          <label className="text-xs font-medium text-slate-400 block mb-3">
            Duration: {formatTime(minDuration)} - {formatTime(statMaxDuration)}
          </label>
          <div className="relative h-8 flex items-center">
            {/* Track background */}
            <div className="absolute left-0 right-0 h-1 bg-surface-raised rounded-full" />

            {/* Active range */}
            <div
              className="absolute h-1 bg-accent-primary rounded-full"
              style={{
                left: `${(minDuration / maxDuration) * 100}%`,
                right: `${100 - (statMaxDuration / maxDuration) * 100}%`,
              }}
            />

            {/* Min handle */}
            <input
              type="range"
              min={0}
              max={maxDuration}
              step={0.1}
              value={minDuration}
              onChange={(e) => {
                const newMin = parseFloat(e.target.value)
                handleDurationChange(Math.min(newMin, statMaxDuration), statMaxDuration)
              }}
              className="absolute w-full h-8 appearance-none bg-transparent cursor-pointer slider-thumb"
              style={{ zIndex: minDuration > statMaxDuration - 1 ? 5 : 4 }}
            />

            {/* Max handle */}
            <input
              type="range"
              min={0}
              max={maxDuration}
              step={0.1}
              value={statMaxDuration}
              onChange={(e) => {
                const newMax = parseFloat(e.target.value)
                handleDurationChange(minDuration, Math.max(newMax, minDuration))
              }}
              className="absolute w-full h-8 appearance-none bg-transparent cursor-pointer slider-thumb"
              style={{ zIndex: statMaxDuration < minDuration + 1 ? 5 : 3 }}
            />
          </div>
        </div>
      )}

      {/* Feature Weights Panel */}
      {weights && onWeightsChange && reductionMethod && onReductionMethodChange &&
       clusterMethod && onClusterMethodChange && clusterCount !== undefined &&
       onClusterCountChange && dbscanEpsilon !== undefined && onDbscanEpsilonChange && (
        <div className="border-t border-surface-border/50 pt-3">
          <FeatureWeightsPanel
            weights={weights}
            onWeightsChange={onWeightsChange}
            reductionMethod={reductionMethod}
            onReductionMethodChange={onReductionMethodChange}
            clusterMethod={clusterMethod}
            onClusterMethodChange={onClusterMethodChange}
            clusterCount={clusterCount}
            onClusterCountChange={onClusterCountChange}
            dbscanEpsilon={dbscanEpsilon}
            onDbscanEpsilonChange={onDbscanEpsilonChange}
          />
        </div>
      )}

    </div>
  )
}
