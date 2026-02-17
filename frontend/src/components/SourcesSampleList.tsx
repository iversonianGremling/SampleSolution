import { useState, useRef, useEffect, useMemo } from 'react'
import { Loader2, ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, GripVertical } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  SourcesSampleListRow,
  DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY,
  DEFAULT_SOURCES_LIST_COLUMN_WIDTHS,
  type SourcesListColumnVisibility,
  type SourcesListColumnWidths,
  type SourcesListColumnWidthKey,
} from './SourcesSampleListRow'
import { CustomCheckbox } from './CustomCheckbox'
import { createDragPreview } from './DragPreview'
import type { SliceWithTrackExtended } from '../types'
import { getSliceDownloadUrl } from '../api/client'
import { createManagedAudio, releaseManagedAudio } from '../services/globalAudioVolume'
import { freqToNoteName } from '../utils/musicTheory'

type SortField =
  | 'name'
  | 'tags'
  | 'artist'
  | 'album'
  | 'year'
  | 'bpm'
  | 'key'
  | 'scale'
  | 'envelope'
  | 'brightness'
  | 'noisiness'
  | 'warmth'
  | 'hardness'
  | 'sharpness'
  | 'loudness'
  | 'sampleRate'
  | 'channels'
  | 'format'
  | 'polyphony'
  | 'dateAdded'
  | 'dateCreated'
  | 'dateModified'
  | 'path'
  | 'duration'
  | 'similarity'
type SortOrder = 'asc' | 'desc'
export type PlayMode = 'normal' | 'one-shot' | 'reproduce-while-clicking'

type ColumnKey = keyof SourcesListColumnVisibility
type MenuPosition = { top: number; left: number }
type ResizeState = {
  key: SourcesListColumnWidthKey
  startX: number
  startWidth: number
}

const COLUMN_VISIBILITY_STORAGE_KEY = 'sources-list-column-visibility-v1'
const COLUMN_WIDTHS_STORAGE_KEY = 'sources-list-column-widths-v1'

const MIN_COLUMN_WIDTHS: SourcesListColumnWidths = {
  name: 160,
  tags: 100,
  artist: 100,
  album: 100,
  year: 56,
  bpm: 56,
  key: 64,
  scale: 64,
  envelope: 72,
  brightness: 72,
  noisiness: 72,
  warmth: 72,
  hardness: 72,
  sharpness: 72,
  loudness: 72,
  sampleRate: 72,
  channels: 64,
  format: 64,
  polyphony: 72,
  dateAdded: 92,
  dateCreated: 92,
  dateModified: 92,
  path: 140,
  duration: 68,
  similarity: 72,
  actions: 84,
}

const MAX_COLUMN_WIDTH = 520

const COLUMN_OPTIONS: Array<{ key: ColumnKey; label: string }> = [
  { key: 'tags', label: 'Tags' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'year', label: 'Year' },
  { key: 'bpm', label: 'BPM' },
  { key: 'key', label: 'Key' },
  { key: 'scale', label: 'Scale' },
  { key: 'envelope', label: 'Envelope' },
  { key: 'brightness', label: 'Brightness Bar' },
  { key: 'noisiness', label: 'Noisiness Bar' },
  { key: 'warmth', label: 'Warmth Bar' },
  { key: 'hardness', label: 'Hardness Bar' },
  { key: 'sharpness', label: 'Sharpness Bar' },
  { key: 'loudness', label: 'Loudness' },
  { key: 'sampleRate', label: 'Sample Rate' },
  { key: 'channels', label: 'Channels' },
  { key: 'format', label: 'Format' },
  { key: 'polyphony', label: 'Polyphony' },
  { key: 'dateAdded', label: 'Date Added' },
  { key: 'dateCreated', label: 'Date Created' },
  { key: 'dateModified', label: 'Date Modified' },
  { key: 'path', label: 'Path' },
]

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function getPathDisplay(sample: SliceWithTrackExtended): string | null {
  return sample.pathDisplay || sample.track.relativePath || sample.track.originalPath || null
}

function getKeyDisplay(sample: SliceWithTrackExtended): string | null {
  return (sample.fundamentalFrequency ? freqToNoteName(sample.fundamentalFrequency) : null) || sample.keyEstimate || null
}

