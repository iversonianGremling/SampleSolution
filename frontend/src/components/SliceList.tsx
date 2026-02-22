import { useState, useRef, useEffect } from 'react'
import { Play, Download, Trash2, X, Pencil, Check, Pause, ZapIcon, Hand, Wand2, Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { getSliceDownloadUrl, batchReanalyzeSamples } from '../api/client'
import { useTags, useAddTagToSlice, useRemoveTagFromSlice, useCreateTag, useUpdateSlice } from '../hooks/useTracks'
import { TagSearchInput } from './TagSearchInput'
import type { Slice } from '../types'

type PlayMode = 'toggle' | 'oneshot' | 'hold'

interface SliceListProps {
  slices: Slice[]
  trackId: number
  playingSliceId: number | null
  onTogglePlay: (slice: Slice) => void
  onOneShotPlay: (slice: Slice) => void
  onDelete: (slice: Slice) => void
  formatTime: (seconds: number) => string
}

export function SliceList({ slices, trackId, playingSliceId, onTogglePlay, onOneShotPlay, onDelete, formatTime }: SliceListProps) {
  const [editingSliceId, setEditingSliceId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [playMode, setPlayMode] = useState<PlayMode>('toggle')
  const [holdingSliceId, setHoldingSliceId] = useState<number | null>(null)
  const [analyzingSliceId, setAnalyzingSliceId] = useState<number | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
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

  const cyclePlayMode = () => {
    setPlayMode((current) => {
      if (current === 'toggle') return 'oneshot'
      if (current === 'oneshot') return 'hold'
      return 'toggle'
    })
  }

  const handlePlay = (slice: Slice) => {
    if (playMode === 'toggle') {
      onTogglePlay(slice)
    } else if (playMode === 'oneshot') {
      onOneShotPlay(slice)
    } else {
      // hold mode - play on mouse down
      setHoldingSliceId(slice.id)
      onOneShotPlay(slice)
    }
  }

  const handleMouseDown = (slice: Slice) => {
    if (playMode === 'hold') {
      setHoldingSliceId(slice.id)
      onOneShotPlay(slice)
    } else {
      handlePlay(slice)
    }
  }

  const handleMouseUp = () => {
    if (playMode === 'hold') {
      setHoldingSliceId(null)
    }
  }

  const getPlayModeIcon = () => {
    switch (playMode) {
      case 'toggle':
        return <Pause size={8} />
      case 'oneshot':
        return <ZapIcon size={8} />
      case 'hold':
        return <Hand size={8} />
    }
  }

  const handleAnalyze = async (sliceId: number) => {
    try {
      setAnalyzingSliceId(sliceId)
      await batchReanalyzeSamples([sliceId])
      queryClient.invalidateQueries({ queryKey: ['slices', trackId] })
    } catch (error) {
      console.error('Failed to analyze slice:', error)
    } finally {
      setAnalyzingSliceId(null)
    }
  }

  const getPlayModeLabel = () => {
    switch (playMode) {
      case 'toggle':
        return 'Toggle mode'
      case 'oneshot':
        return 'One-shot mode'
      case 'hold':
        return 'Hold mode'
    }
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
            className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-700/30 transition-colors"
          >
            {/* Color indicator */}
            <div
              className="w-1.5 h-8 rounded-full flex-shrink-0"
              style={{ backgroundColor: colors[index % colors.length] }}
            />

            {/* Info */}
            <div className="flex-1 min-w-0">
              {editingSliceId === slice.id ? (
                <div className="flex items-center gap-1.5">
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
                  <span className="font-medium text-white truncate text-sm">{slice.name}</span>
                  <Pencil size={11} className="text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </div>
              )}
              <div className="text-xs text-gray-400 mt-0.5">
                {formatTime(slice.startTime)} - {formatTime(slice.endTime)}
                <span className="ml-1.5 text-gray-500">
                  ({formatTime(slice.endTime - slice.startTime)})
                </span>
              </div>
            </div>

            {/* Tags with edit capability */}
            <div className="flex flex-wrap items-center gap-1 max-w-[280px] lg:max-w-[380px] flex-shrink-0">
              {slice.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="group inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded whitespace-nowrap"
                  style={{ backgroundColor: tag.color + '40', color: tag.color }}
                >
                  {tag.name}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeTagFromSlice.mutate({ sliceId: slice.id, tagId: tag.id })
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-base/20 rounded ml-0.5"
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
            <div className="flex items-center gap-1 flex-shrink-0">
              {/* Play button with mode selector overlay */}
              <div className="relative mr-1">
                {/* Main play button */}
                <button
                  onMouseDown={() => handleMouseDown(slice)}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onClick={playMode !== 'hold' ? () => handlePlay(slice) : undefined}
                  className={`p-2 rounded transition-colors ${
                    (playingSliceId === slice.id && playMode === 'toggle') || holdingSliceId === slice.id
                      ? 'text-green-400 bg-green-400/20'
                      : 'text-gray-400 hover:text-green-400 hover:bg-green-400/10'
                  }`}
                  title={`Play (${playMode})`}
                >
                  {playingSliceId === slice.id && playMode === 'toggle' ? <Pause size={16} /> : <Play size={16} />}
                </button>
                {/* Mode selector button - overlaid on bottom-right */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    cyclePlayMode()
                  }}
                  className="absolute bottom-0 right-0 p-0.5 text-gray-500 hover:text-gray-200 bg-gray-800/90 hover:bg-gray-700/90 rounded-sm transition-colors border border-gray-600/50"
                  title={getPlayModeLabel()}
                >
                  {getPlayModeIcon()}
                </button>
              </div>
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
                onClick={() => handleAnalyze(slice.id)}
                disabled={analyzingSliceId === slice.id}
                className="p-2 text-gray-400 hover:text-purple-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Analyze slice"
              >
                {analyzingSliceId === slice.id ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              </button>
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
