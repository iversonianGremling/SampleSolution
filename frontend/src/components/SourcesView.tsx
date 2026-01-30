import { useState, useMemo } from 'react'
import { Search, Heart, LayoutGrid, List } from 'lucide-react'
import { SourcesTree } from './SourcesTree'
import { SourcesTagFilter } from './SourcesTagFilter'
import { SourcesSampleGrid } from './SourcesSampleGrid'
import { SourcesSampleList } from './SourcesSampleList'
import { SourcesBatchActions } from './SourcesBatchActions'
import { SourcesDetailModal } from './SourcesDetailModal'
import { EditingModal } from './EditingModal'
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

export function SourcesView() {
  // State
  const [currentScope, setCurrentScope] = useState<SourceScope>({ type: 'all' })
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [selectedSampleId, setSelectedSampleId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedSampleIds, setSelectedSampleIds] = useState<Set<number>>(new Set())
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null)

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
  const samples = samplesData?.samples || []
  const totalCount = samplesData?.total || 0

  const selectedSample = useMemo<SliceWithTrackExtended | null>(() => {
    if (!selectedSampleId) return null
    return samples.find(s => s.id === selectedSampleId) || null
  }, [selectedSampleId, samples])

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

  const handleViewModeChange = (mode: 'grid' | 'list') => {
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
          {viewMode === 'grid' ? (
            <div className="overflow-y-auto h-full">
              <SourcesSampleGrid
                samples={samples}
                selectedId={selectedSampleId}
                selectedIds={selectedSampleIds}
                onSelect={setSelectedSampleId}
                onToggleSelect={handleToggleSelect}
                onToggleSelectAll={handleToggleSelectAll}
                onToggleFavorite={handleToggleFavorite}
                isLoading={isSamplesLoading}
              />
            </div>
          ) : (
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
              isLoading={isSamplesLoading}
            />
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