function getSortValue(sample: SliceWithTrackExtended, field: SortField): string | number | null {
  switch (field) {
    case 'name':
      return sample.name.toLowerCase()
    case 'tags':
      return sample.tags.map((tag) => tag.name.toLowerCase()).join(',')
    case 'artist':
      return sample.track.artist?.toLowerCase() ?? null
    case 'album':
      return sample.track.album?.toLowerCase() ?? null
    case 'year':
      return sample.track.year ?? null
    case 'bpm':
      return sample.bpm ?? null
    case 'key':
      return getKeyDisplay(sample)?.toLowerCase() ?? null
    case 'scale':
      return sample.scale?.toLowerCase() ?? null
    case 'envelope':
      return sample.envelopeType?.toLowerCase() ?? null
    case 'brightness':
      return sample.subjectiveNormalized?.brightness ?? sample.brightness ?? null
    case 'noisiness':
      return sample.subjectiveNormalized?.noisiness ?? sample.noisiness ?? null
    case 'warmth':
      return sample.subjectiveNormalized?.warmth ?? sample.warmth ?? null
    case 'hardness':
      return sample.subjectiveNormalized?.hardness ?? sample.hardness ?? null
    case 'sharpness':
      return sample.subjectiveNormalized?.sharpness ?? sample.sharpness ?? null
    case 'loudness':
      return sample.loudness ?? null
    case 'sampleRate':
      return sample.sampleRate ?? null
    case 'channels':
      return sample.channels ?? null
    case 'format':
      return sample.format?.toLowerCase() ?? null
    case 'polyphony':
      return sample.polyphony ?? null
    case 'dateAdded':
      return parseDate(sample.dateAdded || sample.createdAt)
    case 'dateCreated':
      return parseDate(sample.dateCreated)
    case 'dateModified':
      return parseDate(sample.dateModified)
    case 'path':
      return getPathDisplay(sample)?.toLowerCase() ?? null
    case 'duration':
      return sample.endTime - sample.startTime
    case 'similarity':
      return sample.similarity ?? null
    default:
      return null
  }
}

interface SourcesSampleListProps {
  samples: SliceWithTrackExtended[]
  selectedId: number | null
  selectedIds: Set<number>
  onSelect: (id: number) => void
  onToggleSelect: (id: number) => void
  onToggleSelectAll: () => void
  onToggleFavorite: (id: number) => void
  onUpdateName: (id: number, name: string) => void
  onDelete: (id: number) => void
  onTagClick?: (tagId: number) => void
  isLoading?: boolean
  playMode?: PlayMode
  loopEnabled?: boolean
  similarityMode?: {
    enabled: boolean
    referenceSampleId: number
    referenceSampleName: string
  } | null
}

function loadColumnVisibility(): SourcesListColumnVisibility {
  if (typeof window === 'undefined') {
    return DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY
  }

  try {
    const raw = window.localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY)
    if (!raw) return DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY
    const parsed = JSON.parse(raw) as Partial<SourcesListColumnVisibility>
    return {
      ...DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY,
      ...parsed,
      envelope: parsed.envelope ?? false,
      loudness: parsed.loudness ?? true,
    }
  } catch {
    return DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY
  }
}

function loadColumnWidths(): SourcesListColumnWidths {
  if (typeof window === 'undefined') {
    return DEFAULT_SOURCES_LIST_COLUMN_WIDTHS
  }

  try {
    const raw = window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY)
    if (!raw) return DEFAULT_SOURCES_LIST_COLUMN_WIDTHS
    const parsed = JSON.parse(raw) as Partial<SourcesListColumnWidths>

    const sanitizedEntries = (Object.keys(DEFAULT_SOURCES_LIST_COLUMN_WIDTHS) as SourcesListColumnWidthKey[])
      .map((key) => {
        const value = parsed[key]
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          return [key, DEFAULT_SOURCES_LIST_COLUMN_WIDTHS[key]] as const
        }
        const min = MIN_COLUMN_WIDTHS[key]
        return [key, Math.max(min, Math.min(MAX_COLUMN_WIDTH, value))] as const
      })

    return Object.fromEntries(sanitizedEntries) as SourcesListColumnWidths
  } catch {
    return DEFAULT_SOURCES_LIST_COLUMN_WIDTHS
  }
}

