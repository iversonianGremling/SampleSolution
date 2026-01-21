import { useState, useRef, useEffect } from 'react'
import { Play, Download, Trash2, Sparkles, Loader2, X, Pencil, Check } from 'lucide-react'
import { getSliceDownloadUrl } from '../api/client'
import { useGenerateAiTagsForSlice, useTags, useAddTagToSlice, useRemoveTagFromSlice, useCreateTag, useUpdateSlice } from '../hooks/useTracks'
import { TagSearchInput } from './TagSearchInput'
import type { Slice } from '../types'

interface SliceListProps {
  slices: Slice[]
  trackId: number
  onPlay: (slice: Slice) => void
  onDelete: (slice: Slice) => void
  formatTime: (seconds: number) => string
}

export function SliceList({ slices, trackId, onPlay, onDelete, formatTime }: SliceListProps) {
  const [taggingSliceId, setTaggingSliceId] = useState<number | null>(null)
  const [editingSliceId, setEditingSliceId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const generateAiTags = useGenerateAiTagsForSlice(trackId)
  const updateSlice = useUpdateSlice(trackId)
  const { data: allTags } = useTags()
  const addTagToSlice = useAddTagToSlice()
  const removeTagFromSlice = useRemoveTagFromSlice()
  const createTag = useCreateTag()

  // Focus input when editing starts
  useEffect(() => {
    if (editingSliceId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingSliceId])

  const startEditing = (slice: Slice) => {
    setEditingSliceId(slice.id)
    setEditingName(slice.name)
  }

  const saveEdit = () => {
    if (editingSliceId && editingName.trim()) {
      updateSlice.mutate({ id: editingSliceId, data: { name: editingName.trim() } })
    }
    setEditingSliceId(null)
    setEditingName('')
  }

  const cancelEdit = () => {
    setEditingSliceId(null)
    setEditingName('')
  }

  const handleGenerateTags = (e: React.MouseEvent, sliceId: number) => {
    e.stopPropagation()
    setTaggingSliceId(sliceId)
    generateAiTags.mutate(sliceId, {
      onSettled: () => setTaggingSliceId(null)
    })
  }

  if (slices.length === 0) {
    return (
      <div className="px-4 pb-4">
        <div className="text-center text-gray-500 py-4">
          No slices yet. Drag on the waveform to create one.
        </div>
      </div>
    )
  }

  const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6']

  return (
    <div className="border-t border-gray-700">
      <div className="px-4 py-2 bg-gray-700/30">
        <h3 className="text-sm font-medium text-gray-400">
          Slices ({slices.length})
        </h3>
      </div>
      <div className="divide-y divide-gray-700">
        {slices.map((slice, index) => (
          <div
            key={slice.id}
            className="flex items-center gap-3 px-4 py-2 hover:bg-gray-700/30 transition-colors"
          >
            {/* Color indicator */}
            <div
              className="w-2 h-8 rounded-full"
              style={{ backgroundColor: colors[index % colors.length] }}
            />

            {/* Info */}
            <div className="flex-1 min-w-0">
              {editingSliceId === slice.id ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit()
                      if (e.key === 'Escape') cancelEdit()
                    }}
                    onBlur={saveEdit}
                    className="flex-1 px-2 py-1 bg-gray-900 border border-indigo-500 rounded text-white text-sm focus:outline-none"
                  />
                  <button
                    onClick={saveEdit}
                    className="p-1 text-green-400 hover:text-green-300"
                    title="Save"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="p-1 text-gray-400 hover:text-gray-300"
                    title="Cancel"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div
                  className="group flex items-center gap-1 cursor-pointer"
                  onClick={() => startEditing(slice)}
                >
                  <span className="font-medium text-white truncate">{slice.name}</span>
                  <Pencil size={12} className="text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              )}
              <div className="text-sm text-gray-400">
                {formatTime(slice.startTime)} - {formatTime(slice.endTime)}
                <span className="ml-2 text-gray-500">
                  ({formatTime(slice.endTime - slice.startTime)})
                </span>
              </div>
            </div>

            {/* Tags with edit capability */}
            <div className="flex flex-wrap items-center gap-1 max-w-[200px]">
              {slice.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="group inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded"
                  style={{ backgroundColor: tag.color + '40', color: tag.color }}
                >
                  {tag.name}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeTagFromSlice.mutate({ sliceId: slice.id, tagId: tag.id })
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/20 rounded ml-0.5"
                    title="Remove tag"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              {/* Add tag search input */}
              <TagSearchInput
                availableTags={(() => {
                  const sliceTagIds = slice.tags.map((t) => t.id)
                  return (allTags || []).filter((t) => !sliceTagIds.includes(t.id))
                })()}
                onAddTag={(tagId) => {
                  addTagToSlice.mutate({ sliceId: slice.id, tagId })
                }}
                onCreateTag={async (name, color) => {
                  const newTag = await createTag.mutateAsync({ name, color })
                  addTagToSlice.mutate({ sliceId: slice.id, tagId: newTag.id })
                }}
                isCreatingTag={createTag.isPending}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => onPlay(slice)}
                className="p-2 text-gray-400 hover:text-green-400 transition-colors"
                title="Play slice"
              >
                <Play size={16} />
              </button>
              <button
                onClick={(e) => handleGenerateTags(e, slice.id)}
                disabled={taggingSliceId === slice.id}
                className="p-2 text-gray-400 hover:text-yellow-400 transition-colors"
                title="Generate AI tags"
              >
                {taggingSliceId === slice.id ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Sparkles size={16} />
                )}
              </button>
              {slice.filePath && (
                <a
                  href={getSliceDownloadUrl(slice.id)}
                  download
                  className="p-2 text-gray-400 hover:text-blue-400 transition-colors"
                  title="Download slice"
                >
                  <Download size={16} />
                </a>
              )}
              <button
                onClick={() => onDelete(slice)}
                className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                title="Delete slice"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
