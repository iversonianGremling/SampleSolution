import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play, Pause, Heart, Download, X, Plus, ChevronDown, Edit2, Check, Scissors, Search, ChevronLeft, ChevronRight, Sparkles, Activity, Disc3 } from 'lucide-react'
import type { SliceWithTrackExtended, Tag, Folder, AudioFeatures } from '../types'
import { getSliceDownloadUrl, updateTrack } from '../api/client'
import { InstrumentIcon } from './InstrumentIcon'
import { freqToNoteName } from '../utils/musicTheory'
import { SliceWaveform, type SliceWaveformRef } from './SliceWaveform'
import { DrumRackPadPicker } from './DrumRackPadPicker'

// Helper component to display a feature value
function FeatureItem({
  label,
  value,
  unit,
  decimals = 2,
  isText = false
}: {
  label: string
  value: number | string | null | undefined
  unit?: string
  decimals?: number
  isText?: boolean
}) {
  if (value === null || value === undefined) {
    return (
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-sm text-slate-600">-</div>
      </div>
    )
  }

  const displayValue = isText
    ? String(value)
    : typeof value === 'number'
    ? value.toFixed(decimals)
    : value

  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm text-white font-mono">
        {displayValue}
        {unit && <span className="text-slate-400 ml-1">{unit}</span>}
      </div>
    </div>
  )
}

interface SimilarSample {
  id: number
  name: string
  filePath: string
  similarity: number
  track: {
    title: string
  }
}