function getRowMinWidth(
  columnVisibility: SourcesListColumnVisibility,
  columnWidths: SourcesListColumnWidths,
  showSimilarity = false
): number {
  let width = 0

  // checkbox + play button + instrument slot
  width += 24
  width += 40
  width += 16

  // always visible content columns
  width += columnWidths.name
  width += columnWidths.duration
  width += columnWidths.actions

  if (columnVisibility.tags) width += columnWidths.tags
  if (columnVisibility.artist) width += columnWidths.artist
  if (columnVisibility.album) width += columnWidths.album
  if (columnVisibility.year) width += columnWidths.year
  if (columnVisibility.bpm) width += columnWidths.bpm
  if (columnVisibility.key) width += columnWidths.key
  if (columnVisibility.scale) width += columnWidths.scale
  if (columnVisibility.envelope) width += columnWidths.envelope
  if (columnVisibility.brightness) width += columnWidths.brightness
  if (columnVisibility.noisiness) width += columnWidths.noisiness
  if (columnVisibility.warmth) width += columnWidths.warmth
  if (columnVisibility.hardness) width += columnWidths.hardness
  if (columnVisibility.sharpness) width += columnWidths.sharpness
  if (columnVisibility.loudness) width += columnWidths.loudness
  if (columnVisibility.sampleRate) width += columnWidths.sampleRate
  if (columnVisibility.channels) width += columnWidths.channels
  if (columnVisibility.format) width += columnWidths.format
  if (columnVisibility.polyphony) width += columnWidths.polyphony
  if (columnVisibility.dateAdded) width += columnWidths.dateAdded
  if (columnVisibility.dateCreated) width += columnWidths.dateCreated
  if (columnVisibility.dateModified) width += columnWidths.dateModified
  if (columnVisibility.path) width += columnWidths.path
  if (showSimilarity) width += columnWidths.similarity

  // row gaps + left/right padding
  width += 260

  return width
}

