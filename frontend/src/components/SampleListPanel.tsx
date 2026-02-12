import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Play,
  Pause,
  Download,
  Sparkles,
  Loader2,
  X,
  ChevronDown,
  Star,
  Folder as FolderIcon,
  FolderPlus,
  Trash2,
  Pencil,
} from 'lucide-react'
import {
  useTags,
  useAddTagToSlice,
  useRemoveTagFromSlice,
  useGenerateAiTagsForSlice,
  useToggleFavorite,
  useFolders,
  useAddSliceToFolder,
  useRemoveSliceFromFolder,
  useCreateTag,
  useBatchGenerateAiTags,
  useDeleteSliceGlobal,
  useBatchDeleteSlices,
  useUpdateSliceGlobal,
  useUpdateTrack,
} from '../hooks/useTracks'
import { getSliceDownloadUrl } from '../api/client'
import { TagSearchInput } from './TagSearchInput'
import { CompactSliceRow } from './CompactSliceRow'
import type { SliceWithTrack, Tag, Folder } from '../types'

interface SampleListPanelProps {
  slices: SliceWithTrack[]
  isLoading: boolean
  isEditMode: boolean
  selectedSliceId: number | null
  onSliceSelect: (id: number) => void
  onToggleEditMode: () => void
}

export function SampleListPanel({
  slices,
  isLoading,
  isEditMode,
  selectedSliceId,
  onSliceSelect,
  onToggleEditMode,
}: SampleListPanelProps) {
  // Audio playback
  const [playingSliceId, setPlayingSliceId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Dropdown states
  const [openFolderDropdown, setOpenFolderDropdown] = useState<number | null>(null)

  // Batch selection state (works in both modes)
  const [selectedSliceIds, setSelectedSliceIds] = useState<Set<number>>(new Set())

  // Pagination state with intelligent sizing
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)

  // Scroll container ref
  const listContainerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Intelligent pagination: calculate items per page based on container height
  useEffect(() => {
    const calculateItemsPerPage = () => {
      if (!listContainerRef.current) return

      const containerHeight = listContainerRef.current.clientHeight
      // Estimate row height: ~44px for compact row (with tags), ~36px without tags
      const estimatedRowHeight = 44
      // Calculate how many items fit, with a minimum of 5
      const calculatedItems = Math.max(5, Math.floor(containerHeight / estimatedRowHeight))
      setItemsPerPage(calculatedItems)
    }

    calculateItemsPerPage()

    // Recalculate on resize
    const resizeObserver = new ResizeObserver(calculateItemsPerPage)
    if (listContainerRef.current) {
      resizeObserver.observe(listContainerRef.current)
    }

    return () => resizeObserver.disconnect()
  }, [])

  // Reset pagination when slices change
  useEffect(() => {
    setCurrentPage(1)
  }, [slices.length])

  // Clear selection when slices change significantly (e.g., filter changes)
  useEffect(() => {
    setSelectedSliceIds((prev) => {
      const sliceIdSet = new Set(slices.map(s => s.id))
      const filtered = new Set([...prev].filter(id => sliceIdSet.has(id)))
      return filtered.size === prev.size ? prev : filtered
    })
  }, [slices])

  // Calculate paginated slices
  const totalPages = Math.ceil(slices.length / itemsPerPage)
  const paginatedSlices = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return slices.slice(startIndex, startIndex + itemsPerPage)
  }, [slices, currentPage, itemsPerPage])

  // Toggle batch selection for a single item
  const toggleBatchSelect = (sliceId: number) => {
    setSelectedSliceIds((prev) => {
      const next = new Set(prev)
      if (next.has(sliceId)) {
        next.delete(sliceId)
      } else {
        next.add(sliceId)
      }
      return next
    })
  }

  // Select/deselect all
  const toggleSelectAll = () => {
    if (selectedSliceIds.size === slices.length && slices.length > 0) {
      setSelectedSliceIds(new Set())
    } else {
      setSelectedSliceIds(new Set(slices.map((s) => s.id)))
    }
  }

  // Scroll to selected item when selection changes externally
  useEffect(() => {
    if (selectedSliceId !== null) {
      // Find which page the selected slice is on
      const sliceIndex = slices.findIndex(s => s.id === selectedSliceId)
      if (sliceIndex >= 0) {
        const targetPage = Math.floor(sliceIndex / itemsPerPage) + 1
        if (targetPage !== currentPage) {
          setCurrentPage(targetPage)
        }
        // Scroll to the item after a short delay to allow pagination update
        setTimeout(() => {
          const rowElement = rowRefs.current.get(selectedSliceId)
          if (rowElement) {
            rowElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          }
        }, 50)
      }
    }
  }, [selectedSliceId, slices, currentPage, itemsPerPage])

  // Data fetching
  const { data: allTags } = useTags()
  const { data: folders } = useFolders()
  const addTagToSlice = useAddTagToSlice()
  const removeTagFromSlice = useRemoveTagFromSlice()
  const toggleFavorite = useToggleFavorite()
  const addSliceToFolder = useAddSliceToFolder()
  const removeSliceFromFolder = useRemoveSliceFromFolder()
  const batchGenerateAiTags = useBatchGenerateAiTags()
  const batchDeleteSlices = useBatchDeleteSlices()
  const deleteSlice = useDeleteSliceGlobal()
  const updateSlice = useUpdateSliceGlobal()
  const updateTrack = useUpdateTrack()
  const createTag = useCreateTag()

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

  // Add tag to slice
  const handleAddTag = (sliceId: number, tagId: number) => {
    addTagToSlice.mutate({ sliceId, tagId })
  }

  // Remove tag from slice
  const handleRemoveTag = (sliceId: number, tagId: number) => {
    removeTagFromSlice.mutate({ sliceId, tagId })
  }

  // Get tags not already on slice
  const getAvailableTags = (slice: SliceWithTrack) => {
    const sliceTagIds = slice.tags.map((t) => t.id)
    return (allTags || []).filter((t) => !sliceTagIds.includes(t.id))
  }

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-white text-sm">
            Samples ({slices.length})
          </h2>
          {slices.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedSliceIds.size === slices.length && slices.length > 0}
                onChange={toggleSelectAll}
                className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
              />
              All
            </label>
          )}
          {selectedSliceIds.size > 0 && (
            <span className="text-xs text-indigo-400">
              ({selectedSliceIds.size} selected)
            </span>
          )}
        </div>
        <button
          onClick={onToggleEditMode}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${
            isEditMode
              ? 'bg-indigo-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          <Pencil size={12} />
          {isEditMode ? 'Done' : 'Edit'}
        </button>
      </div>

      {/* Batch actions (available in both modes when items selected) */}
      {selectedSliceIds.size > 0 && (
        <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-2 flex-shrink-0 bg-gray-800/50">
          <button
            onClick={() => {
              batchGenerateAiTags.mutate(Array.from(selectedSliceIds), {
                onSuccess: (result) => {
                  if (result.warnings && result.warnings.totalWithWarnings > 0) {
                    const preview = result.warnings.messages.slice(0, 3)
                    const extra = Math.max(0, result.warnings.messages.length - preview.length)
                    const details = preview.map((m) => `• ${m}`).join('\n')
                    window.alert(
                      [
                        `Warning: ${result.warnings.totalWithWarnings} sample(s) had potential custom state before analysis.`,
                        details,
                        extra > 0 ? `...and ${extra} more warning(s).` : '',
                      ]
                        .filter(Boolean)
                        .join('\n')
                    )
                  }
                  setSelectedSliceIds(new Set())
                },
              })
            }}
            disabled={batchGenerateAiTags.isPending}
            className="flex items-center gap-1 px-2 py-1 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-700 text-white text-xs rounded transition-colors"
          >
            {batchGenerateAiTags.isPending ? (
              <Loader2 className="animate-spin" size={12} />
            ) : (
              <Sparkles size={12} />
            )}
            Tag {selectedSliceIds.size}
          </button>
          <button
            onClick={() => {
              const selectedSlices = slices.filter((s) => selectedSliceIds.has(s.id))
              selectedSlices.forEach((slice) => {
                const link = document.createElement('a')
                link.href = getSliceDownloadUrl(slice.id)
                link.download = `${slice.name}.mp3`
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
              })
            }}
            className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
          >
            <Download size={12} />
            Download
          </button>
          <button
            onClick={() => {
              if (confirm(`Delete ${selectedSliceIds.size} selected samples?`)) {
                batchDeleteSlices.mutate(Array.from(selectedSliceIds), {
                  onSuccess: () => setSelectedSliceIds(new Set()),
                })
              }
            }}
            disabled={batchDeleteSlices.isPending}
            className="flex items-center gap-1 px-2 py-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white text-xs rounded transition-colors"
          >
            {batchDeleteSlices.isPending ? (
              <Loader2 className="animate-spin" size={12} />
            ) : (
              <Trash2 size={12} />
            )}
            Delete
          </button>
        </div>
      )}

      {/* List */}
      <div ref={listContainerRef} className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="p-6 text-center">
            <Loader2 className="animate-spin mx-auto text-indigo-500" size={24} />
          </div>
        ) : slices.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">
            No samples match your filters
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {paginatedSlices.map((slice) => (
              <div
                key={slice.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(slice.id, el)
                  else rowRefs.current.delete(slice.id)
                }}
              >
                {isEditMode ? (
                  <EditableSliceRow
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
                    folders={folders || []}
                    isFolderDropdownOpen={openFolderDropdown === slice.id}
                    onToggleFolderDropdown={() =>
                      setOpenFolderDropdown(openFolderDropdown === slice.id ? null : slice.id)
                    }
                    onAddTag={(tagId) => handleAddTag(slice.id, tagId)}
                    onRemoveTag={(tagId) => handleRemoveTag(slice.id, tagId)}
                    onCreateTag={async (name, color) => {
                      const newTag = await createTag.mutateAsync({ name, color })
                      handleAddTag(slice.id, newTag.id)
                    }}
                    isCreatingTag={createTag.isPending}
                    onToggleFavorite={() => toggleFavorite.mutate(slice.id)}
                    onAddToFolder={(folderId) => {
                      addSliceToFolder.mutate({ folderId, sliceId: slice.id })
                      setOpenFolderDropdown(null)
                    }}
                    onRemoveFromFolder={(folderId) => {
                      removeSliceFromFolder.mutate({ folderId, sliceId: slice.id })
                    }}
                    onDelete={() => {
                      if (confirm(`Delete "${slice.name}"?`)) {
                        deleteSlice.mutate(slice.id)
                      }
                    }}
                    isDeleting={deleteSlice.isPending}
                    onUpdateSliceName={(name) => updateSlice.mutate({ id: slice.id, data: { name } })}
                    onUpdateTrackTitle={(title) => updateTrack.mutate({ id: slice.trackId, data: { title } })}
                  />
                ) : (
                  <CompactSliceRow
                    slice={slice}
                    isPlaying={playingSliceId === slice.id}
                    isSelected={selectedSliceId === slice.id}
                    isBatchSelected={selectedSliceIds.has(slice.id)}
                    onSelect={() => onSliceSelect(slice.id)}
                    onToggleBatchSelect={() => toggleBatchSelect(slice.id)}
                    onPlay={() => handlePlay(slice)}
                    formatTime={formatTime}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-3 py-2 border-t border-gray-700 flex items-center justify-center gap-1 flex-shrink-0">
          <button
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
            className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed"
          >
            «
          </button>
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed"
          >
            ‹
          </button>
          <span className="px-2 text-xs text-gray-400">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed"
          >
            ›
          </button>
          <button
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
            className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed"
          >
            »
          </button>
        </div>
      )}
    </div>
  )
}