function SimilarSamplesSection({ sampleId }: { sampleId: number }) {
  const [hoveredSample, setHoveredSample] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const { data: similarSamples, isLoading } = useQuery<SimilarSample[]>({
    queryKey: ['similar-samples', sampleId],
    queryFn: async () => {
      const res = await fetch(`/api/slices/${sampleId}/similar?limit=6`)
      if (!res.ok) {
        if (res.status === 404) return []
        throw new Error('Failed to fetch similar samples')
      }
      return res.json()
    },
  })

  // Defensive UI guard: never render the currently-open sample in its own similar list,
  // even if a stale cached response or backend edge case includes it.
  const currentSampleId = Number(sampleId)
  const visibleSimilarSamples = (similarSamples ?? []).filter((sample) => {
    const candidateId = Number(sample.id)
    return Number.isFinite(candidateId) && candidateId !== currentSampleId
  })

  const handleMouseEnter = (similarSampleId: number) => {
    setHoveredSample(similarSampleId)
    if (audioRef.current) {
      audioRef.current.pause()
    }
    audioRef.current = new Audio(getSliceDownloadUrl(similarSampleId))
    audioRef.current.volume = 0.5
    audioRef.current.play().catch(() => {
      // Ignore play errors (e.g., user hasn't interacted with page yet)
    })
  }

  const handleMouseLeave = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setHoveredSample(null)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  if (isLoading) {
    return (
      <div>
        <label className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-2">
          <Sparkles size={14} />
          Similar Samples
        </label>
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    )
  }

  if (visibleSimilarSamples.length === 0) {
    return null
  }

  return (
    <div>
      <label className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-2">
        <Sparkles size={14} />
        Similar Samples
      </label>
      <div className="grid grid-cols-3 gap-2">
        {visibleSimilarSamples.map((sample) => {
          const sampleIdNum = Number(sample.id)
          if (!Number.isFinite(sampleIdNum)) return null

          return (
            <button
              key={sampleIdNum}
              onMouseEnter={() => handleMouseEnter(sampleIdNum)}
              onMouseLeave={handleMouseLeave}
              onClick={() => {
                // Navigate to this sample - will be handled by parent
                window.location.hash = `sample-${sampleIdNum}`
              }}
              className={`group relative p-3 rounded-lg border transition-all ${
                hoveredSample === sampleIdNum
                  ? 'border-accent-primary bg-accent-primary/10 scale-105'
                  : 'border-surface-border bg-surface-base hover:border-slate-600'
              }`}
            >
              {/* Similarity badge */}
              <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-900/90 text-slate-300">
                {Math.round(sample.similarity * 100)}%
              </div>

              {/* Content */}
              <div className="flex items-center gap-2 mb-1">
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                  hoveredSample === sampleIdNum ? 'bg-accent-primary' : 'bg-slate-700'
                }`}>
                  {hoveredSample === sampleIdNum ? (
                    <Pause size={12} className="text-white" />
                  ) : (
                    <Play size={12} className="text-white ml-0.5" />
                  )}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-xs font-medium text-white truncate">
                    {sample.name}
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-slate-500 truncate text-left">
                {sample.track.title}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface SourcesDetailModalProps {
  sample: SliceWithTrackExtended | null
  allTags: Tag[]
  folders: Folder[]
  onClose: () => void
  onToggleFavorite?: (id: number) => void
  onAddTag?: (sliceId: number, tagId: number) => void
  onRemoveTag?: (sliceId: number, tagId: number) => void
  onAddToFolder?: (folderId: number, sliceId: number) => void
  onRemoveFromFolder?: (folderId: number, sliceId: number) => void
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
  folders,
  onClose,
  onToggleFavorite,
  onAddTag,
  onRemoveTag,
  onAddToFolder,
  onRemoveFromFolder,
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
  const [isFolderDropdownOpen, setIsFolderDropdownOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [isEntering, setIsEntering] = useState(true)
  const [tagDropdownPosition, setTagDropdownPosition] = useState<{ top: number; left: number } | null>(null)
  const [folderDropdownPosition, setFolderDropdownPosition] = useState<{ top: number; left: number } | null>(null)
  const [tagSearchQuery, setTagSearchQuery] = useState('')
  const [folderSearchQuery, setFolderSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'details' | 'advanced'>('details')
  const [showPadPicker, setShowPadPicker] = useState(false)
  const [editingArtist, setEditingArtist] = useState(false)
  const [editingAlbum, setEditingAlbum] = useState(false)
  const [artistValue, setArtistValue] = useState('')
  const [albumValue, setAlbumValue] = useState('')
  const waveformRef = useRef<SliceWaveformRef>(null)
  const tagDropdownRef = useRef<HTMLDivElement>(null)
  const folderDropdownRef = useRef<HTMLDivElement>(null)
  const tagButtonRef = useRef<HTMLButtonElement>(null)
  const folderButtonRef = useRef<HTMLButtonElement>(null)

  // Fetch audio features for the advanced tab
  const { data: audioFeatures } = useQuery<AudioFeatures>({
    queryKey: ['audioFeatures', sample?.id],
    queryFn: async () => {
      const res = await fetch(`/api/slices/${sample?.id}/features`)
      if (!res.ok) throw new Error('Failed to fetch audio features')
      return res.json()
    },
    enabled: !!sample && activeTab === 'advanced',
  })

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

      // Check if click is outside folder dropdown (both button and dropdown menu)
      if (isFolderDropdownOpen) {
        const clickedButton = folderDropdownRef.current?.contains(target)
        const clickedDropdown = (e.target as Element).closest('.folder-dropdown-menu')
        if (!clickedButton && !clickedDropdown) {
          setIsFolderDropdownOpen(false)
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isTagDropdownOpen, isFolderDropdownOpen])

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

  const handleToggleFolderDropdown = () => {
    if (!isFolderDropdownOpen && folderButtonRef.current) {
      const rect = folderButtonRef.current.getBoundingClientRect()
      const dropdownHeight = 192 // max-h-48 = 12rem = 192px

      // Always position dropdown above the button
      setFolderDropdownPosition({
        top: rect.top - dropdownHeight - 4, // 4px gap
        left: rect.left,
      })
      setFolderSearchQuery('') // Reset search when opening
    } else {
      setFolderSearchQuery('') // Reset search when closing
    }
    setIsFolderDropdownOpen(!isFolderDropdownOpen)
  }

  const availableTags = allTags.filter(t => !sample.tags.some(st => st.id === t.id))
  const availableFolders = folders.filter(c => !sample.folderIds.includes(c.id))

  // Filter tags and folders based on search query
  const filteredTags = availableTags.filter(tag =>
    tag.name.toLowerCase().includes(tagSearchQuery.toLowerCase())
  )
  const filteredFolders = availableFolders.filter(col =>
    col.name.toLowerCase().includes(folderSearchQuery.toLowerCase())
  )
  const sampleFolders = folders.filter(c => sample.folderIds.includes(c.id))

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

          {/* Tabs */}
          <div className="flex border-b border-surface-border bg-surface-raised px-4">
            <button
              onClick={() => setActiveTab('details')}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                activeTab === 'details'
                  ? 'text-white border-accent-primary'
                  : 'text-slate-400 border-transparent hover:text-slate-300'
              }`}
            >
              Details
            </button>
            <button
              onClick={() => setActiveTab('advanced')}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
                activeTab === 'advanced'
                  ? 'text-white border-accent-primary'
                  : 'text-slate-400 border-transparent hover:text-slate-300'
              }`}
            >
              <Activity size={14} />
              Advanced Features
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 space-y-4">
            {activeTab === 'details' && (
              <>
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
                title="Download"
              >
                <Download size={20} />
              </button>
              <button
                onClick={() => setShowPadPicker(true)}
                className="p-2.5 text-slate-400 hover:text-accent-primary hover:bg-accent-primary/20 rounded-lg transition-colors"
                title="Send to Drum Rack"
              >
                <Disc3 size={20} />
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

            {/* Instrument Type */}
            {(sample.instrumentType || sample.instrumentPrimary) && (
              <div>
                <label className="text-sm font-medium text-slate-400 block mb-2">Instrument</label>
                <div className="flex items-center gap-2 text-white">
                  <InstrumentIcon type={sample.instrumentType || sample.instrumentPrimary || 'other'} size={18} />
                  <span className="capitalize">{sample.instrumentType || sample.instrumentPrimary}</span>
                </div>
              </div>
            )}

            {/* Artist */}
            <div>
              <label className="text-sm font-medium text-slate-400 block mb-2">Artist</label>
              {editingArtist ? (
                <input
                  type="text"
                  value={artistValue}
                  onChange={(e) => setArtistValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      updateTrack(sample.trackId, { artist: artistValue.trim() || undefined })
                      setEditingArtist(false)
                    }
                    if (e.key === 'Escape') setEditingArtist(false)
                  }}
                  onBlur={() => {
                    updateTrack(sample.trackId, { artist: artistValue.trim() || undefined })
                    setEditingArtist(false)
                  }}
                  autoFocus
                  className="w-full px-2 py-1 bg-surface-base border border-accent-primary rounded text-white text-sm focus:outline-none"
                  placeholder="Add artist..."
                />
              ) : (
                <div
                  className="flex items-center gap-2 cursor-pointer group"
                  onClick={() => {
                    setArtistValue(sample.track.artist || '')
                    setEditingArtist(true)
                  }}
                >
                  <span className={`text-sm ${sample.track.artist ? 'text-white' : 'text-slate-500'}`}>
                    {sample.track.artist || 'No artist'}
                  </span>
                  <Edit2 size={12} className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              )}
            </div>

            {/* Album */}
            <div>
              <label className="text-sm font-medium text-slate-400 block mb-2">Album</label>
              {editingAlbum ? (
                <input
                  type="text"
                  value={albumValue}
                  onChange={(e) => setAlbumValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      updateTrack(sample.trackId, { album: albumValue.trim() || undefined })
                      setEditingAlbum(false)
                    }
                    if (e.key === 'Escape') setEditingAlbum(false)
                  }}
                  onBlur={() => {
                    updateTrack(sample.trackId, { album: albumValue.trim() || undefined })
                    setEditingAlbum(false)
                  }}
                  autoFocus
                  className="w-full px-2 py-1 bg-surface-base border border-accent-primary rounded text-white text-sm focus:outline-none"
                  placeholder="Add album..."
                />
              ) : (
                <div
                  className="flex items-center gap-2 cursor-pointer group"
                  onClick={() => {
                    setAlbumValue(sample.track.album || '')
                    setEditingAlbum(true)
                  }}
                >
                  <span className={`text-sm ${sample.track.album ? 'text-white' : 'text-slate-500'}`}>
                    {sample.track.album || 'No album'}
                  </span>
                  <Edit2 size={12} className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
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

            {/* Folders */}
            <div>
              <label className="text-sm font-medium text-slate-400 block mb-2">Folders</label>
              <div className="flex flex-wrap gap-2">
                {sampleFolders.map(col => (
                  <span
                    key={col.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
                    style={{
                      backgroundColor: col.color + '25',
                      color: col.color,
                    }}
                  >
                    {col.name}
                    {onRemoveFromFolder && (
                      <button
                        onClick={() => onRemoveFromFolder(col.id, sample.id)}
                        className="hover:opacity-70 transition-opacity"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </span>
                ))}

                {/* Add to folder dropdown */}
                {onAddToFolder && availableFolders.length > 0 && (
                  <div ref={folderDropdownRef}>
                    <button
                      ref={folderButtonRef}
                      onClick={handleToggleFolderDropdown}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-surface-base text-slate-400 hover:text-slate-300 transition-colors"
                    >
                      <Plus size={12} />
                      <ChevronDown size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Similar Samples */}
            <SimilarSamplesSection sampleId={sample.id} />
              </>
            )}

            {/* Advanced Features Tab */}
            {activeTab === 'advanced' && (
              <div className="space-y-4">
                {!audioFeatures ? (
                  <div className="flex items-center justify-center py-12 text-slate-400">
                    Loading audio features...
                  </div>
                ) : (
                  <>
                    {/* Spectral Features */}
                    <div className="bg-surface-base rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                        <Activity size={14} className="text-accent-primary" />
                        Spectral Features
                      </h4>
                      <div className="grid grid-cols-2 gap-3">
                        <FeatureItem label="Spectral Centroid" value={audioFeatures.spectralCentroid} unit="Hz" decimals={0} />
                        <FeatureItem label="Spectral Rolloff" value={audioFeatures.spectralRolloff} unit="Hz" decimals={0} />
                        <FeatureItem label="Spectral Bandwidth" value={audioFeatures.spectralBandwidth} unit="Hz" decimals={0} />
                        <FeatureItem label="Spectral Contrast" value={audioFeatures.spectralContrast} decimals={3} />
                        <FeatureItem label="Spectral Flux" value={audioFeatures.spectralFlux} decimals={3} />
                        <FeatureItem label="Spectral Flatness" value={audioFeatures.spectralFlatness} decimals={3} />
                        <FeatureItem label="Spectral Crest" value={audioFeatures.spectralCrest} decimals={3} />
                        <FeatureItem label="Zero Crossing Rate" value={audioFeatures.zeroCrossingRate} decimals={3} />
                      </div>
                    </div>

                    {/* Energy & Dynamics */}
                    <div className="bg-surface-base rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-white mb-3">Energy & Dynamics</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <FeatureItem label="RMS Energy" value={audioFeatures.rmsEnergy} decimals={4} />
                        <FeatureItem label="Loudness" value={audioFeatures.loudness} unit="dB" decimals={2} />
                        <FeatureItem label="Dynamic Range" value={audioFeatures.dynamicRange} unit="dB" decimals={2} />
                        <FeatureItem label="Integrated Loudness" value={audioFeatures.loudnessIntegrated} unit="LUFS" decimals={2} />
                        <FeatureItem label="Loudness Range" value={audioFeatures.loudnessRange} unit="LU" decimals={2} />
                        <FeatureItem label="True Peak" value={audioFeatures.truePeak} unit="dBTP" decimals={2} />
                      </div>
                    </div>

                    {/* Rhythm & Temporal */}
                    <div className="bg-surface-base rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-white mb-3">Rhythm & Temporal</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <FeatureItem label="BPM" value={audioFeatures.bpm} decimals={1} />
                        <FeatureItem label="Onset Count" value={audioFeatures.onsetCount} decimals={0} />
                        <FeatureItem label="Onset Rate" value={audioFeatures.onsetRate} unit="/s" decimals={2} />
                        <FeatureItem label="Beat Strength" value={audioFeatures.beatStrength} decimals={3} />
                        <FeatureItem label="Rhythmic Regularity" value={audioFeatures.rhythmicRegularity} decimals={3} />
                        <FeatureItem label="Danceability" value={audioFeatures.danceability} decimals={3} />
                        <FeatureItem label="Attack Time" value={audioFeatures.attackTime} unit="s" decimals={3} />
                        <FeatureItem label="Kurtosis" value={audioFeatures.kurtosis} decimals={3} />
                      </div>
                    </div>

                    {/* Perceptual Features */}
                    {(audioFeatures.brightness !== null || audioFeatures.warmth !== null || audioFeatures.hardness !== null) && (
                      <div className="bg-surface-base rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-white mb-3">Perceptual Features</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <FeatureItem label="Brightness" value={audioFeatures.brightness} decimals={3} />
                          <FeatureItem label="Warmth" value={audioFeatures.warmth} decimals={3} />
                          <FeatureItem label="Hardness" value={audioFeatures.hardness} decimals={3} />
                          <FeatureItem label="Roughness" value={audioFeatures.roughness} decimals={3} />
                          <FeatureItem label="Sharpness" value={audioFeatures.sharpness} decimals={3} />
                        </div>
                      </div>
                    )}

                    {/* Timbral Features */}
                    {(audioFeatures.dissonance !== null || audioFeatures.inharmonicity !== null) && (
                      <div className="bg-surface-base rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-white mb-3">Timbral Features</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <FeatureItem label="Dissonance" value={audioFeatures.dissonance} decimals={3} />
                          <FeatureItem label="Inharmonicity" value={audioFeatures.inharmonicity} decimals={3} />
                          <FeatureItem label="Spectral Complexity" value={audioFeatures.spectralComplexity} decimals={3} />
                        </div>
                      </div>
                    )}

                    {/* Envelope (ADSR) */}
                    {audioFeatures.envelopeType && (
                      <div className="bg-surface-base rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-white mb-3">Envelope (ADSR)</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <FeatureItem label="Type" value={audioFeatures.envelopeType} isText />
                          <FeatureItem label="Decay Time" value={audioFeatures.decayTime} unit="s" decimals={3} />
                          <FeatureItem label="Sustain Level" value={audioFeatures.sustainLevel} decimals={3} />
                          <FeatureItem label="Release Time" value={audioFeatures.releaseTime} unit="s" decimals={3} />
                        </div>
                      </div>
                    )}

                    {/* Harmonic/Percussive */}
                    {audioFeatures.harmonicPercussiveRatio !== null && (
                      <div className="bg-surface-base rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-white mb-3">Harmonic / Percussive</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <FeatureItem label="H/P Ratio" value={audioFeatures.harmonicPercussiveRatio} decimals={3} />
                          <FeatureItem label="Harmonic Energy" value={audioFeatures.harmonicEnergy} decimals={4} />
                          <FeatureItem label="Percussive Energy" value={audioFeatures.percussiveEnergy} decimals={4} />
                          <FeatureItem label="Harmonic Centroid" value={audioFeatures.harmonicCentroid} unit="Hz" decimals={0} />
                          <FeatureItem label="Percussive Centroid" value={audioFeatures.percussiveCentroid} unit="Hz" decimals={0} />
                        </div>
                      </div>
                    )}

                    {/* Stereo Analysis */}
                    {audioFeatures.stereoWidth !== null && (
                      <div className="bg-surface-base rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-white mb-3">Stereo Analysis</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <FeatureItem label="Stereo Width" value={audioFeatures.stereoWidth} decimals={3} />
                          <FeatureItem label="Panning Center" value={audioFeatures.panningCenter} decimals={3} />
                          <FeatureItem label="Stereo Imbalance" value={audioFeatures.stereoImbalance} decimals={3} />
                        </div>
                      </div>
                    )}

                    {/* Fundamental Frequency (one-shots) or Key Detection (loops) */}
                    {audioFeatures.isOneShot ? (
                      audioFeatures.fundamentalFrequency && (
                        <div className="bg-surface-base rounded-lg p-4">
                          <h4 className="text-sm font-semibold text-white mb-3">Fundamental Frequency</h4>
                          <div className="grid grid-cols-2 gap-3">
                            <FeatureItem label="Frequency" value={audioFeatures.fundamentalFrequency} unit="Hz" decimals={1} />
                            <FeatureItem label="Note" value={freqToNoteName(audioFeatures.fundamentalFrequency)} isText />
                          </div>
                        </div>
                      )
                    ) : (
                      audioFeatures.keyEstimate && (
                        <div className="bg-surface-base rounded-lg p-4">
                          <h4 className="text-sm font-semibold text-white mb-3">Key Detection</h4>
                          <div className="grid grid-cols-2 gap-3">
                            <FeatureItem label="Key" value={audioFeatures.keyEstimate} isText />
                            <FeatureItem label="Key Strength" value={audioFeatures.keyStrength} decimals={3} />
                          </div>
                        </div>
                      )
                    )}

                    {/* ML Classifications */}
                    {(audioFeatures.instrumentClasses || audioFeatures.genreClasses) && (() => {
                      // Filter out generic/useless YAMNet classes
                      const ML_BLOCKLIST = new Set([
                        'music', 'singing', 'song', 'speech', 'tender music', 'sad music',
                        'happy music', 'music of asia', 'music of africa', 'music of latin america',
                        'pop music', 'rock music', 'hip hop music', 'electronic music',
                        'christian music', 'wedding music', 'new-age music', 'independent music',
                        'musical instrument', 'plucked string instrument', 'bowed string instrument',
                        'sound effect', 'noise',
                      ])
                      const filteredInstruments = audioFeatures.instrumentClasses
                        ?.filter(inst => !ML_BLOCKLIST.has(inst.class.toLowerCase()) && !inst.class.includes('/m/'))
                      const hasInstruments = filteredInstruments && filteredInstruments.length > 0
                      const hasGenres = audioFeatures.genreClasses && audioFeatures.genreClasses.length > 0
                      if (!hasInstruments && !hasGenres) return null
                      return (
                      <div className="bg-surface-base rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-white mb-3">ML Classifications</h4>
                        {hasInstruments && (
                          <div className="mb-3">
                            <div className="text-xs text-slate-400 mb-1.5">Instruments:</div>
                            <div className="space-y-1">
                              {filteredInstruments!.slice(0, 5).map((inst, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 bg-surface-raised rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-accent-primary rounded-full"
                                      style={{ width: `${inst.confidence * 100}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-slate-300 w-20 capitalize">{inst.class}</span>
                                  <span className="text-xs text-slate-500 w-10 text-right">{Math.round(inst.confidence * 100)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {hasGenres && (
                          <div>
                            <div className="text-xs text-slate-400 mb-1.5">Genres:</div>
                            <div className="space-y-1">
                              {audioFeatures.genreClasses!.slice(0, 5).map((genre, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 bg-surface-raised rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-accent-primary rounded-full"
                                      style={{ width: `${genre.confidence * 100}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-slate-300 w-20 capitalize">{genre.genre}</span>
                                  <span className="text-xs text-slate-500 w-10 text-right">{Math.round(genre.confidence * 100)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      )
                    })()}
                  </>
                )}
              </div>
            )}
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

      {/* Drum Rack Pad Picker */}
      {showPadPicker && (
        <DrumRackPadPicker
          sample={sample}
          onClose={() => setShowPadPicker(false)}
        />
      )}

      {/* Folder dropdown - rendered with fixed positioning */}
      {isFolderDropdownOpen && folderDropdownPosition && (
        <div
          className="folder-dropdown-menu fixed z-[60] w-48 bg-surface-raised border border-surface-border rounded-lg shadow-xl"
          style={{
            top: `${folderDropdownPosition.top}px`,
            left: `${folderDropdownPosition.left}px`,
          }}
        >
          {/* Search input */}
          <div className="p-2 border-b border-surface-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
              <input
                type="text"
                value={folderSearchQuery}
                onChange={(e) => setFolderSearchQuery(e.target.value)}
                placeholder="Search folders..."
                className="w-full pl-7 pr-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Folder list */}
          <div className="max-h-40 overflow-y-auto">
            {filteredFolders.length > 0 ? (
              filteredFolders.map(col => (
                <button
                  key={col.id}
                  onClick={() => {
                    onAddToFolder?.(col.id, sample.id)
                    setIsFolderDropdownOpen(false)
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
