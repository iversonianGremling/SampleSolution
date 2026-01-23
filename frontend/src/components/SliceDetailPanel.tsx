import { useRef, useState, useEffect } from 'react'
import { Play, Pause, X, Star, Pencil, Loader2 } from 'lucide-react'
import type { SamplePoint, SliceWithTrack } from '../types'
import { useWavesurfer } from '../hooks/useWavesurfer'
import { getSliceDownloadUrl } from '../api/client'
import {
  useUpdateSliceGlobal,
  useToggleFavorite,
  useAddTagToSlice,
  useRemoveTagFromSlice,
  useTags,
  useCollections,
  useAddSliceToCollection,
  useRemoveSliceFromCollection,
} from '../hooks/useTracks'
import { TagSearchInput } from './TagSearchInput'

interface SliceDetailPanelProps {
  selectedPoint: SamplePoint
  sliceData: SliceWithTrack
  onPlay: () => void
  isPlaying: boolean
  isPaused: boolean
  onClose?: () => void
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

export function SliceDetailPanel({
  selectedPoint,
  sliceData,
  onPlay,
  isPlaying,
  isPaused,
  onClose,
}: SliceDetailPanelProps) {
  // Waveform hook
  const {
    containerRef,
    minimapRef,
    isReady,
    currentTime,
    duration,
  } = useWavesurfer({
    audioUrl: getSliceDownloadUrl(selectedPoint.id),
  })

  // State for metadata editing
  const [isEditingName, setIsEditingName] = useState(false)
  const [editingName, setEditingName] = useState(sliceData.name)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Mutations
  const updateSliceMutation = useUpdateSliceGlobal()
  const toggleFavoriteMutation = useToggleFavorite()
  const addTagMutation = useAddTagToSlice()
  const removeTagMutation = useRemoveTagFromSlice()
  const addCollectionMutation = useAddSliceToCollection()
  const removeCollectionMutation = useRemoveSliceFromCollection()

  // Queries
  const { data: allTags } = useTags()
  const { data: allCollections } = useCollections()

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [isEditingName])

  // Note: The waveform visualization is independent of AudioManager playback.
  // AudioManager plays the audio, and useWavesurfer displays the visualization.
  // They are kept in sync via the parent component's playback state management.

  const saveSliceName = () => {
    if (editingName.trim() && editingName !== sliceData.name) {
      updateSliceMutation.mutate({
        id: sliceData.id,
        data: { name: editingName.trim() },
      })
    }
    setIsEditingName(false)
  }

  const handleToggleFavorite = () => {
    toggleFavoriteMutation.mutate(sliceData.id)
  }

  const handleAddTag = (tagId: number) => {
    addTagMutation.mutate({
      sliceId: sliceData.id,
      tagId,
    })
  }

  const handleRemoveTag = (tagId: number) => {
    removeTagMutation.mutate({
      sliceId: sliceData.id,
      tagId,
    })
  }

  const handleAddCollection = (collectionId: number) => {
    addCollectionMutation.mutate({
      sliceId: sliceData.id,
      collectionId,
    })
  }

  const handleRemoveCollection = (collectionId: number) => {
    removeCollectionMutation.mutate({
      sliceId: sliceData.id,
      collectionId,
    })
  }

