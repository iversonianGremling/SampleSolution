import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Heart, Download, X, Plus, ChevronDown, Edit2, Check, Scissors } from 'lucide-react'
import type { SliceWithTrackExtended, Tag, Collection } from '../types'
import { getSliceDownloadUrl } from '../api/client'

interface SourcesDetailPaneProps {
  sample: SliceWithTrackExtended | null
  allTags: Tag[]
  collections: Collection[]
  onClose: () => void
  onToggleFavorite?: (id: number) => void
  onAddTag?: (sliceId: number, tagId: number) => void
  onRemoveTag?: (sliceId: number, tagId: number) => void
  onAddToCollection?: (collectionId: number, sliceId: number) => void
  onRemoveFromCollection?: (collectionId: number, sliceId: number) => void
  onUpdateName?: (sliceId: number, name: string) => void
  onEdit?: () => void
}

export function SourcesDetailPane({
  sample,
  allTags,
  collections,
  onClose,
  onToggleFavorite,
  onAddTag,
  onRemoveTag,
  onAddToCollection,
  onRemoveFromCollection,
  onUpdateName,
  onEdit,
}: SourcesDetailPaneProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false)
  const [isCollectionDropdownOpen, setIsCollectionDropdownOpen] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const tagDropdownRef = useRef<HTMLDivElement>(null)
  const collectionDropdownRef = useRef<HTMLDivElement>(null)

  // Reset state when sample changes
  useEffect(() => {
    setIsPlaying(false)
    setIsEditingName(false)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }, [sample?.id])

  // Click outside handlers
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setIsTagDropdownOpen(false)
      }
      if (collectionDropdownRef.current && !collectionDropdownRef.current.contains(e.target as Node)) {
        setIsCollectionDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!sample) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        <p>Select a sample to view details</p>
      </div>
    )
  }

  const formatDuration = (startTime: number, endTime: number) => {
    const duration = endTime - startTime
    if (duration < 60) {
      return `${duration.toFixed(2)}s`
    }
    const mins = Math.floor(duration / 60)
    const secs = (duration % 60).toFixed(2)
    return `${mins}:${parseFloat(secs) < 10 ? '0' : ''}${secs}`
  }

  const handlePlayPause = () => {
    if (isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause()
      }
      setIsPlaying(false)
    } else {
      if (!audioRef.current) {
        audioRef.current = new Audio(getSliceDownloadUrl(sample.id))
        audioRef.current.onended = () => setIsPlaying(false)
      }
      audioRef.current.play()
      setIsPlaying(true)
    }
  }

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = getSliceDownloadUrl(sample.id)
    link.download = `${sample.name}.mp3`
    link.click()
  }

  const handleSaveName = () => {
    if (editedName.trim() && editedName !== sample.name && onUpdateName) {
      onUpdateName(sample.id, editedName.trim())
    }
    setIsEditingName(false)
  }

  const availableTags = allTags.filter(t => !sample.tags.some(st => st.id === t.id))
  const availableCollections = collections.filter(c => !sample.collectionIds.includes(c.id))
  const sampleCollections = collections.filter(c => sample.collectionIds.includes(c.id))

  return (
    <div className="h-full flex flex-col bg-surface-raised border-l border-surface-border">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-surface-border">
        <h3 className="text-sm font-semibold text-white">Sample Details</h3>
        <div className="flex items-center gap-2">
          {onEdit && (
            <button
              onClick={onEdit}
              className="p-1 text-slate-400 hover:text-white rounded transition-colors"
              title="Edit Source"
            >
              <Scissors size={16} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Waveform placeholder */}
        <div className="bg-surface-base rounded-lg p-4">
          <div className="flex items-end gap-0.5 h-16 w-full">
            {Array.from({ length: 40 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-accent-primary/60 rounded-t transition-all"
                style={{
                  height: `${20 + Math.sin(i * 0.3 + sample.id) * 60 + Math.random() * 20}%`,
                }}
              />
            ))}
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={handlePlayPause}
            className="w-10 h-10 rounded-full bg-accent-primary flex items-center justify-center text-white hover:bg-accent-primary/80 transition-colors"
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>
          <div className="flex-1">
            <span className="text-sm text-slate-400">Duration</span>
            <p className="text-white font-medium">{formatDuration(sample.startTime, sample.endTime)}</p>
          </div>
          {onToggleFavorite && (
            <button
              onClick={() => onToggleFavorite(sample.id)}
              className={`p-2 rounded-lg transition-colors ${
                sample.favorite
                  ? 'text-amber-400 bg-amber-400/20'
                  : 'text-slate-400 hover:text-amber-400 hover:bg-amber-400/20'
              }`}
            >
              <Heart size={18} className={sample.favorite ? 'fill-current' : ''} />
            </button>
          )}
          <button
            onClick={handleDownload}
            className="p-2 text-slate-400 hover:text-white hover:bg-surface-base rounded-lg transition-colors"
          >
            <Download size={18} />
          </button>
        </div>

        {/* Name */}
        <div>
          <label className="text-xs font-medium text-slate-400 block mb-1">Name</label>
          {isEditingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName()
                  if (e.key === 'Escape') setIsEditingName(false)
                }}
                className="flex-1 px-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary"
                autoFocus
              />
              <button
                onClick={handleSaveName}
                className="p-1.5 text-emerald-400 hover:bg-emerald-400/20 rounded transition-colors"
              >
                <Check size={16} />
              </button>
              <button
                onClick={() => setIsEditingName(false)}
                className="p-1.5 text-slate-400 hover:bg-surface-base rounded transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-white">{sample.name}</span>
              {onUpdateName && (
                <button
                  onClick={() => {
                    setEditedName(sample.name)
                    setIsEditingName(true)
                  }}
                  className="p-1 text-slate-400 hover:text-white rounded transition-colors"
                >
                  <Edit2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Source */}
        <div>
          <label className="text-xs font-medium text-slate-400 block mb-1">Source</label>
          <p className="text-white text-sm">{sample.track.title}</p>
          {sample.track.folderPath && (
            <p className="text-xs text-slate-500 mt-0.5">{sample.track.folderPath}</p>
          )}
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs font-medium text-slate-400 block mb-2">Tags</label>
          <div className="flex flex-wrap gap-1.5">
            {sample.tags.map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: tag.color + '25',
                  color: tag.color,
                }}
              >
                {tag.name}
                {onRemoveTag && (
                  <button
                    onClick={() => onRemoveTag(sample.id, tag.id)}
                    className="hover:opacity-70 transition-opacity"
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}

            {/* Add tag dropdown */}
            {onAddTag && availableTags.length > 0 && (
              <div className="relative" ref={tagDropdownRef}>
                <button
                  onClick={() => setIsTagDropdownOpen(!isTagDropdownOpen)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-surface-base text-slate-400 hover:text-slate-300 transition-colors"
                >
                  <Plus size={10} />
                  <ChevronDown size={10} />
                </button>

                {isTagDropdownOpen && (
                  <div className="absolute top-full mt-1 left-0 z-20 w-40 max-h-40 overflow-y-auto bg-surface-raised border border-surface-border rounded-lg shadow-xl">
                    {availableTags.map(tag => (
                      <button
                        key={tag.id}
                        onClick={() => {
                          onAddTag(sample.id, tag.id)
                          setIsTagDropdownOpen(false)
                        }}
                        className="w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-base flex items-center gap-2"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span style={{ color: tag.color }}>{tag.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Collections */}
        <div>
          <label className="text-xs font-medium text-slate-400 block mb-2">Folders</label>
          <div className="flex flex-wrap gap-1.5">
            {sampleCollections.map(col => (
              <span
                key={col.id}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: col.color + '25',
                  color: col.color,
                }}
              >
                {col.name}
                {onRemoveFromCollection && (
                  <button
                    onClick={() => onRemoveFromCollection(col.id, sample.id)}
                    className="hover:opacity-70 transition-opacity"
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}

            {/* Add to collection dropdown */}
            {onAddToCollection && availableCollections.length > 0 && (
              <div className="relative" ref={collectionDropdownRef}>
                <button
                  onClick={() => setIsCollectionDropdownOpen(!isCollectionDropdownOpen)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-surface-base text-slate-400 hover:text-slate-300 transition-colors"
                >
                  <Plus size={10} />
                  <ChevronDown size={10} />
                </button>

                {isCollectionDropdownOpen && (
                  <div className="absolute top-full mt-1 left-0 z-20 w-40 max-h-40 overflow-y-auto bg-surface-raised border border-surface-border rounded-lg shadow-xl">
                    {availableCollections.map(col => (
                      <button
                        key={col.id}
                        onClick={() => {
                          onAddToCollection(col.id, sample.id)
                          setIsCollectionDropdownOpen(false)
                        }}
                        className="w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-base flex items-center gap-2"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: col.color }}
                        />
                        <span style={{ color: col.color }}>{col.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
