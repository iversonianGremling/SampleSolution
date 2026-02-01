import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Heart, Download, X, Plus, ChevronDown, Edit2, Check, Scissors, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import type { SliceWithTrackExtended, Tag, Collection } from '../types'
import { getSliceDownloadUrl } from '../api/client'
import { SliceWaveform, type SliceWaveformRef } from './SliceWaveform'

interface SourcesDetailModalProps {
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
  onTagClick?: (tagId: number) => void
  onNext?: () => void
  onPrevious?: () => void
  hasNext?: boolean
  hasPrevious?: boolean
}

export function SourcesDetailModal({
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
  onTagClick,
  onNext,
  onPrevious,
  hasNext = false,
  hasPrevious = false,
}: SourcesDetailModalProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isWaveformReady, setIsWaveformReady] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false)
  const [isCollectionDropdownOpen, setIsCollectionDropdownOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [isEntering, setIsEntering] = useState(true)
  const [tagDropdownPosition, setTagDropdownPosition] = useState<{ top: number; left: number } | null>(null)
  const [collectionDropdownPosition, setCollectionDropdownPosition] = useState<{ top: number; left: number } | null>(null)
  const [tagSearchQuery, setTagSearchQuery] = useState('')
  const [collectionSearchQuery, setCollectionSearchQuery] = useState('')
  const waveformRef = useRef<SliceWaveformRef>(null)
  const tagDropdownRef = useRef<HTMLDivElement>(null)
  const collectionDropdownRef = useRef<HTMLDivElement>(null)
  const tagButtonRef = useRef<HTMLButtonElement>(null)
  const collectionButtonRef = useRef<HTMLButtonElement>(null)

  // Entrance animation
  useEffect(() => {
    setIsEntering(true)
    // Trigger animation after a brief delay to ensure initial render
    const timer = setTimeout(() => {
      setIsEntering(false)
    }, 10)
    return () => clearTimeout(timer)
  }, [])

  // Reset state when sample changes
  useEffect(() => {
    setIsPlaying(false)
    setIsWaveformReady(false)
    setIsEditingName(false)
    if (waveformRef.current) {
      waveformRef.current.pause()
    }
  }, [sample?.id])

  // Click outside handlers
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node

      // Check if click is outside tag dropdown (both button and dropdown menu)
      if (isTagDropdownOpen) {
        const clickedButton = tagDropdownRef.current?.contains(target)
        const clickedDropdown = (e.target as Element).closest('.tag-dropdown-menu')
        if (!clickedButton && !clickedDropdown) {
          setIsTagDropdownOpen(false)
        }
      }

      // Check if click is outside collection dropdown (both button and dropdown menu)
      if (isCollectionDropdownOpen) {
        const clickedButton = collectionDropdownRef.current?.contains(target)
        const clickedDropdown = (e.target as Element).closest('.collection-dropdown-menu')
        if (!clickedButton && !clickedDropdown) {
          setIsCollectionDropdownOpen(false)
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isTagDropdownOpen, isCollectionDropdownOpen])

  if (!sample) {
    return null
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

  const handlePlayPause = async () => {
    console.log('handlePlayPause, isPlaying:', isPlaying)
    if (!waveformRef.current) return

    if (isPlaying) {
      waveformRef.current.pause()
    } else {
      await waveformRef.current.play()
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

  const handleClose = () => {
    setIsClosing(true)
    // Wait for animation to complete before actually closing
    setTimeout(() => {
      onClose()
      setIsClosing(false)
    }, 300) // Match animation duration
  }

  const handleToggleTagDropdown = () => {
    if (!isTagDropdownOpen && tagButtonRef.current) {
      const rect = tagButtonRef.current.getBoundingClientRect()
      const dropdownHeight = 192 // max-h-48 = 12rem = 192px

      // Always position dropdown above the button
      setTagDropdownPosition({
        top: rect.top - dropdownHeight - 4, // 4px gap
        left: rect.left,
      })
      setTagSearchQuery('') // Reset search when opening
    } else {
      setTagSearchQuery('') // Reset search when closing
    }
    setIsTagDropdownOpen(!isTagDropdownOpen)
  }

  const handleToggleCollectionDropdown = () => {
    if (!isCollectionDropdownOpen && collectionButtonRef.current) {
      const rect = collectionButtonRef.current.getBoundingClientRect()
      const dropdownHeight = 192 // max-h-48 = 12rem = 192px

      // Always position dropdown above the button
      setCollectionDropdownPosition({
        top: rect.top - dropdownHeight - 4, // 4px gap
        left: rect.left,
      })
      setCollectionSearchQuery('') // Reset search when opening
    } else {
      setCollectionSearchQuery('') // Reset search when closing
    }
    setIsCollectionDropdownOpen(!isCollectionDropdownOpen)
  }

  const availableTags = allTags.filter(t => !sample.tags.some(st => st.id === t.id))
  const availableCollections = collections.filter(c => !sample.collectionIds.includes(c.id))

  // Filter tags and collections based on search query
  const filteredTags = availableTags.filter(tag =>
    tag.name.toLowerCase().includes(tagSearchQuery.toLowerCase())
  )
  const filteredCollections = availableCollections.filter(col =>
    col.name.toLowerCase().includes(collectionSearchQuery.toLowerCase())
  )
  const sampleCollections = collections.filter(c => sample.collectionIds.includes(c.id))

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 z-40 transition-opacity duration-300 ${
          isClosing || isEntering ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={handleClose}
      />

      {/* Modal content - centered */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className={`bg-surface-raised rounded-xl flex flex-col w-full max-w-3xl max-h-[85vh] pointer-events-auto shadow-2xl border border-surface-border transition-all duration-300 ease-out ${
            isClosing || isEntering ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-surface-border bg-surface-raised">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-white">Sample Details</h3>
              {/* Navigation arrows */}
              {(onPrevious || onNext) && (
                <div className="flex items-center gap-1 ml-3">
                  <button
                    onClick={onPrevious}
                    disabled={!hasPrevious}
                    className="p-1.5 text-slate-400 hover:text-white rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-400"
                    title="Previous sample"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={onNext}
                    disabled={!hasNext}
                    className="p-1.5 text-slate-400 hover:text-white rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-400"
                    title="Next sample"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleClose}
              className="p-2 text-slate-400 hover:text-white rounded transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 space-y-4">
            {/* Waveform */}
            <SliceWaveform
              ref={waveformRef}
              sliceId={sample.id}
              height={80}
              onReady={() => setIsWaveformReady(true)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onFinish={() => setIsPlaying(false)}
            />

            {/* Playback controls */}
            <div className="flex items-center gap-4">
              <button
                onClick={handlePlayPause}
                disabled={!isWaveformReady}
                className="w-12 h-12 rounded-full bg-accent-primary flex items-center justify-center text-white hover:bg-accent-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
              </button>
              <div className="flex-1">
                <span className="text-sm text-slate-400">Duration</span>
                <p className="text-white font-medium text-lg">{formatDuration(sample.startTime, sample.endTime)}</p>
              </div>
              {onToggleFavorite && (
                <button
                  onClick={() => onToggleFavorite(sample.id)}
                  className={`p-2.5 rounded-lg transition-colors ${
                    sample.favorite
                      ? 'text-amber-400 bg-amber-400/20'
                      : 'text-slate-400 hover:text-amber-400 hover:bg-amber-400/20'
                  }`}
                >
                  <Heart size={20} className={sample.favorite ? 'fill-current' : ''} />
                </button>
              )}
              <button
                onClick={handleDownload}
                className="p-2.5 text-slate-400 hover:text-white hover:bg-surface-base rounded-lg transition-colors"
              >
                <Download size={20} />
              </button>
              {onEdit && (
                <button
                  onClick={onEdit}
                  className="p-2.5 text-slate-400 hover:text-white hover:bg-surface-base rounded-lg transition-colors"
                  title="Edit Source"
                >
                  <Scissors size={20} />
                </button>
              )}
            </div>

            {/* Name */}
            <div>
              <label className="text-sm font-medium text-slate-400 block mb-2">Name</label>
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
                    className="flex-1 px-3 py-2 text-sm bg-surface-base border border-surface-border rounded-lg text-white focus:outline-none focus:border-accent-primary"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveName}
                    className="p-2 text-emerald-400 hover:bg-emerald-400/20 rounded-lg transition-colors"
                  >
                    <Check size={18} />
                  </button>
                  <button
                    onClick={() => setIsEditingName(false)}
                    className="p-2 text-slate-400 hover:bg-surface-base rounded-lg transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-white text-base">{sample.name}</span>
                  {onUpdateName && (
                    <button
                      onClick={() => {
                        setEditedName(sample.name)
                        setIsEditingName(true)
                      }}
                      className="p-1.5 text-slate-400 hover:text-white rounded transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Source */}
            <div>
              <label className="text-sm font-medium text-slate-400 block mb-2">Source</label>
              <p className="text-white text-base">{sample.track.title}</p>
              {sample.track.folderPath && (
                <p className="text-sm text-slate-500 mt-1">{sample.track.folderPath}</p>
              )}
            </div>

            {/* Tags */}
            <div>
              <label className="text-sm font-medium text-slate-400 block mb-2">Tags</label>
              <div className="flex flex-wrap gap-2">
                {sample.tags.map(tag => (
                  <span
                    key={tag.id}
                    onClick={() => {
                      if (onTagClick) {
                        onTagClick(tag.id)
                        onClose()
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                    style={{
                      backgroundColor: tag.color + '25',
                      color: tag.color,
                    }}
                    title={onTagClick ? `Filter by ${tag.name}` : undefined}
                  >
                    {tag.name}
                    {onRemoveTag && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveTag(sample.id, tag.id)
                        }}
                        className="hover:opacity-70 transition-opacity"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </span>
                ))}

                {/* Add tag dropdown */}
                {onAddTag && availableTags.length > 0 && (
                  <div ref={tagDropdownRef}>
                    <button
                      ref={tagButtonRef}
                      onClick={handleToggleTagDropdown}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-surface-base text-slate-400 hover:text-slate-300 transition-colors"
                    >
                      <Plus size={12} />
                      <ChevronDown size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Collections */}
            <div>
              <label className="text-sm font-medium text-slate-400 block mb-2">Folders</label>
              <div className="flex flex-wrap gap-2">
                {sampleCollections.map(col => (
                  <span
                    key={col.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
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
                        <X size={12} />
                      </button>
                    )}
                  </span>
                ))}

                {/* Add to collection dropdown */}
                {onAddToCollection && availableCollections.length > 0 && (
                  <div ref={collectionDropdownRef}>
                    <button
                      ref={collectionButtonRef}
                      onClick={handleToggleCollectionDropdown}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-surface-base text-slate-400 hover:text-slate-300 transition-colors"
                    >
                      <Plus size={12} />
                      <ChevronDown size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tag dropdown - rendered with fixed positioning */}
      {isTagDropdownOpen && tagDropdownPosition && (
        <div
          className="tag-dropdown-menu fixed z-[60] w-48 bg-surface-raised border border-surface-border rounded-lg shadow-xl"
          style={{
            top: `${tagDropdownPosition.top}px`,
            left: `${tagDropdownPosition.left}px`,
          }}
        >
          {/* Search input */}
          <div className="p-2 border-b border-surface-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
              <input
                type="text"
                value={tagSearchQuery}
                onChange={(e) => setTagSearchQuery(e.target.value)}
                placeholder="Search tags..."
                className="w-full pl-7 pr-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Tag list */}
          <div className="max-h-40 overflow-y-auto">
            {filteredTags.length > 0 ? (
              filteredTags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => {
                    onAddTag?.(sample.id, tag.id)
                    setIsTagDropdownOpen(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-base flex items-center gap-2"
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span style={{ color: tag.color }}>{tag.name}</span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-slate-500">No tags found</div>
            )}
          </div>
        </div>
      )}

      {/* Collection dropdown - rendered with fixed positioning */}
      {isCollectionDropdownOpen && collectionDropdownPosition && (
        <div
          className="collection-dropdown-menu fixed z-[60] w-48 bg-surface-raised border border-surface-border rounded-lg shadow-xl"
          style={{
            top: `${collectionDropdownPosition.top}px`,
            left: `${collectionDropdownPosition.left}px`,
          }}
        >
          {/* Search input */}
          <div className="p-2 border-b border-surface-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
              <input
                type="text"
                value={collectionSearchQuery}
                onChange={(e) => setCollectionSearchQuery(e.target.value)}
                placeholder="Search folders..."
                className="w-full pl-7 pr-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Collection list */}
          <div className="max-h-40 overflow-y-auto">
            {filteredCollections.length > 0 ? (
              filteredCollections.map(col => (
                <button
                  key={col.id}
                  onClick={() => {
                    onAddToCollection?.(col.id, sample.id)
                    setIsCollectionDropdownOpen(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-base flex items-center gap-2"
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: col.color }}
                  />
                  <span style={{ color: col.color }}>{col.name}</span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-slate-500">No folders found</div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