// Editable row component (extracted from SliceBrowser)
interface EditableSliceRowProps {
  slice: SliceWithTrack
  isPlaying: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onPlay: () => void
  formatTime: (s: number) => string
  availableTags: Tag[]
  folders: Folder[]
  isFolderDropdownOpen: boolean
  onToggleFolderDropdown: () => void
  onAddTag: (tagId: number) => void
  onRemoveTag: (tagId: number) => void
  onCreateTag: (name: string, color: string) => Promise<void>
  isCreatingTag: boolean
  onToggleFavorite: () => void
  onAddToFolder: (folderId: number) => void
  onRemoveFromFolder: (folderId: number) => void
  onDelete: () => void
  isDeleting: boolean
  onUpdateSliceName: (name: string) => void
  onUpdateTrackTitle: (title: string) => void
}

function EditableSliceRow({
  slice,
  isPlaying,
  isSelected,
  onToggleSelect,
  onPlay,
  formatTime,
  availableTags,
  folders,
  isFolderDropdownOpen,
  onToggleFolderDropdown,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  isCreatingTag,
  onToggleFavorite,
  onAddToFolder,
  onRemoveFromFolder,
  onDelete,
  isDeleting,
  onUpdateSliceName,
  onUpdateTrackTitle,
}: EditableSliceRowProps) {
  const generateAiTags = useGenerateAiTagsForSlice(slice.trackId)
  const duration = slice.endTime - slice.startTime

  // Editing state
  const [isEditingName, setIsEditingName] = useState(false)
  const [editingName, setEditingName] = useState(slice.name)
  const [isEditingTrack, setIsEditingTrack] = useState(false)
  const [editingTrack, setEditingTrack] = useState(slice.track.title)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const trackInputRef = useRef<HTMLInputElement>(null)

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

  const availableFolders = folders.filter((c) => !slice.folderIds.includes(c.id))
  const sliceFolders = folders.filter((c) => slice.folderIds.includes(c.id))

  return (
    <div className={`px-3 py-2 hover:bg-gray-700/30 transition-colors ${isSelected ? 'bg-indigo-900/20' : ''}`}>
      {/* Main row */}
      <div className="flex items-center gap-2">
        {/* Selection checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
        />

        {/* Favorite button */}
        <button
          onClick={onToggleFavorite}
          className={`p-0.5 transition-colors ${
            slice.favorite
              ? 'text-yellow-400'
              : 'text-gray-500 hover:text-yellow-400'
          }`}
          title={slice.favorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={14} className={slice.favorite ? 'fill-current' : ''} />
        </button>

        {/* Play button */}
        <button
          onClick={onPlay}
          className={`p-1.5 rounded-full transition-colors ${
            isPlaying
              ? 'bg-green-600 text-white'
              : 'text-gray-400 hover:text-green-400 hover:bg-gray-700'
          }`}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {isEditingName ? (
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
              className="w-full px-1.5 py-0.5 bg-gray-900 border border-indigo-500 rounded text-white text-sm focus:outline-none"
            />
          ) : (
            <div
              className="group flex items-center gap-1 cursor-pointer"
              onClick={() => {
                setEditingName(slice.name)
                setIsEditingName(true)
              }}
            >
              <span className="font-medium text-white text-sm truncate">{slice.name}</span>
              <Pencil size={10} className="text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </div>
          )}
          {isEditingTrack ? (
            <div className="flex items-center gap-1 mt-0.5">
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
                className="flex-1 px-1.5 py-0.5 bg-gray-900 border border-indigo-500 rounded text-gray-300 text-xs focus:outline-none"
              />
            </div>
          ) : (
            <div className="group flex items-center gap-1">
              <span className="text-xs text-gray-400 truncate">{slice.track.title}</span>
              <button
                onClick={() => {
                  setEditingTrack(slice.track.title)
                  setIsEditingTrack(true)
                }}
                className="p-0.5 text-gray-500 opacity-0 group-hover:opacity-100 hover:text-white transition-all flex-shrink-0"
              >
                <Pencil size={10} />
              </button>
            </div>
          )}
        </div>

        {/* Duration */}
        <div className="text-xs text-gray-400 tabular-nums">
          {formatTime(duration)}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() =>
              generateAiTags.mutate(slice.id, {
                onSuccess: (result) => {
                  if (result.warning?.hadPotentialCustomState && result.warning.message) {
                    window.alert(
                      [
                        'Warning: Potential custom state detected before analysis.',
                        result.warning.message,
                        `Removed tags: ${result.warning.removedTags.join(', ') || 'none'}`,
                        `Added tags: ${result.warning.addedTags.join(', ') || 'none'}`,
                      ].join('\n')
                    )
                  }
                },
              })
            }
            disabled={generateAiTags.isPending}
            className="p-1.5 text-gray-400 hover:text-yellow-400 transition-colors"
            title="Generate AI tags"
          >
            {generateAiTags.isPending ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <Sparkles size={14} />
            )}
          </button>
          <a
            href={getSliceDownloadUrl(slice.id)}
            download
            className="p-1.5 text-gray-400 hover:text-blue-400 transition-colors"
            title="Download"
          >
            <Download size={14} />
          </a>
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="p-1.5 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
            title="Delete"
          >
            {isDeleting ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <Trash2 size={14} />
            )}
          </button>
        </div>
      </div>

      {/* Tags and Folders row */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {/* Folder badges */}
        {sliceFolders.map((col) => (
          <span
            key={col.id}
            className="group inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
            style={{ backgroundColor: col.color + '40', color: col.color }}
          >
            <FolderIcon size={10} />
            {col.name}
            <button
              onClick={() => onRemoveFromFolder(col.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/20 rounded"
            >
              <X size={10} />
            </button>
          </span>
        ))}

        {/* Tags */}
        {slice.tags.map((tag) => (
          <span
            key={tag.id}
            className="group inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
            style={{ backgroundColor: tag.color + '40', color: tag.color }}
          >
            {tag.name}
            <button
              onClick={() => onRemoveTag(tag.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/20 rounded"
            >
              <X size={10} />
            </button>
          </span>
        ))}

        {/* Add to folder */}
        <div className="relative">
          <button
            onClick={onToggleFolderDropdown}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            <FolderPlus size={10} />
            <ChevronDown size={10} />
          </button>

          {isFolderDropdownOpen && (
            <div className="absolute left-0 bottom-full mb-1 z-10 w-40 max-h-40 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl">
              {availableFolders.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-gray-500">No folders</div>
              ) : (
                availableFolders.map((col) => (
                  <button
                    key={col.id}
                    onClick={() => onAddToFolder(col.id)}
                    className="w-full px-2 py-1.5 text-left text-xs hover:bg-gray-700 transition-colors flex items-center gap-2"
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: col.color }}
                    />
                    <span style={{ color: col.color }}>{col.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Add tag */}
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
