import { useState, useMemo } from 'react'
import { Search, Heart, LayoutGrid, List, Sparkles, Play, Repeat1, MousePointerClick, ChevronDown, Repeat } from 'lucide-react'
import { SourcesTree } from './SourcesTree'
import { SourcesTagFilter } from './SourcesTagFilter'
import { SourcesSampleGrid } from './SourcesSampleGrid'
import { SourcesSampleList } from './SourcesSampleList'
import { SourcesYouTubeGroupedGrid } from './SourcesYouTubeGroupedGrid'
import { SourcesYouTubeGroupedList } from './SourcesYouTubeGroupedList'
import { SourcesBatchActions } from './SourcesBatchActions'
import { SourcesDetailModal } from './SourcesDetailModal'
import { EditingModal } from './EditingModal'
import { SampleSpaceView } from './SampleSpaceView'
import { useSourceTree } from '../hooks/useSourceTree'
import { useScopedSamples } from '../hooks/useScopedSamples'
import {
  useTags,
  useCollections,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
  useToggleFavorite,
  useAddTagToSlice,
  useRemoveTagFromSlice,
  useAddSliceToCollection,
  useRemoveSliceFromCollection,
  useUpdateSliceGlobal,
  useCreateTag,
  useDeleteSliceGlobal,
  useBatchDeleteSlices,
} from '../hooks/useTracks'
import type { SourceScope, SliceWithTrackExtended } from '../types'
import { getSliceDownloadUrl } from '../api/client'

export type PlayMode = 'normal' | 'one-shot' | 'reproduce-while-clicking'