  const sliceTagIds = new Set(sliceData.tags.map((t) => t.id))
  const sliceCollectionIds = new Set(sliceData.collectionIds)
  const availableTags = allTags?.filter((t) => !sliceTagIds.has(t.id)) || []
  const availableCollections = allCollections?.filter((c) => !sliceCollectionIds.has(c.id)) || []
  const sliceCollections = allCollections?.filter((c) => sliceCollectionIds.has(c.id)) || []

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4 max-h-[600px] overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
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
                className="flex-1 px-2 py-1 bg-gray-900 border border-indigo-500 rounded text-white text-sm focus:outline-none"
              />
              {updateSliceMutation.isPending && <Loader2 size={16} className="animate-spin text-indigo-400" />}
            </div>
          ) : (
            <div
              className="group flex items-center gap-2 cursor-pointer"
              onClick={() => {
                setEditingName(sliceData.name)
                setIsEditingName(true)
              }}
            >
              <h3 className="font-semibold text-white text-lg">{sliceData.name}</h3>
              <Pencil size={14} className="text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
          <div className="text-xs text-gray-400 mt-1">{sliceData.track.title}</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-300">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Waveform */}
      <div className="space-y-2">
        {!isReady ? (
          <div className="h-32 bg-gray-700 rounded flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <>
            <div ref={containerRef} className="rounded" />
            <div ref={minimapRef} className="rounded mt-2" />
          </>
        )}
      </div>

      {/* Playback Controls */}
      <div className="flex items-center gap-3 bg-gray-700/50 rounded p-3">
        <button
          onClick={onPlay}
          className={`p-2 rounded-full transition-colors ${
            isPlaying && !isPaused
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
          }`}
        >
          {isPlaying && !isPaused ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <div className="flex-1 flex items-center gap-2">
          <span className="text-xs text-gray-400">{formatTime(currentTime)}</span>
          <div className="flex-1 h-1 bg-gray-600 rounded" />
          <span className="text-xs text-gray-400">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Metadata Section */}
      <div className="space-y-3">
        {/* Favorite */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400 font-medium">Favorite</label>
          <button
            onClick={handleToggleFavorite}
            disabled={toggleFavoriteMutation.isPending}
            className={`p-1 transition-colors ${
              sliceData.favorite ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400'
            }`}
          >
            {toggleFavoriteMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Star size={16} className={sliceData.favorite ? 'fill-current' : ''} />
            )}
          </button>
        </div>

        {/* Tags */}
        <div className="space-y-1">
          <label className="text-xs text-gray-400 font-medium">Tags</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {sliceData.tags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-white"
                style={{ backgroundColor: tag.color || '#6366f1' }}
              >
                <span>{tag.name}</span>
                <button
                  onClick={() => handleRemoveTag(tag.id)}
                  disabled={removeTagMutation.isPending}
                  className="hover:opacity-70 transition-opacity"
                >
                  {removeTagMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                </button>
              </div>
            ))}
          </div>
          {availableTags.length > 0 && (
            <TagSearchInput
              availableTags={availableTags}
              onAddTag={handleAddTag}
              onCreateTag={async () => {
                // Tag creation not supported in detail panel
              }}
              placeholder="Add tag..."
              className="w-full"
            />
          )}
        </div>

        {/* Collections */}
        <div className="space-y-1">
          <label className="text-xs text-gray-400 font-medium">Collections</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {sliceCollections.map((collection) => (
              <div
                key={collection.id}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-white"
                style={{ backgroundColor: collection.color || '#6366f1' }}
              >
                <span>{collection.name}</span>
                <button
                  onClick={() => handleRemoveCollection(collection.id)}
                  disabled={removeCollectionMutation.isPending}
                  className="hover:opacity-70 transition-opacity"
                >
                  {removeCollectionMutation.isPending ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <X size={12} />
                  )}
                </button>
              </div>
            ))}
          </div>
          {availableCollections.length > 0 && (
            <select
              onChange={(e) => {
                const collectionId = parseInt(e.target.value)
                if (collectionId) {
                  handleAddCollection(collectionId)
                  e.target.value = ''
                }
              }}
              className="w-full px-2 py-1 bg-gray-900 border border-gray-600 rounded text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">Add to collection...</option>
              {availableCollections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Audio Features */}
      {selectedPoint.features && (
        <div className="border-t border-gray-700 pt-3 space-y-2">
          <h4 className="text-xs font-medium text-gray-400">Audio Features</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {selectedPoint.features.duration && (
              <>
                <span className="text-gray-400">Duration</span>
                <span className="text-gray-300">{selectedPoint.features.duration.toFixed(2)}s</span>
              </>
            )}
            {selectedPoint.features.bpm && (
              <>
                <span className="text-gray-400">BPM</span>
                <span className="text-gray-300">{Math.round(selectedPoint.features.bpm)}</span>
              </>
            )}
            {selectedPoint.features.spectralCentroid && (
              <>
                <span className="text-gray-400">Brightness</span>
                <span className="text-gray-300">{Math.round(selectedPoint.features.spectralCentroid)} Hz</span>
              </>
            )}
            {selectedPoint.features.rmsEnergy && (
              <>
                <span className="text-gray-400">Energy</span>
                <span className="text-gray-300">{selectedPoint.features.rmsEnergy.toFixed(3)}</span>
              </>
            )}
            {selectedPoint.features.spectralRolloff && (
              <>
                <span className="text-gray-400">Rolloff</span>
                <span className="text-gray-300">{Math.round(selectedPoint.features.spectralRolloff)} Hz</span>
              </>
            )}
            {selectedPoint.features.zeroCrossingRate && (
              <>
                <span className="text-gray-400">ZCR</span>
                <span className="text-gray-300">{selectedPoint.features.zeroCrossingRate.toFixed(3)}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