export function SourcesSampleList({
  samples,
  selectedId,
  selectedIds,
  onSelect,
  onToggleSelect,
  onToggleSelectAll,
  onToggleFavorite,
  onUpdateName,
  onDelete,
  onTagClick,
  isLoading = false,
  playMode = 'normal',
  loopEnabled = false,
  similarityMode = null,
}: SourcesSampleListProps) {
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const listContainerRef = useRef<HTMLDivElement>(null)
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [columnVisibility, setColumnVisibility] = useState<SourcesListColumnVisibility>(loadColumnVisibility)
  const [columnWidths, setColumnWidths] = useState<SourcesListColumnWidths>(loadColumnWidths)
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [columnsMenuPosition, setColumnsMenuPosition] = useState<MenuPosition>({ top: 0, left: 0 })
  const dragPreviewRef = useRef<HTMLElement | null>(null)
  const columnsMenuRef = useRef<HTMLDivElement>(null)
  const columnsMenuPopoverRef = useRef<HTMLDivElement>(null)
  const columnsMenuButtonRef = useRef<HTMLButtonElement>(null)
  const resizeStateRef = useRef<ResizeState | null>(null)

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        releaseManagedAudio(audioRef.current)
        audioRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility))
    }
  }, [columnVisibility])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths))
    }
  }, [columnWidths])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (!columnsMenuRef.current) return
      if (columnsMenuRef.current.contains(target)) return
      if (columnsMenuPopoverRef.current?.contains(target)) return
      setShowColumnsMenu(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resize = resizeStateRef.current
      if (!resize) return

      const delta = event.clientX - resize.startX
      const minWidth = MIN_COLUMN_WIDTHS[resize.key]
      const nextWidth = Math.max(minWidth, Math.min(MAX_COLUMN_WIDTH, resize.startWidth + delta))

      setColumnWidths((prev) => {
        if (prev[resize.key] === nextWidth) return prev
        return {
          ...prev,
          [resize.key]: nextWidth,
        }
      })
    }

    const handleMouseUp = () => {
      if (!resizeStateRef.current) return
      resizeStateRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      if (resizeStateRef.current) {
        resizeStateRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [])

  const handlePlay = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()

    if (playMode === 'normal') {
      if (playingId === id) {
        if (audioRef.current) {
          audioRef.current.pause()
          releaseManagedAudio(audioRef.current)
          audioRef.current = null
        }
        setPlayingId(null)
      } else {
        if (audioRef.current) {
          audioRef.current.pause()
          releaseManagedAudio(audioRef.current)
        }
        const audio = createManagedAudio(getSliceDownloadUrl(id), { loop: loopEnabled })
        audio.onended = () => {
          setPlayingId(null)
          releaseManagedAudio(audio)
          audioRef.current = null
        }
        audio.play()
        audioRef.current = audio
        setPlayingId(id)
      }
    } else if (playMode === 'one-shot') {
      if (audioRef.current) {
        audioRef.current.pause()
        releaseManagedAudio(audioRef.current)
        audioRef.current = null
      }
      const audio = createManagedAudio(getSliceDownloadUrl(id), { loop: false })
      audio.onended = () => {
        setPlayingId(null)
        releaseManagedAudio(audio)
        audioRef.current = null
      }
      audio.play()
      audioRef.current = audio
      setPlayingId(id)
    }
  }

  const handleMouseDown = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()

    if (playMode === 'reproduce-while-clicking') {
      if (audioRef.current) {
        audioRef.current.pause()
        releaseManagedAudio(audioRef.current)
        audioRef.current = null
      }
      const audio = createManagedAudio(getSliceDownloadUrl(id), { loop: loopEnabled })
      audio.onended = () => {
        setPlayingId(null)
        releaseManagedAudio(audio)
        audioRef.current = null
      }
      audio.play()
      audioRef.current = audio
      setPlayingId(id)
    }
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    e.stopPropagation()

    if (playMode === 'reproduce-while-clicking') {
      if (audioRef.current) {
        audioRef.current.pause()
        releaseManagedAudio(audioRef.current)
        audioRef.current = null
      }
      setPlayingId(null)
    }
  }

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const handleDragStart = (sample: SliceWithTrackExtended) => (e: React.DragEvent) => {
    const samplesToDrag = selectedIds.has(sample.id) ? Array.from(selectedIds) : [sample.id]

    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'samples',
      sampleIds: samplesToDrag,
      slice: samplesToDrag.length === 1 ? sample : undefined,
    }))
    e.dataTransfer.effectAllowed = 'copy'

    const sampleName = samplesToDrag.length === 1 ? sample.name : undefined
    const preview = createDragPreview(samplesToDrag.length, sampleName)
    dragPreviewRef.current = preview

    try {
      e.dataTransfer.setDragImage(preview, 35, 20)
    } catch (err) {
      console.error('Failed to set drag image:', err)
    }
  }

  const handleDragEnd = () => {
    if (dragPreviewRef.current && dragPreviewRef.current.parentNode) {
      document.body.removeChild(dragPreviewRef.current)
      dragPreviewRef.current = null
    }
  }

  const sortedSamples = useMemo(() => {
    if (!sortField) return samples

    return [...samples].sort((a, b) => {
      const aValue = getSortValue(a, sortField)
      const bValue = getSortValue(b, sortField)

      const aMissing = aValue === null || aValue === undefined || aValue === ''
      const bMissing = bValue === null || bValue === undefined || bValue === ''
      if (aMissing && bMissing) return 0
      if (aMissing) return 1
      if (bMissing) return -1

      let compareValue = 0
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        compareValue = aValue.localeCompare(bValue, undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      } else {
        compareValue = Number(aValue) - Number(bValue)
      }

      return sortOrder === 'asc' ? compareValue : -compareValue
    })
  }, [samples, sortField, sortOrder])

  const selectAllIndeterminate = selectedIds.size > 0 && selectedIds.size < sortedSamples.length
  const selectAllChecked = selectedIds.size === sortedSamples.length && sortedSamples.length > 0

  const rowMinWidth = useMemo(
    () => getRowMinWidth(columnVisibility, columnWidths, similarityMode?.enabled),
    [columnVisibility, columnWidths, similarityMode?.enabled]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} />
        Loading samples...
      </div>
    )
  }

  if (samples.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <p className="text-lg">No samples found</p>
        <p className="text-sm mt-1">Try adjusting your filters or selecting a different source</p>
      </div>
    )
  }

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown size={12} className="ml-1 opacity-50" />
    return sortOrder === 'asc' ? <ArrowUp size={12} className="ml-1" /> : <ArrowDown size={12} className="ml-1" />
  }

  const toggleColumn = (key: ColumnKey) => {
    setColumnVisibility((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const toggleColumnsMenu = () => {
    if (showColumnsMenu) {
      setShowColumnsMenu(false)
      return
    }

    const MENU_WIDTH = 224 // Tailwind w-56
    const VIEWPORT_PADDING = 8
    const button = columnsMenuButtonRef.current

    if (button) {
      const rect = button.getBoundingClientRect()
      const top = rect.bottom + 8
      let left = rect.right - MENU_WIDTH
      const maxLeft = window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING

      if (left > maxLeft) left = maxLeft
      if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING

      setColumnsMenuPosition({ top, left })
    }

    setShowColumnsMenu(true)
  }

  const startResize = (key: SourcesListColumnWidthKey, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    resizeStateRef.current = {
      key,
      startX: event.clientX,
      startWidth: columnWidths[key],
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const resetColumnWidth = (key: SourcesListColumnWidthKey) => {
    setColumnWidths((prev) => ({
      ...prev,
      [key]: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS[key],
    }))
  }

  const renderResizeHandle = (key: SourcesListColumnWidthKey, className?: string) => (
    <button
      type="button"
      onMouseDown={(event) => startResize(key, event)}
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        resetColumnWidth(key)
      }}
      className={`group absolute right-[-7px] top-0 flex h-full w-4 cursor-col-resize items-center justify-center rounded-sm border-l border-surface-border/60 bg-surface-base/25 hover:bg-accent-primary/20 transition-colors ${className ?? ''}`}
      title="Drag to resize (double-click to reset)"
      tabIndex={-1}
      aria-label={`Resize ${key} column`}
    >
      <GripVertical size={11} className="text-slate-400 group-hover:text-slate-200 pointer-events-none" />
    </button>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div ref={listContainerRef} className="flex-1 overflow-auto">
        <div
          className="sticky top-0 border-b border-surface-border px-4 py-2 flex-shrink-0 z-10 bg-surface-raised"
          style={{ minWidth: rowMinWidth }}
        >
          <div className="flex items-center gap-2 sm:gap-3">
            <CustomCheckbox
              checked={selectAllChecked}
              indeterminate={selectAllIndeterminate}
              onChange={onToggleSelectAll}
              className="flex-shrink-0"
              title="Select all samples"
            />

            <span className="w-8 sm:w-10 flex-shrink-0 text-xs font-semibold text-slate-400 uppercase text-left">Play</span>
            <span className="w-4 flex-shrink-0" aria-hidden />

            {similarityMode?.enabled && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.similarity }}>
                <button
                  onClick={() => handleSortClick('similarity')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'similarity' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Similar
                  {getSortIcon('similarity')}
                </button>
                {renderResizeHandle('similarity')}
              </div>
            )}

            <div className="relative flex-shrink-0 min-w-0 pl-1" style={{ width: columnWidths.name }}>
              <button
                onClick={() => handleSortClick('name')}
                className={`w-full min-w-0 flex items-center text-left text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                  sortField === 'name' ? 'text-accent-primary' : 'text-slate-400'
                }`}
              >
                Name
                {getSortIcon('name')}
              </button>
              {renderResizeHandle('name')}
            </div>

            {columnVisibility.tags && (
              <div className="relative hidden sm:flex flex-shrink-0 text-left pl-1" style={{ width: columnWidths.tags }}>
                <button
                  onClick={() => handleSortClick('tags')}
                  className={`w-full min-w-0 flex items-center text-left text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'tags' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  <span className="truncate">Tags</span>
                  {getSortIcon('tags')}
                </button>
                {renderResizeHandle('tags', 'hidden sm:block')}
              </div>
            )}

            {columnVisibility.artist && (
              <div className="relative hidden lg:flex flex-shrink-0 text-left min-w-0" style={{ width: columnWidths.artist }}>
                <button
                  onClick={() => handleSortClick('artist')}
                  className={`w-full min-w-0 flex items-center text-left text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'artist' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  <span className="truncate">Artist</span>
                  {getSortIcon('artist')}
                </button>
                {renderResizeHandle('artist', 'hidden lg:block')}
              </div>
            )}
            {columnVisibility.album && (
              <div className="relative hidden lg:flex flex-shrink-0 text-left min-w-0" style={{ width: columnWidths.album }}>
                <button
                  onClick={() => handleSortClick('album')}
                  className={`w-full min-w-0 flex items-center text-left text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'album' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  <span className="truncate">Album</span>
                  {getSortIcon('album')}
                </button>
                {renderResizeHandle('album', 'hidden lg:block')}
              </div>
            )}
            {columnVisibility.year && (
              <div className="relative hidden lg:flex flex-shrink-0 justify-center" style={{ width: columnWidths.year }}>
                <button
                  onClick={() => handleSortClick('year')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'year' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Year
                  {getSortIcon('year')}
                </button>
                {renderResizeHandle('year', 'hidden lg:block')}
              </div>
            )}

            {columnVisibility.bpm && (
              <div className="relative hidden md:flex flex-shrink-0 items-center justify-end" style={{ width: columnWidths.bpm }}>
                <button
                  onClick={() => handleSortClick('bpm')}
                  className={`w-full flex items-center justify-end text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'bpm' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  BPM
                  {getSortIcon('bpm')}
                </button>
                {renderResizeHandle('bpm', 'hidden md:block')}
              </div>
            )}

            {columnVisibility.key && (
              <div className="relative hidden lg:flex flex-shrink-0 items-center justify-center" style={{ width: columnWidths.key }}>
                <button
                  onClick={() => handleSortClick('key')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'key' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Key
                  {getSortIcon('key')}
                </button>
                {renderResizeHandle('key', 'hidden lg:block')}
              </div>
            )}

            {columnVisibility.scale && (
              <div className="relative hidden lg:flex flex-shrink-0 justify-center" style={{ width: columnWidths.scale }}>
                <button
                  onClick={() => handleSortClick('scale')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'scale' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Scale
                  {getSortIcon('scale')}
                </button>
                {renderResizeHandle('scale', 'hidden lg:block')}
              </div>
            )}
            {columnVisibility.envelope && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.envelope }}>
                <button
                  onClick={() => handleSortClick('envelope')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'envelope' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Env
                  {getSortIcon('envelope')}
                </button>
                {renderResizeHandle('envelope', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.brightness && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.brightness }}>
                <button
                  onClick={() => handleSortClick('brightness')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'brightness' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Bright
                  {getSortIcon('brightness')}
                </button>
                {renderResizeHandle('brightness', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.noisiness && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.noisiness }}>
                <button
                  onClick={() => handleSortClick('noisiness')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'noisiness' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Noisy
                  {getSortIcon('noisiness')}
                </button>
                {renderResizeHandle('noisiness', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.warmth && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.warmth }}>
                <button
                  onClick={() => handleSortClick('warmth')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'warmth' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Warmth
                  {getSortIcon('warmth')}
                </button>
                {renderResizeHandle('warmth', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.hardness && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.hardness }}>
                <button
                  onClick={() => handleSortClick('hardness')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'hardness' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Hard
                  {getSortIcon('hardness')}
                </button>
                {renderResizeHandle('hardness', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.sharpness && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.sharpness }}>
                <button
                  onClick={() => handleSortClick('sharpness')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'sharpness' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Sharp
                  {getSortIcon('sharpness')}
                </button>
                {renderResizeHandle('sharpness', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.loudness && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.loudness }}>
                <button
                  onClick={() => handleSortClick('loudness')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'loudness' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Loud
                  {getSortIcon('loudness')}
                </button>
                {renderResizeHandle('loudness', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.sampleRate && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.sampleRate }}>
                <button
                  onClick={() => handleSortClick('sampleRate')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'sampleRate' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Rate
                  {getSortIcon('sampleRate')}
                </button>
                {renderResizeHandle('sampleRate', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.channels && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.channels }}>
                <button
                  onClick={() => handleSortClick('channels')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'channels' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Ch
                  {getSortIcon('channels')}
                </button>
                {renderResizeHandle('channels', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.format && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.format }}>
                <button
                  onClick={() => handleSortClick('format')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'format' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Fmt
                  {getSortIcon('format')}
                </button>
                {renderResizeHandle('format', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.polyphony && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.polyphony }}>
                <button
                  onClick={() => handleSortClick('polyphony')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'polyphony' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Poly
                  {getSortIcon('polyphony')}
                </button>
                {renderResizeHandle('polyphony', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.dateAdded && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.dateAdded }}>
                <button
                  onClick={() => handleSortClick('dateAdded')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'dateAdded' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Added
                  {getSortIcon('dateAdded')}
                </button>
                {renderResizeHandle('dateAdded', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.dateCreated && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.dateCreated }}>
                <button
                  onClick={() => handleSortClick('dateCreated')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'dateCreated' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Created
                  {getSortIcon('dateCreated')}
                </button>
                {renderResizeHandle('dateCreated', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.dateModified && (
              <div className="relative hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.dateModified }}>
                <button
                  onClick={() => handleSortClick('dateModified')}
                  className={`w-full flex items-center justify-center text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'dateModified' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  Modified
                  {getSortIcon('dateModified')}
                </button>
                {renderResizeHandle('dateModified', 'hidden xl:block')}
              </div>
            )}
            {columnVisibility.path && (
              <div className="relative hidden xl:flex flex-shrink-0 text-left min-w-0" style={{ width: columnWidths.path }}>
                <button
                  onClick={() => handleSortClick('path')}
                  className={`w-full min-w-0 flex items-center text-left text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                    sortField === 'path' ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                >
                  <span className="truncate">Path</span>
                  {getSortIcon('path')}
                </button>
                {renderResizeHandle('path', 'hidden xl:block')}
              </div>
            )}

            <div className="relative flex-shrink-0 flex items-center justify-end" style={{ width: columnWidths.duration }}>
              <button
                onClick={() => handleSortClick('duration')}
                className={`w-full flex items-center justify-end text-xs font-semibold uppercase transition-colors hover:text-slate-200 ${
                  sortField === 'duration' ? 'text-accent-primary' : 'text-slate-400'
                }`}
              >
                Duration
                {getSortIcon('duration')}
              </button>
              {renderResizeHandle('duration')}
            </div>

            <div ref={columnsMenuRef} className="relative flex-shrink-0" style={{ width: columnWidths.actions }}>
              <div className="flex items-center justify-end gap-1">
                <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
                  <GripVertical size={10} />
                  Resize
                </span>
                <span className="text-right text-xs font-semibold text-slate-400 uppercase">Actions</span>
                <button
                  ref={columnsMenuButtonRef}
                  onClick={toggleColumnsMenu}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-surface-base transition-colors"
                  title="Show/hide columns"
                >
                  <SlidersHorizontal size={14} />
                </button>
              </div>
              {renderResizeHandle('actions')}
            </div>
          </div>
        </div>

        <div className="divide-y divide-surface-border">
          {sortedSamples.map((sample) => (
            <SourcesSampleListRow
              key={sample.id}
              sample={sample}
              isSelected={selectedId === sample.id}
              isChecked={selectedIds.has(sample.id)}
              isPlaying={playingId === sample.id}
              onSelect={() => onSelect(sample.id)}
              onToggleCheck={() => onToggleSelect(sample.id)}
              onPlay={(e) => handlePlay(sample.id, e as any)}
              onMouseDown={(e) => handleMouseDown(sample.id, e as any)}
              onMouseUp={handleMouseUp}
              onToggleFavorite={() => onToggleFavorite(sample.id)}
              onUpdateName={(name) => onUpdateName(sample.id, name)}
              onDelete={() => onDelete(sample.id)}
              onTagClick={onTagClick}
              onDragStart={handleDragStart(sample)}
              onDragEnd={handleDragEnd}
              playMode={playMode}
              columnVisibility={columnVisibility}
              columnWidths={columnWidths}
              minWidth={rowMinWidth}
              showSimilarity={similarityMode?.enabled}
            />
          ))}
        </div>
      </div>

      {showColumnsMenu && typeof document !== 'undefined' && createPortal(
        <div
          ref={columnsMenuPopoverRef}
          className="fixed w-56 bg-surface-raised border border-surface-border rounded-lg shadow-xl z-[120] p-2"
          style={{ top: columnsMenuPosition.top, left: columnsMenuPosition.left }}
        >
          <div className="text-[11px] text-slate-500 px-2 py-1">Columns</div>
          <div className="px-2 pb-1 text-[10px] text-slate-500">Drag the <GripVertical size={10} className="inline" /> handles in the header to resize.</div>
          <div className="max-h-64 overflow-y-auto">
            {COLUMN_OPTIONS.map((option) => (
              <label key={option.key} className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300 hover:bg-surface-base rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={columnVisibility[option.key]}
                  onChange={() => toggleColumn(option.key)}
                  className="rounded border-surface-border bg-surface-base"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <button
            onClick={() => setColumnVisibility(DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY)}
            className="mt-2 w-full px-2 py-1.5 text-xs text-slate-300 bg-surface-base border border-surface-border rounded hover:bg-surface-overlay transition-colors"
          >
            Reset defaults
          </button>
          <button
            onClick={() => setColumnWidths(DEFAULT_SOURCES_LIST_COLUMN_WIDTHS)}
            className="mt-1 w-full px-2 py-1.5 text-xs text-slate-300 bg-surface-base border border-surface-border rounded hover:bg-surface-overlay transition-colors"
          >
            Reset widths
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
