import { useRef, useState, useEffect } from 'react'
import { Play, Pause, X, Star, Pencil, Loader2, Download, ChevronDown } from 'lucide-react'
import type { SamplePoint, SliceWithTrack } from '../types'
import { useCompactWaveform } from '../hooks/useCompactWaveform'
import { useAudioFileDragDrop } from '../hooks/useAudioFileDragDrop'
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
  sliceData: SliceWithTrack & { id: number } // Enforce id is always a number
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
  onClose,
}: SliceDetailPanelProps) {
  const [showFeatures, setShowFeatures] = useState(false)

  const audioUrl = getSliceDownloadUrl(sliceData.id)

  // Compact waveform - simple audio playback with visual feedback
  const {
    containerRef,
    isReady,
    isPlaying,
    currentTime,
    duration,
    error,
    play: waveformPlay,
    pause: waveformPause,
  } = useCompactWaveform({
    audioUrl,
  })

  // State for metadata editing
  const [isEditingName, setIsEditingName] = useState(false)
  const [editingName, setEditingName] = useState(sliceData.name)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Drag source for exporting audio
  const { isDragging, handlers: dragHandlers } = useAudioFileDragDrop({
    fileUrl: audioUrl,
    fileName: `${sliceData.name}.mp3`,
  })

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

  // Reset editing name when slice changes
  useEffect(() => {
    setEditingName(sliceData.name)
  }, [sliceData.name])

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

  const handleDownload = () => {
    window.open(getSliceDownloadUrl(sliceData.id), '_blank')
  }

  const sliceTagIds = new Set(sliceData.tags.map((t) => t.id))
  const sliceCollectionIds = new Set(sliceData.collectionIds)
  const availableTags = allTags?.filter((t) => !sliceTagIds.has(t.id)) || []
  const availableCollections = allCollections?.filter((c) => !sliceCollectionIds.has(c.id)) || []
  const sliceCollections = allCollections?.filter((c) => sliceCollectionIds.has(c.id)) || []

  return (
    <div className="bg-surface-overlay border-t border-surface-border">
      {/* Compact Header Row */}
      <div className="flex items-center gap-3 px-3 py-2">
        {/* Play Button */}
        <button
          onClick={() => {
            if (isPlaying) {
              waveformPause()
            } else {
              waveformPlay()
            }
          }}
          className={`p-2 rounded-full transition-colors flex-shrink-0 ${
            isPlaying
              ? 'bg-emerald-500 text-white'
              : 'bg-surface-raised text-slate-300 hover:bg-surface-base hover:text-white'
          }`}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>

        {/* Name and Track */}
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
                className="flex-1 px-2 py-0.5 bg-surface-base border border-accent-primary rounded text-white text-sm focus:outline-none"
              />
              {updateSliceMutation.isPending && (
                <Loader2 size={14} className="animate-spin text-accent-primary" />
              )}
            </div>
          ) : (
            <div
              className="group flex items-center gap-1.5 cursor-pointer"
              onClick={() => {
                setEditingName(sliceData.name)
                setIsEditingName(true)
              }}
            >
              <span className="font-medium text-white text-sm truncate">
                {sliceData.name}
              </span>
              <Pencil
                size={12}
                className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              />
            </div>
          )}
          <div className="text-[11px] text-slate-500 truncate">
            {sliceData.track.title}
          </div>
        </div>

        {/* Time Display */}
        <div className="text-xs text-slate-500 font-mono flex-shrink-0">
          {formatTime(currentTime)}/{formatTime(duration)}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={handleToggleFavorite}
            disabled={toggleFavoriteMutation.isPending}
            className={`p-1.5 rounded transition-colors ${
              sliceData.favorite
                ? 'text-amber-400'
                : 'text-slate-500 hover:text-amber-400'
            }`}
            title="Favorite"
          >
            {toggleFavoriteMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Star size={16} className={sliceData.favorite ? 'fill-current' : ''} />
            )}
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 rounded text-slate-500 hover:text-white transition-colors"
            title="Download"
          >
            <Download size={16} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded text-slate-500 hover:text-white transition-colors"
              title="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Compact Waveform - Draggable */}
      <div className="px-3 pb-2">
        <div
          {...dragHandlers}
          className={`relative rounded overflow-hidden h-12 w-full bg-surface-raised transition-opacity ${
            isDragging ? 'opacity-50 cursor-grabbing' : 'cursor-grab hover:opacity-90'
          }`}
          title="Drag to save audio file"
        >
          {/* WaveSurfer renders into this container */}
          <div
            ref={containerRef}
            className="w-full h-full pointer-events-none"
          />

          {/* Overlay loading/error states */}
          {error && (
            <div className="absolute inset-0 h-12 bg-red-950 rounded flex items-center justify-center text-xs text-red-300">
              {error}
            </div>
          )}
          {!error && !isReady && (
            <div className="absolute inset-0 h-12 bg-surface-raised rounded flex items-center justify-center">
              <Loader2 size={16} className="animate-spin text-slate-500" />
            </div>
          )}
        </div>
      </div>

      {/* Tags and Collections Row - Compact */}
      <div className="px-3 pb-2 flex items-center gap-2 flex-wrap">
        {sliceData.tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
            style={{
              backgroundColor: (tag.color || '#6366f1') + '25',
              color: tag.color || '#6366f1',
            }}
          >
            {tag.name}
            <button
              onClick={() => handleRemoveTag(tag.id)}
              disabled={removeTagMutation.isPending}
              className="hover:opacity-70 transition-opacity"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {sliceCollections.map((collection) => (
          <span
            key={collection.id}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border border-dashed"
            style={{
              borderColor: (collection.color || '#6366f1') + '50',
              color: collection.color || '#6366f1',
            }}
          >
            {collection.name}
            <button
              onClick={() => handleRemoveCollection(collection.id)}
              disabled={removeCollectionMutation.isPending}
              className="hover:opacity-70 transition-opacity"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {availableTags.length > 0 && (
          <TagSearchInput
            availableTags={availableTags}
            onAddTag={handleAddTag}
            onCreateTag={async () => {}}
            placeholder="+ Tag"
            className="text-[11px]"
          />
        )}
        {availableCollections.length > 0 && (
          <select
            onChange={(e) => {
              const collectionId = parseInt(e.target.value)
              if (collectionId) {
                handleAddCollection(collectionId)
                e.target.value = ''
              }
            }}
            className="px-1.5 py-0.5 bg-surface-raised border border-surface-border rounded text-[11px] text-slate-400 focus:outline-none focus:border-accent-primary"
          >
            <option value="">+ Collection</option>
            {availableCollections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Audio Features - Collapsed by Default */}
      {selectedPoint.features && (
        <>
          <button
            onClick={() => setShowFeatures(!showFeatures)}
            className="w-full flex items-center justify-between px-3 py-1.5 border-t border-surface-border text-[11px] text-slate-500 hover:text-slate-400 transition-colors"
          >
            <span>Audio Features</span>
            <ChevronDown
              size={12}
              className={`transition-transform duration-200 ${
                showFeatures ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showFeatures && (
            <div className="px-3 pb-2 grid grid-cols-3 gap-x-4 gap-y-1 text-[11px] animate-slide-down">
              {selectedPoint.features.duration != null && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Duration</span>
                  <span className="text-slate-300 font-mono">
                    {selectedPoint.features.duration.toFixed(2)}s
                  </span>
                </div>
              )}
              {selectedPoint.features.bpm != null && (
                <div className="flex justify-between">
                  <span className="text-slate-500">BPM</span>
                  <span className="text-slate-300 font-mono">
                    {Math.round(selectedPoint.features.bpm)}
                  </span>
                </div>
              )}
              {selectedPoint.features.spectralCentroid != null && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Brightness</span>
                  <span className="text-slate-300 font-mono">
                    {Math.round(selectedPoint.features.spectralCentroid)}Hz
                  </span>
                </div>
              )}
              {selectedPoint.features.rmsEnergy != null && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Energy</span>
                  <span className="text-slate-300 font-mono">
                    {selectedPoint.features.rmsEnergy.toFixed(3)}
                  </span>
                </div>
              )}
              {selectedPoint.features.spectralRolloff != null && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Rolloff</span>
                  <span className="text-slate-300 font-mono">
                    {Math.round(selectedPoint.features.spectralRolloff)}Hz
                  </span>
                </div>
              )}
              {selectedPoint.features.zeroCrossingRate != null && (
                <div className="flex justify-between">
                  <span className="text-slate-500">ZCR</span>
                  <span className="text-slate-300 font-mono">
                    {selectedPoint.features.zeroCrossingRate.toFixed(3)}
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
