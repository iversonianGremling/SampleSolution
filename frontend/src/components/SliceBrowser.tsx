import { useState, useRef, useEffect } from 'react'
import {
  Play,
  Pause,
  Download,
  Sparkles,
  Loader2,
  X,
  ChevronDown,
  Star,
  Folder,
  FolderPlus,
  Check,
  Trash2,
  Pencil,
} from 'lucide-react'
import {
  useAllSlices,
  useTags,
  useAddTagToSlice,
  useRemoveTagFromSlice,
  useGenerateAiTagsForSlice,
  useToggleFavorite,
  useCollections,
  useCreateCollection,
  useAddSliceToCollection,
  useRemoveSliceFromCollection,
  useCreateTag,
  useBatchGenerateAiTags,
  useDeleteSliceGlobal,
  useBatchDeleteSlices,
  useUpdateSliceGlobal,
  useUpdateTrack,
} from '../hooks/useTracks'
import { useFilteredSlices } from '../hooks/useSliceFilters'
import { getSliceDownloadUrl } from '../api/client'
import { TagSearchInput } from './TagSearchInput'
import { SliceFilterPanel } from './SliceFilterPanel'
import type { SliceWithTrack, Tag, Collection } from '../types'

export function SliceBrowser() {
  // Data fetching
  const { data: slices, isLoading: slicesLoading } = useAllSlices()

  // Filter controls
  const {
    filterState,
    setSearchQuery,
    setSelectedTags,
    setMinDuration,
    setMaxDuration,
    setShowFavoritesOnly,
    setSelectedCollectionId,
    setSelectedTrackId,
    filteredItems: filteredSlices,
    maxSliceDuration,
  } = useFilteredSlices(slices)

  const { selectedTags, showFavoritesOnly, selectedCollectionId, selectedTrackId } = filterState

  // Audio playback
  const [playingSliceId, setPlayingSliceId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Dropdown states
  const [openCollectionDropdown, setOpenCollectionDropdown] = useState<number | null>(null)

  // Collection creation
  const [showNewCollection, setShowNewCollection] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')

  // Export state (for future use)

  // Batch selection state
  const [selectedSliceIds, setSelectedSliceIds] = useState<Set<number>>(new Set())

  // Data fetching
  const { data: allTags } = useTags()
  const { data: collections } = useCollections()
  const addTagToSlice = useAddTagToSlice()
  const removeTagFromSlice = useRemoveTagFromSlice()
  const toggleFavorite = useToggleFavorite()
  const createCollection = useCreateCollection()
  const addSliceToCollection = useAddSliceToCollection()
  const removeSliceFromCollection = useRemoveSliceFromCollection()
  const batchGenerateAiTags = useBatchGenerateAiTags()
  const batchDeleteSlices = useBatchDeleteSlices()
  const deleteSlice = useDeleteSliceGlobal()
  const updateSlice = useUpdateSliceGlobal()
  const updateTrack = useUpdateTrack()

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  // Format time as mm:ss.cc
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const cs = Math.floor((seconds % 1) * 100)
    return `${mins}:${secs.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
  }

  // Play/pause slice
  const handlePlay = (slice: SliceWithTrack) => {
    if (playingSliceId === slice.id) {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      setPlayingSliceId(null)
    } else {
      if (audioRef.current) {
        audioRef.current.pause()
      }
      const audio = new Audio(getSliceDownloadUrl(slice.id))
      audio.onended = () => setPlayingSliceId(null)
      audio.play()
      audioRef.current = audio
      setPlayingSliceId(slice.id)
    }
  }

  // Toggle tag in filter
  const toggleTagFilter = (tagId: number) => {
    const newTags = selectedTags.includes(tagId)
      ? selectedTags.filter((id) => id !== tagId)
      : [...selectedTags, tagId]
    setSelectedTags(newTags)
  }

  // Add tag to slice
  const handleAddTag = (sliceId: number, tagId: number) => {
    addTagToSlice.mutate({ sliceId, tagId })
  }

  // Create tag hook
  const createTag = useCreateTag()

  // Remove tag from slice
  const handleRemoveTag = (sliceId: number, tagId: number) => {
    removeTagFromSlice.mutate({ sliceId, tagId })
  }

  // Get tags not already on slice
  const getAvailableTags = (slice: SliceWithTrack) => {
    const sliceTagIds = slice.tags.map((t) => t.id)
    return (allTags || []).filter((t) => !sliceTagIds.includes(t.id))
  }

  // Handle creating new collection
  const handleCreateCollection = () => {
    if (newCollectionName.trim()) {
      createCollection.mutate({ name: newCollectionName.trim() })
      setNewCollectionName('')
      setShowNewCollection(false)
    }
  }

  const favoritesCount = slices?.filter((s) => s.favorite).length || 0

  return (
    <div className="space-y-4">
      {/* Collections Section */}
      <div className="bg-gray-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Folder size={18} />
            Collections
          </h2>
          <button
            onClick={() => setShowNewCollection(!showNewCollection)}
            className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
          >
            <FolderPlus size={14} />
            New
          </button>
        </div>

        {showNewCollection && (
          <div className="flex gap-2">
            <input
              type="text"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder="Collection name..."
              className="flex-1 px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
            />
            <button
              onClick={handleCreateCollection}
              disabled={!newCollectionName.trim()}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 text-white text-sm rounded"
            >
              Create
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setSelectedCollectionId(null)
              setShowFavoritesOnly(false)
            }}
            className={`px-3 py-1.5 rounded text-sm transition-all ${
              selectedCollectionId === null && !showFavoritesOnly
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            All ({slices?.length || 0})
          </button>
          <button
            onClick={() => {
              setShowFavoritesOnly(true)
              setSelectedCollectionId(null)
            }}
            className={`px-3 py-1.5 rounded text-sm transition-all flex items-center gap-1 ${
              showFavoritesOnly
                ? 'bg-yellow-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <Star size={14} className={showFavoritesOnly ? 'fill-current' : ''} />
            Favorites ({favoritesCount})
          </button>
          {(collections || []).map((col) => (
            <button
              key={col.id}
              onClick={() => {
                setSelectedCollectionId(col.id)
                setShowFavoritesOnly(false)
              }}
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
              {col.name} ({col.sliceCount})
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <SliceFilterPanel
        filterState={filterState}
        onSearchChange={setSearchQuery}
        onFavoritesChange={setShowFavoritesOnly}
        onTrackFilterChange={setSelectedTrackId}
        onTagFilterChange={toggleTagFilter}
        onTagFilterClear={() => setSelectedTags([])}
        onDurationChange={(min, max) => {
          setMinDuration(min)
          setMaxDuration(max)
        }}
        allTags={allTags}
        maxDuration={maxSliceDuration}
        sliceTrackTitle={slices?.find(s => s.trackId === selectedTrackId)?.track.title}
        formatTime={formatTime}
      />

      {/* Results */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-white">
              Samples ({filteredSlices.length})
            </h2>
            {filteredSlices.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedSliceIds.size === filteredSlices.length && filteredSlices.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedSliceIds(new Set(filteredSlices.map((s) => s.id)))
                    } else {
                      setSelectedSliceIds(new Set())
                    }
                  }}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                />
                Select all
              </label>
            )}
          </div>
          {selectedSliceIds.size > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  batchGenerateAiTags.mutate(Array.from(selectedSliceIds), {
                    onSuccess: () => setSelectedSliceIds(new Set()),
                  })
                }}
                disabled={batchGenerateAiTags.isPending}
                className="flex items-center gap-2 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-700 text-white text-sm rounded-lg transition-colors"
              >
                {batchGenerateAiTags.isPending ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <Sparkles size={14} />
                )}
                Tag {selectedSliceIds.size} with AI
              </button>
              <button
                onClick={() => {
                  // Create a zip file with selected slices
                  const selectedSlices = filteredSlices.filter((s) => selectedSliceIds.has(s.id))
                  selectedSlices.forEach((slice) => {
                    const link = document.createElement('a')
                    link.href = getSliceDownloadUrl(slice.id)
                    link.download = `${slice.name}.mp3`
                    document.body.appendChild(link)
                    link.click()
                    document.body.removeChild(link)
                  })
                }}
                disabled={selectedSliceIds.size === 0}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white text-sm rounded-lg transition-colors"
              >
                <Download size={14} />
                Download {selectedSliceIds.size}
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete ${selectedSliceIds.size} selected samples? This cannot be undone.`)) {
                    batchDeleteSlices.mutate(Array.from(selectedSliceIds), {
                      onSuccess: () => setSelectedSliceIds(new Set()),
                    })
                  }
                }}
                disabled={batchDeleteSlices.isPending}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white text-sm rounded-lg transition-colors"
              >
                {batchDeleteSlices.isPending ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <Trash2 size={14} />
                )}
                Delete {selectedSliceIds.size}
              </button>
            </div>
          )}
        </div>

        {slicesLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="animate-spin mx-auto text-indigo-500" size={32} />
          </div>
        ) : filteredSlices.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {slices && slices.length > 0
              ? 'No samples match your filters'
              : 'No samples yet. Create slices from your tracks.'}
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {filteredSlices.map((slice) => (
              <SliceRow
                key={slice.id}
                slice={slice}
                isPlaying={playingSliceId === slice.id}
                isSelected={selectedSliceIds.has(slice.id)}
                onToggleSelect={() => {
                  setSelectedSliceIds((prev) => {
                    const next = new Set(prev)
                    if (next.has(slice.id)) {
                      next.delete(slice.id)
                    } else {
                      next.add(slice.id)
                    }
                    return next
                  })
                }}
                onPlay={() => handlePlay(slice)}
                formatTime={formatTime}
                availableTags={getAvailableTags(slice)}
                collections={collections || []}
                isCollectionDropdownOpen={openCollectionDropdown === slice.id}
                onToggleCollectionDropdown={() =>
                  setOpenCollectionDropdown(openCollectionDropdown === slice.id ? null : slice.id)
                }
                onAddTag={(tagId) => handleAddTag(slice.id, tagId)}
                onRemoveTag={(tagId) => handleRemoveTag(slice.id, tagId)}
                onCreateTag={async (name, color) => {
                  const newTag = await createTag.mutateAsync({ name, color })
                  handleAddTag(slice.id, newTag.id)
                }}
                isCreatingTag={createTag.isPending}
                onToggleFavorite={() => toggleFavorite.mutate(slice.id)}
                onAddToCollection={(collectionId) => {
                  addSliceToCollection.mutate({ collectionId, sliceId: slice.id })
                  setOpenCollectionDropdown(null)
                }}
                onRemoveFromCollection={(collectionId) => {
                  removeSliceFromCollection.mutate({ collectionId, sliceId: slice.id })
                }}
                onDelete={() => {
                  if (confirm(`Delete "${slice.name}"? This will also delete the audio file.`)) {
                    deleteSlice.mutate(slice.id)
                  }
                }}
                isDeleting={deleteSlice.isPending}
                onUpdateSliceName={(name) => updateSlice.mutate({ id: slice.id, data: { name } })}
                onUpdateTrackTitle={(title) => updateTrack.mutate({ id: slice.trackId, data: { title } })}
                onFilterByTrack={() => setSelectedTrackId(slice.trackId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface SliceRowProps {
  slice: SliceWithTrack
  isPlaying: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onPlay: () => void
  formatTime: (s: number) => string
  availableTags: Tag[]
  collections: Collection[]
  isCollectionDropdownOpen: boolean
  onToggleCollectionDropdown: () => void
  onAddTag: (tagId: number) => void
  onRemoveTag: (tagId: number) => void
  onCreateTag: (name: string, color: string) => Promise<void>
  isCreatingTag: boolean
  onToggleFavorite: () => void
  onAddToCollection: (collectionId: number) => void
  onRemoveFromCollection: (collectionId: number) => void
  onDelete: () => void
  isDeleting: boolean
  onUpdateSliceName: (name: string) => void
  onUpdateTrackTitle: (title: string) => void
  onFilterByTrack: () => void
}

function SliceRow({
  slice,
  isPlaying,
  isSelected,
  onToggleSelect,
  onPlay,
  formatTime,
  availableTags,
  collections,
  isCollectionDropdownOpen,
  onToggleCollectionDropdown,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  isCreatingTag,
  onToggleFavorite,
  onAddToCollection,
  onRemoveFromCollection,
  onDelete,
  isDeleting,
  onUpdateSliceName,
  onUpdateTrackTitle,
  onFilterByTrack,
}: SliceRowProps) {
  const generateAiTags = useGenerateAiTagsForSlice(slice.trackId)
  const duration = slice.endTime - slice.startTime

  // Editing state
  const [isEditingName, setIsEditingName] = useState(false)
  const [editingName, setEditingName] = useState(slice.name)
  const [isEditingTrack, setIsEditingTrack] = useState(false)
  const [editingTrack, setEditingTrack] = useState(slice.track.title)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const trackInputRef = useRef<HTMLInputElement>(null)

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
    
  }, [isEditingName])
  useEffect(() => {
    if (isEditingTrack && trackInputRef.current) {
      trackInputRef.current.focus()
      trackInputRef.current.select()
    }
  }, [isEditingTrack])

  const saveSliceName = () => {
    if (editingName.trim() && editingName !== slice.name) {
      onUpdateSliceName(editingName.trim())
    }
    setIsEditingName(false)
  }

  const saveTrackTitle = () => {
    if (editingTrack.trim() && editingTrack !== slice.track.title) {
      onUpdateTrackTitle(editingTrack.trim())
    }
    setIsEditingTrack(false)
  }

  const availableCollections = collections.filter((c) => !slice.collectionIds.includes(c.id))
  const sliceCollections = collections.filter((c) => slice.collectionIds.includes(c.id))

  return (
    <div className={`px-4 py-3 hover:bg-gray-700/30 transition-colors ${isSelected ? 'bg-indigo-900/20' : ''}`}>
      {/* Main row */}
      <div className="flex items-center gap-3">
        {/* Selection checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
        />

        {/* Favorite button */}
        <button
          onClick={onToggleFavorite}
          className={`p-1 transition-colors ${
            slice.favorite
              ? 'text-yellow-400'
              : 'text-gray-500 hover:text-yellow-400'
          }`}
          title={slice.favorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={16} className={slice.favorite ? 'fill-current' : ''} />
        </button>

        {/* Play button */}
        <button
          onClick={onPlay}
          className={`p-2 rounded-full transition-colors ${
            isPlaying
              ? 'bg-green-600 text-white'
              : 'text-gray-400 hover:text-green-400 hover:bg-gray-700'
          }`}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {isEditingName ? (
            <div className="flex items-center gap-2">
              <input
                ref={nameInputRef}
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveSliceName()
                  if (e.key === 'Escape') setIsEditingName(false)
                }}
                onBlur={saveSliceName}
                className="flex-1 px-2 py-0.5 bg-gray-900 border border-indigo-500 rounded text-white text-sm focus:outline-none"
              />
            </div>
          ) : (
            <div
              className="group flex items-center gap-1 cursor-pointer"
              onClick={() => {
                setEditingName(slice.name)
                setIsEditingName(true)
              }}
            >
              <span className="font-medium text-white truncate">{slice.name}</span>
              <Pencil size={12} className="text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </div>
          )}
          {isEditingTrack ? (
            <div className="flex items-center gap-2 mt-0.5">
              <input
                ref={trackInputRef}
                type="text"
                value={editingTrack}
                onChange={(e) => setEditingTrack(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTrackTitle()
                  if (e.key === 'Escape') setIsEditingTrack(false)
                }}
                onBlur={saveTrackTitle}
                className="flex-1 px-2 py-0.5 bg-gray-900 border border-indigo-500 rounded text-gray-300 text-sm focus:outline-none"
              />
              <button
                onClick={saveTrackTitle}
                className="p-1 text-green-400 hover:text-green-300"
                title="Save"
              >
                <Check size={14} />
              </button>
              <button
                onClick={() => setIsEditingTrack(false)}
                className="p-1 text-gray-400 hover:text-gray-300"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="group flex items-center gap-1">
              <span
                className="text-sm text-gray-400 truncate cursor-pointer hover:text-indigo-400 transition-colors"
                onClick={onFilterByTrack}
                title="Filter by this track"
              >
                {slice.track.title}
              </span>
              <button
                onClick={() => {
                  setEditingTrack(slice.track.title)
                  setIsEditingTrack(true)
                }}
                className="p-0.5 text-gray-500 opacity-0 group-hover:opacity-100 hover:text-white transition-all flex-shrink-0"
                title="Edit track title"
              >
                <Pencil size={10} />
              </button>
            </div>
          )}
        </div>

        {/* Duration */}
        <div className="text-sm text-gray-400 tabular-nums">
          {formatTime(duration)}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => generateAiTags.mutate(slice.id)}
            disabled={generateAiTags.isPending}
            className="p-2 text-gray-400 hover:text-yellow-400 transition-colors"
            title="Generate AI tags"
          >
            {generateAiTags.isPending ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Sparkles size={16} />
            )}
          </button>
          <a
            href={getSliceDownloadUrl(slice.id)}
            download
            className="p-2 text-gray-400 hover:text-blue-400 transition-colors"
            title="Download"
          >
            <Download size={16} />
          </a>
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="p-2 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
            title="Delete slice"
          >
            {isDeleting ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Trash2 size={16} />
            )}
          </button>
        </div>
      </div>

      {/* Tags and Collections row */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {/* Collection badges */}
        {sliceCollections.map((col) => (
          <span
            key={col.id}
            className="group inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
            style={{ backgroundColor: col.color + '40', color: col.color }}
          >
            <Folder size={10} />
            {col.name}
            <button
              onClick={() => onRemoveFromCollection(col.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/20 rounded"
              title="Remove from collection"
            >
              <X size={12} />
            </button>
          </span>
        ))}

        {/* Tags */}
        {slice.tags.map((tag) => (
          <span
            key={tag.id}
            className="group inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
            style={{ backgroundColor: tag.color + '40', color: tag.color }}
          >
            {tag.name}
            <button
              onClick={() => onRemoveTag(tag.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/20 rounded"
              title="Remove tag"
            >
              <X size={12} />
            </button>
          </span>
        ))}

        {/* Add to collection button */}
        <div className="relative">
          <button
            onClick={onToggleCollectionDropdown}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            <FolderPlus size={12} />
            Collection
            <ChevronDown size={12} />
          </button>

          {isCollectionDropdownOpen && (
            <div className="absolute left-0 bottom-full mb-1 z-10 w-48 max-h-48 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl">
              {availableCollections.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">No collections available</div>
              ) : (
                availableCollections.map((col) => (
                  <button
                    key={col.id}
                    onClick={() => onAddToCollection(col.id)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700 transition-colors flex items-center gap-2"
                  >
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: col.color }}
                    />
                    <span style={{ color: col.color }}>{col.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Add tag search input */}
        <TagSearchInput
          availableTags={availableTags}
          onAddTag={onAddTag}
          onCreateTag={onCreateTag}
          isCreatingTag={isCreatingTag}
        />
      </div>
    </div>
  )
}