export function SourcesView() {
  // State
  const [currentScope, setCurrentScope] = useState<SourceScope>({ type: 'all' })
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [selectedSampleId, setSelectedSampleId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'space'>('grid')
  const [selectedSampleIds, setSelectedSampleIds] = useState<Set<number>>(new Set())
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null)

  // Advanced filters
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [minDuration, setMinDuration] = useState<number>(0)
  const [maxDuration, setMaxDuration] = useState<number>(300)
  const [playMode, setPlayMode] = useState<PlayMode>('normal')
  const [loopEnabled, setLoopEnabled] = useState(false)

  // Data queries
  const { data: sourceTree, isLoading: isTreeLoading } = useSourceTree()
  const { data: samplesData, isLoading: isSamplesLoading } = useScopedSamples(
    currentScope,
    selectedTags,
    searchQuery,
    showFavoritesOnly
  )
  const { data: allTags = [] } = useTags()
  const { data: collections = [] } = useCollections()

  // Mutations
  const createCollection = useCreateCollection()
  const updateCollection = useUpdateCollection()
  const deleteCollection = useDeleteCollection()
  const toggleFavorite = useToggleFavorite()
  const addTagToSlice = useAddTagToSlice()
  const removeTagFromSlice = useRemoveTagFromSlice()
  const addSliceToCollection = useAddSliceToCollection()
  const removeSliceFromCollection = useRemoveSliceFromCollection()
  const updateSlice = useUpdateSliceGlobal()
  const createTag = useCreateTag()
  const deleteSlice = useDeleteSliceGlobal()
  const batchDeleteSlices = useBatchDeleteSlices()

  // Derived data
  const allSamples = samplesData?.samples || []
  const totalCount = samplesData?.total || 0

  // Filter samples by duration
  const samples = useMemo(() => {
    return allSamples.filter(sample => {
      const duration = sample.endTime - sample.startTime
      return duration >= minDuration && (maxDuration >= 600 || duration <= maxDuration)
    })
  }, [allSamples, minDuration, maxDuration])

  const selectedSample = useMemo<SliceWithTrackExtended | null>(() => {
    if (!selectedSampleId) return null
    return samples.find(s => s.id === selectedSampleId) || null
  }, [selectedSampleId, samples])

  // Create filter state for SampleSpaceView
  const spaceViewFilterState = useMemo(() => ({
    searchQuery,
    selectedTags,
    minDuration,
    maxDuration: maxDuration >= 600 ? Infinity : maxDuration,
    showFavoritesOnly,
    selectedCollectionIds: currentScope.type === 'my-folder' ? [currentScope.collectionId] : [],
    selectedTrackId: currentScope.type === 'youtube-video' ? currentScope.trackId : null,
  }), [searchQuery, selectedTags, minDuration, maxDuration, showFavoritesOnly, currentScope])

  // Clear selected sample if it's no longer in the list
  if (selectedSampleId && !selectedSample && samples.length > 0) {
    setSelectedSampleId(null)
  }

  // Handlers
  const handleScopeChange = (scope: SourceScope) => {
    setCurrentScope(scope)
    setSelectedSampleId(null)
  }

  const handleCreateCollection = (name: string, parentId?: number) => {
    createCollection.mutate({ name, parentId })
  }

  const handleRenameCollection = (id: number, name: string) => {
    updateCollection.mutate({ id, data: { name } })
  }

  const handleUpdateCollection = (id: number, data: { parentId?: number | null; color?: string }) => {
    updateCollection.mutate({ id, data })
  }

  const handleDeleteCollection = (id: number) => {
    deleteCollection.mutate(id)
    // If we're viewing the deleted collection, reset scope
    if (currentScope.type === 'my-folder' && currentScope.collectionId === id) {
      setCurrentScope({ type: 'all' })
    }
  }

  const handleToggleFavorite = (sliceId: number) => {
    toggleFavorite.mutate(sliceId)
  }

  const handleAddTag = (sliceId: number, tagId: number) => {
    addTagToSlice.mutate({ sliceId, tagId })
  }

  const handleRemoveTag = (sliceId: number, tagId: number) => {
    removeTagFromSlice.mutate({ sliceId, tagId })
  }

  const handleAddToCollection = (collectionId: number, sliceId: number) => {
    addSliceToCollection.mutate({ collectionId, sliceId })
  }

  const handleRemoveFromCollection = (collectionId: number, sliceId: number) => {
    removeSliceFromCollection.mutate({ collectionId, sliceId })
  }

  const handleUpdateName = (sliceId: number, name: string) => {
    updateSlice.mutate({ id: sliceId, data: { name } })
  }

  const handleCreateTag = (name: string, color: string) => {
    createTag.mutate({ name, color })
  }

  const handleTagClick = (tagId: number) => {
    setSelectedTags((prev) => {
      if (prev.includes(tagId)) {
        // Remove tag from filter
        return prev.filter(id => id !== tagId)
      } else {
        // Add tag to filter
        return [...prev, tagId]
      }
    })
  }

  const handleViewModeChange = (mode: 'grid' | 'list' | 'space') => {
    setViewMode(mode)
  }

  const handleToggleSelect = (id: number) => {
    setSelectedSampleIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleToggleSelectAll = () => {
    if (selectedSampleIds.size === samples.length && samples.length > 0) {
      setSelectedSampleIds(new Set())
    } else {
      setSelectedSampleIds(new Set(samples.map(s => s.id)))
    }
  }

  const handleBatchDelete = (ids: number[]) => {
    if (confirm(`Delete ${ids.length} selected samples?`)) {
      batchDeleteSlices.mutate(ids, {
        onSuccess: () => setSelectedSampleIds(new Set())
      })
    }
  }

  const handleBatchDownload = (ids: number[]) => {
    const selectedSamples = samples.filter(s => ids.includes(s.id))
    selectedSamples.forEach(sample => {
      const link = document.createElement('a')
      link.href = getSliceDownloadUrl(sample.id)
      link.download = `${sample.name}.mp3`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    })
  }

  const handleDeleteSingle = (id: number) => {
    const sample = samples.find(s => s.id === id)
    if (sample && confirm(`Delete "${sample.name}"?`)) {
      deleteSlice.mutate(id)
      if (selectedSampleId === id) {
        setSelectedSampleId(null)
      }
    }
  }

  const handleBatchAddToCollection = (collectionId: number, sampleIds: number[]) => {
    // Add each sample to the collection
    sampleIds.forEach(sliceId => {
      addSliceToCollection.mutate({ collectionId, sliceId })
    })

    // Clear selection after adding
    setSelectedSampleIds(new Set())
  }

  const handlePlayModeChange = () => {
    setPlayMode((prev) => {
      if (prev === 'normal') return 'one-shot'
      if (prev === 'one-shot') return 'reproduce-while-clicking'
      return 'normal'
    })
  }

  const getPlayModeIcon = () => {
    if (playMode === 'one-shot') return <Repeat1 size={16} />
    if (playMode === 'reproduce-while-clicking') return <MousePointerClick size={16} />
    return <Play size={16} />
  }

  const getPlayModeLabel = () => {
    if (playMode === 'one-shot') return 'One-shot'
    if (playMode === 'reproduce-while-clicking') return 'Sample'
    return 'Normal'
  }

  // Get scope label for display
  const getScopeLabel = (): string => {
    switch (currentScope.type) {
      case 'all':
        return 'All Samples'
      case 'youtube':
        return 'YouTube'
      case 'youtube-video':
        const video = sourceTree?.youtube.find(v => v.id === currentScope.trackId)
        return video?.title || 'YouTube Video'
      case 'local':
        return 'Local Samples'
      case 'folder':
        return currentScope.path.split('/').pop() || 'Folder'
      case 'my-folder':
        const collection = collections.find(c => c.id === currentScope.collectionId)
        return collection?.name || 'Folder'
      default:
        return 'Samples'
    }
  }

  return (
    <div className="h-full flex overflow-hidden bg-surface-base">
      {/* Sidebar - Source Tree */}
      <div className="w-64 flex-shrink-0 bg-surface-raised border-r border-surface-border overflow-hidden">
        <SourcesTree
          tree={sourceTree}
          collections={collections}
          currentScope={currentScope}
          onScopeChange={handleScopeChange}
          onCreateCollection={handleCreateCollection}
          onRenameCollection={handleRenameCollection}
          onDeleteCollection={handleDeleteCollection}
          onUpdateCollection={handleUpdateCollection}
          onBatchAddToCollection={handleBatchAddToCollection}
          isLoading={isTreeLoading}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search bar */}
        <div className="p-4 border-b border-surface-border bg-surface-raised">
          <div className="flex items-center gap-4">
            {/* Search input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search in ${getScopeLabel()}...`}
                className="w-full pl-10 pr-4 py-2 bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary transition-colors"
              />
            </div>

            {/* View mode toggle */}
            <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-lg p-0.5">
              <button
                onClick={() => handleViewModeChange('grid')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-accent-primary text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Grid view"
              >
                <LayoutGrid size={16} />
              </button>
              <button
                onClick={() => handleViewModeChange('list')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'list'
                    ? 'bg-accent-primary text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="List view"
              >
                <List size={16} />
              </button>
              <button
                onClick={() => handleViewModeChange('space')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'space'
                    ? 'bg-accent-primary text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Space view"
              >
                <Sparkles size={16} />
              </button>
            </div>

            {/* Favorites toggle */}
            <button
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                showFavoritesOnly
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : 'bg-surface-base text-slate-400 hover:text-slate-300 border border-surface-border'
              }`}
            >
              <Heart size={16} className={showFavoritesOnly ? 'fill-current' : ''} />
              <span className="text-sm">Favorites</span>
            </button>
          </div>

          {/* Tag filter bar */}
          <div className="mt-3">
            <SourcesTagFilter
              selectedTags={selectedTags}
              onTagsChange={setSelectedTags}
              allTags={allTags}
              onCreateTag={handleCreateTag}
              totalCount={totalCount}
              filteredCount={samples.length}
            />
          </div>

          {/* Advanced filters section */}
          <div className="mt-3">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-300 transition-colors"
            >
              <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              <span>Advanced</span>
            </button>

            {showAdvanced && (
              <div className="mt-3 p-2.5 bg-surface-base border border-surface-border rounded-lg">
                <div className="flex items-center gap-4">
                  {/* Duration controls */}
                  <div className="flex items-center gap-3 flex-1 max-w-md">
                    <span className="text-xs text-slate-400 whitespace-nowrap">Duration:</span>
                    <div className="flex-1 flex items-center gap-2">
                      {/* Helper functions for exponential scaling */}
                      {(() => {
                        const MAX_DURATION = 600
                        const EXPONENT = 5.5

                        // Convert slider position (0-100) to actual duration (0-600)
                        const sliderToDuration = (sliderValue: number) => {
                          return MAX_DURATION * Math.pow(sliderValue / 100, EXPONENT)
                        }

                        // Convert actual duration (0-600) to slider position (0-100)
                        const durationToSlider = (duration: number) => {
                          return 100 * Math.pow(Math.min(duration, MAX_DURATION) / MAX_DURATION, 1 / EXPONENT)
                        }

                        const minSlider = durationToSlider(minDuration)
                        const maxSlider = durationToSlider(maxDuration)

                        const isMaxInfinity = maxDuration >= MAX_DURATION

                        return (
                          <>
                            {/* Number inputs */}
                            <input
                              type="number"
                              value={minDuration.toFixed(1)}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0
                                setMinDuration(Math.max(0, Math.min(val, maxDuration)))
                              }}
                              placeholder="Min"
                              className="w-16 px-1.5 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary no-spinner"
                              step="0.1"
                              min="0"
                              max={maxDuration}
                            />

                            {/* Dual slider */}
                            <div className="flex-1 relative h-6 flex items-center min-w-[120px]">
                              {/* Track background */}
                              <div className="absolute left-0 right-0 h-0.5 bg-surface-raised rounded-full" />

                              {/* Active range */}
                              <div
                                className="absolute h-0.5 bg-accent-primary rounded-full pointer-events-none"
                                style={{
                                  left: `${minSlider}%`,
                                  right: `${100 - maxSlider}%`,
                                }}
                              />

                              {/* Min handle */}
                              <input
                                type="range"
                                min={0}
                                max={100}
                                step={0.1}
                                value={minSlider}
                                onChange={(e) => {
                                  const newSliderMin = parseFloat(e.target.value)
                                  const newDuration = sliderToDuration(newSliderMin)
                                  setMinDuration(Math.min(newDuration, maxDuration))
                                }}
                                className="absolute w-full h-6 appearance-none bg-transparent cursor-pointer slider-thumb"
                                style={{ zIndex: minSlider > maxSlider - 2 ? 5 : 3 }}
                              />

                              {/* Max handle */}
                              <input
                                type="range"
                                min={0}
                                max={100}
                                step={0.1}
                                value={maxSlider}
                                onChange={(e) => {
                                  const newSliderMax = parseFloat(e.target.value)
                                  const newDuration = sliderToDuration(newSliderMax)
                                  setMaxDuration(Math.max(newDuration, minDuration))
                                }}
                                className="absolute w-full h-6 appearance-none bg-transparent cursor-pointer slider-thumb"
                                style={{ zIndex: maxSlider < minSlider + 2 ? 5 : 4 }}
                              />
                            </div>

                            {isMaxInfinity ? (
                              <div className="w-16 px-1.5 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-center text-white flex items-center justify-center">
                                ∞
                              </div>
                            ) : (
                              <input
                                type="number"
                                value={maxDuration.toFixed(1)}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0
                                  setMaxDuration(Math.max(minDuration, Math.min(val, MAX_DURATION)))
                                }}
                                placeholder="Max"
                                className="w-16 px-1.5 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary no-spinner"
                                step="0.1"
                                min={minDuration}
                                max={MAX_DURATION}
                              />
                            )}
                            <span className="text-xs text-slate-500 whitespace-nowrap">sec</span>
                          </>
                        )
                      })()}
                    </div>
                  </div>

                  {/* Separator */}
                  <div className="h-5 w-px bg-surface-border" />

                  {/* Play mode selector */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePlayModeChange}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-raised border border-surface-border rounded-lg text-xs text-white hover:bg-surface-base transition-colors"
                      title="Click to cycle through play modes"
                    >
                      {getPlayModeIcon()}
                      <span>{getPlayModeLabel()}</span>
                    </button>

                    {/* Loop toggle */}
                    <button
                      onClick={() => setLoopEnabled(!loopEnabled)}
                      disabled={playMode === 'one-shot'}
                      className={`flex items-center gap-1.5 px-2.5 py-1 border rounded-lg text-xs transition-colors ${
                        playMode === 'one-shot'
                          ? 'bg-surface-raised border-surface-border text-slate-600 cursor-not-allowed'
                          : loopEnabled
                          ? 'bg-accent-primary border-accent-primary text-white'
                          : 'bg-surface-raised border-surface-border text-white hover:bg-surface-base'
                      }`}
                      title={playMode === 'one-shot' ? 'Loop not available in one-shot mode' : loopEnabled ? 'Loop enabled' : 'Loop disabled'}
                    >
                      <Repeat size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Batch actions bar */}
        {selectedSampleIds.size > 0 && (
          <SourcesBatchActions
            selectedCount={selectedSampleIds.size}
            selectedIds={selectedSampleIds}
            onBatchDelete={handleBatchDelete}
            onBatchDownload={handleBatchDownload}
            onClearSelection={() => setSelectedSampleIds(new Set())}
            isDeleting={batchDeleteSlices.isPending}
          />
        )}

        {/* Sample grid/list */}
        <div className="flex-1 overflow-hidden">
          {currentScope.type === 'youtube' ? (
            // YouTube grouped view
            viewMode === 'grid' ? (
              <div className="overflow-y-auto h-full">
                <SourcesYouTubeGroupedGrid
                  samples={samples}
                  selectedId={selectedSampleId}
                  selectedIds={selectedSampleIds}
                  onSelect={setSelectedSampleId}
                  onToggleSelect={handleToggleSelect}
                  onToggleSelectAll={handleToggleSelectAll}
                  onToggleFavorite={handleToggleFavorite}
                  onTagClick={handleTagClick}
                  isLoading={isSamplesLoading}
                  playMode={playMode}
                  loopEnabled={loopEnabled}
                />
              </div>
            ) : viewMode === 'list' ? (
              <SourcesYouTubeGroupedList
                samples={samples}
                selectedId={selectedSampleId}
                selectedIds={selectedSampleIds}
                onSelect={setSelectedSampleId}
                onToggleSelect={handleToggleSelect}
                onToggleSelectAll={handleToggleSelectAll}
                onToggleFavorite={handleToggleFavorite}
                onUpdateName={handleUpdateName}
                onDelete={handleDeleteSingle}
                onTagClick={handleTagClick}
                isLoading={isSamplesLoading}
                playMode={playMode}
                loopEnabled={loopEnabled}
              />
            ) : (
              <SampleSpaceView
                externalFilterState={spaceViewFilterState}
                selectedSliceId={selectedSampleId}
                onSliceSelect={setSelectedSampleId}
              />
            )
          ) : (
            // Standard view for all other scopes
            viewMode === 'grid' ? (
              <div className="overflow-y-auto h-full">
                <SourcesSampleGrid
                  samples={samples}
                  selectedId={selectedSampleId}
                  selectedIds={selectedSampleIds}
                  onSelect={setSelectedSampleId}
                  onToggleSelect={handleToggleSelect}
                  onToggleSelectAll={handleToggleSelectAll}
                  onToggleFavorite={handleToggleFavorite}
                  onTagClick={handleTagClick}
                  isLoading={isSamplesLoading}
                  playMode={playMode}
                  loopEnabled={loopEnabled}
                />
              </div>
            ) : viewMode === 'list' ? (
              <SourcesSampleList
                samples={samples}
                selectedId={selectedSampleId}
                selectedIds={selectedSampleIds}
                onSelect={setSelectedSampleId}
                onToggleSelect={handleToggleSelect}
                onToggleSelectAll={handleToggleSelectAll}
                onToggleFavorite={handleToggleFavorite}
                onUpdateName={handleUpdateName}
                onDelete={handleDeleteSingle}
                onTagClick={handleTagClick}
                isLoading={isSamplesLoading}
                playMode={playMode}
                loopEnabled={loopEnabled}
              />
            ) : (
              <SampleSpaceView
                externalFilterState={spaceViewFilterState}
                selectedSliceId={selectedSampleId}
                onSliceSelect={setSelectedSampleId}
              />
            )
          )}
        </div>
      </div>

      {/* Sample Detail Modal */}
      {selectedSample && (
        <SourcesDetailModal
          sample={selectedSample}
          allTags={allTags}
          collections={collections}
          onClose={() => setSelectedSampleId(null)}
          onToggleFavorite={handleToggleFavorite}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onAddToCollection={handleAddToCollection}
          onRemoveFromCollection={handleRemoveFromCollection}
          onUpdateName={handleUpdateName}
          onEdit={() => setEditingTrackId(selectedSample.trackId)}
          onTagClick={handleTagClick}
        />
      )}

      {/* Editing Modal */}
      {editingTrackId !== null && (
        <EditingModal
          trackId={editingTrackId}
          onClose={() => setEditingTrackId(null)}
        />
      )}
    </div>
  )
}
