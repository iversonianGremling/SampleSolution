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
import { useAppDialog } from '../hooks/useAppDialog'
import type { SliceWithTrackExtended } from '../types'
import { createManagedAudio, releaseManagedAudio } from '../services/globalAudioVolume'
import { prepareSamplePreviewPlayback } from '../services/samplePreviewPlayback'
import { freqToNoteName } from '../utils/musicTheory'
import type { TunePlaybackMode } from '../utils/tunePlaybackMode'
import type { BulkRenameHighlightRange } from '../utils/bulkRename'
import {
  hydratePersistedSettingFromElectron,
  readPersistedSetting,
  writePersistedSetting,
} from '../utils/persistentSettings'

type SortField =
  | 'name'
  | 'tags'
  | 'artist'
  | 'album'
  | 'year'
  | 'albumArtist'
  | 'genre'
  | 'trackNumber'
  | 'discNumber'
  | 'tagBpm'
  | 'musicalKey'
  | 'isrc'
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

type DuplicatePairMatchType = 'exact' | 'content' | 'file' | 'near-duplicate'

interface DuplicatePairListMeta {
  pairId: string
  pairIndex: number
  role: 'keep' | 'duplicate'
  partnerSampleId: number
  selectedForDelete: boolean
  selectedDeleteSampleId: number | null
  canDelete: boolean
  canDeletePartner: boolean
  matchType: DuplicatePairMatchType
  similarityPercent: number
}

type ColumnKey = keyof SourcesListColumnVisibility
type MenuPosition = { top: number; left: number }
type ResizeState = {
  key: SourcesListColumnWidthKey
  startX: number
  startWidth: number
}

const COLUMN_VISIBILITY_STORAGE_KEY = 'sources-list-column-visibility-v1'
const COLUMN_WIDTHS_STORAGE_KEY = 'sources-list-column-widths-v1'
const LIST_VIEW_STATE_STORAGE_KEY = 'sources-list-view-state-v1'
const LIST_VIEW_PRESETS_STORAGE_KEY = 'sources-list-view-presets-v1'

interface StoredListViewState {
  columnVisibility: SourcesListColumnVisibility
  columnWidths: SourcesListColumnWidths
  sortField: SortField | null
  sortOrder: SortOrder
}

interface ListViewPreset {
  id: string
  name: string
  state: StoredListViewState
  createdAt: string
  updatedAt: string
}

const MIN_COLUMN_WIDTHS: SourcesListColumnWidths = {
  name: 96,
  tags: 110,
  artist: 100,
  album: 100,
  year: 56,
  albumArtist: 110,
  genre: 100,
  trackNumber: 72,
  discNumber: 72,
  tagBpm: 72,
  musicalKey: 84,
  isrc: 96,
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
  actions: 70,
}

const MAX_COLUMN_WIDTH = 520

const COLUMN_OPTIONS: Array<{ key: ColumnKey; label: string }> = [
  { key: 'tags', label: 'Instruments' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'year', label: 'Year' },
  { key: 'albumArtist', label: 'Album Artist' },
  { key: 'genre', label: 'Genre' },
  { key: 'trackNumber', label: 'Track #' },
  { key: 'discNumber', label: 'Disc #' },
  { key: 'tagBpm', label: 'Detected BPM' },
  { key: 'musicalKey', label: 'Detected Key' },
  { key: 'isrc', label: 'ISRC' },
  { key: 'bpm', label: 'BPM' },
  { key: 'key', label: 'Fundamental' },
  { key: 'scale', label: 'Scale' },
  { key: 'envelope', label: 'Envelope' },
  { key: 'brightness', label: 'Brightness Bar' },
  { key: 'noisiness', label: 'Noisiness Bar' },
  { key: 'warmth', label: 'Warmth Bar' },
  { key: 'hardness', label: 'Hardness Bar' },
  { key: 'sharpness', label: 'Sharpness Bar' },
  { key: 'loudness', label: 'Loudness' },
  { key: 'sampleRate', label: 'SR' },
  { key: 'channels', label: 'Channels' },
  { key: 'format', label: 'Format' },
  { key: 'polyphony', label: 'Polyphony' },
  { key: 'dateAdded', label: 'Date Added' },
  { key: 'dateCreated', label: 'Date Created' },
  { key: 'dateModified', label: 'Date Modified' },
  { key: 'path', label: 'Path' },
]

const DEFAULT_LIST_ROW_HEIGHT_PX = 40
const LIST_ROW_OVERSCAN = 4
const MIN_RENDERED_LIST_ROWS = 24
const MIN_VIRTUALIZED_ROW_HEIGHT_PX = Math.max(20, Math.floor(DEFAULT_LIST_ROW_HEIGHT_PX * 0.5))
const MAX_VIRTUALIZED_ROW_HEIGHT_PX = DEFAULT_LIST_ROW_HEIGHT_PX * 3

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const OPTIONAL_COLUMNS: ColumnKey[] = [
  'tags',
  'artist',
  'album',
  'year',
  'albumArtist',
  'genre',
  'trackNumber',
  'discNumber',
  'tagBpm',
  'musicalKey',
  'isrc',
  'bpm',
  'key',
  'scale',
  'envelope',
  'brightness',
  'noisiness',
  'warmth',
  'hardness',
  'sharpness',
  'loudness',
  'sampleRate',
  'channels',
  'format',
  'polyphony',
  'dateAdded',
  'dateCreated',
  'dateModified',
  'path',
]

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function getPathDisplay(sample: SliceWithTrackExtended): string | null {
  return sample.pathDisplay || sample.track.relativePath || sample.track.originalPath || null
}

function getKeySortValue(sample: SliceWithTrackExtended): number | null {
  return sample.fundamentalFrequency ?? null
}

function getScaleSortValue(sample: SliceWithTrackExtended): string | null {
  if (sample.keyEstimate && sample.keyEstimate.trim()) {
    return sample.keyEstimate.trim().toLowerCase()
  }

  if (sample.scale && sample.scale.trim()) {
    const mode = sample.scale.trim().toLowerCase()
    const tonic = sample.fundamentalFrequency ? freqToNoteName(sample.fundamentalFrequency) : null
    return tonic ? `${tonic} ${mode}`.toLowerCase() : mode
  }

  return null
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
    case 'albumArtist':
      return sample.track.albumArtist?.toLowerCase() ?? null
    case 'genre':
      return sample.track.genre?.toLowerCase() ?? null
    case 'trackNumber':
      return sample.track.trackNumber ?? null
    case 'discNumber':
      return sample.track.discNumber ?? null
    case 'tagBpm':
      return sample.track.tagBpm ?? null
    case 'musicalKey':
      return sample.track.musicalKey?.toLowerCase() ?? null
    case 'isrc':
      return sample.track.isrc?.toLowerCase() ?? null
    case 'bpm':
      return sample.bpm ?? null
    case 'key':
      return getKeySortValue(sample)
    case 'scale':
      return getScaleSortValue(sample)
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
  showSelectAllControl?: boolean
  onToggleFavorite: (id: number) => void
  onUpdateName: (id: number, name: string) => void
  onDelete: (id: number) => void
  onTagClick?: (tagId: number) => void
  isLoading?: boolean
  playMode?: PlayMode
  loopEnabled?: boolean
  tuneTargetNote?: string | null
  tunePlaybackMode?: TunePlaybackMode
  bulkRenamePreviewById?: Map<number, { nextName: string; hasChange: boolean; highlightRanges: BulkRenameHighlightRange[] }>
  similarityMode?: {
    enabled: boolean
    referenceSampleId: number
    referenceSampleName: string
  } | null
  duplicatePairMetaBySampleId?: Map<number, DuplicatePairListMeta>
  onToggleDuplicateDeleteTarget?: (sampleId: number) => void
  onKeepDuplicateSample?: (sampleId: number) => void
}

function sanitizeColumnVisibility(
  value: Partial<SourcesListColumnVisibility> | null | undefined,
): SourcesListColumnVisibility {
  return {
    ...DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY,
    ...(value ?? {}),
    envelope: value?.envelope ?? DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY.envelope,
    loudness: value?.loudness ?? DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY.loudness,
  }
}

function parseColumnVisibility(raw: string | null): SourcesListColumnVisibility | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SourcesListColumnVisibility>
    return sanitizeColumnVisibility(parsed)
  } catch {
    return null
  }
}

function sanitizeColumnWidths(
  value: Partial<SourcesListColumnWidths> | null | undefined,
): SourcesListColumnWidths {
  const parsed = value ?? {}
  const sanitizedEntries = (Object.keys(DEFAULT_SOURCES_LIST_COLUMN_WIDTHS) as SourcesListColumnWidthKey[])
    .map((key) => {
      const width = parsed[key]
      if (typeof width !== 'number' || !Number.isFinite(width)) {
        return [key, DEFAULT_SOURCES_LIST_COLUMN_WIDTHS[key]] as const
      }
      const min = MIN_COLUMN_WIDTHS[key]
      return [key, Math.max(min, Math.min(MAX_COLUMN_WIDTH, width))] as const
    })

  return Object.fromEntries(sanitizedEntries) as SourcesListColumnWidths
}

function parseColumnWidths(raw: string | null): SourcesListColumnWidths | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SourcesListColumnWidths>
    return sanitizeColumnWidths(parsed)
  } catch {
    return null
  }
}

function parseSortField(value: unknown): SortField | null {
  return typeof value === 'string' ? (value as SortField) : null
}

function parseSortOrder(value: unknown): SortOrder {
  return value === 'desc' ? 'desc' : 'asc'
}

function parseStoredListViewState(raw: string | null): StoredListViewState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      columnVisibility?: Partial<SourcesListColumnVisibility>
      columnWidths?: Partial<SourcesListColumnWidths>
      sortField?: unknown
      sortOrder?: unknown
    }
    return {
      columnVisibility: sanitizeColumnVisibility(parsed.columnVisibility),
      columnWidths: sanitizeColumnWidths(parsed.columnWidths),
      sortField: parseSortField(parsed.sortField),
      sortOrder: parseSortOrder(parsed.sortOrder),
    }
  } catch {
    return null
  }
}

function parseStoredListViewPresets(raw: string | null): ListViewPreset[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    const normalized = parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null
        const preset = item as {
          id?: unknown
          name?: unknown
          createdAt?: unknown
          updatedAt?: unknown
          state?: {
            columnVisibility?: Partial<SourcesListColumnVisibility>
            columnWidths?: Partial<SourcesListColumnWidths>
            sortField?: unknown
            sortOrder?: unknown
          }
        }
        const state = preset.state
        const name = typeof preset.name === 'string' ? preset.name.trim() : ''
        if (!name) return null
        return {
          id: typeof preset.id === 'string' && preset.id.trim() ? preset.id : `list-view-preset-${index}-${Date.now()}`,
          name,
          createdAt: typeof preset.createdAt === 'string' ? preset.createdAt : new Date().toISOString(),
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
          state: {
            columnVisibility: sanitizeColumnVisibility(state?.columnVisibility),
            columnWidths: sanitizeColumnWidths(state?.columnWidths),
            sortField: parseSortField(state?.sortField),
            sortOrder: parseSortOrder(state?.sortOrder),
          },
        } satisfies ListViewPreset
      })
      .filter((value): value is ListViewPreset => Boolean(value))

    return normalized
  } catch {
    return []
  }
}

function loadInitialListViewState(): StoredListViewState {
  const persisted = parseStoredListViewState(readPersistedSetting(LIST_VIEW_STATE_STORAGE_KEY))
  if (persisted) return persisted

  const legacyColumnVisibility =
    parseColumnVisibility(readPersistedSetting(COLUMN_VISIBILITY_STORAGE_KEY)) ??
    DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY
  const legacyColumnWidths =
    parseColumnWidths(readPersistedSetting(COLUMN_WIDTHS_STORAGE_KEY)) ??
    DEFAULT_SOURCES_LIST_COLUMN_WIDTHS

  return {
    columnVisibility: legacyColumnVisibility,
    columnWidths: legacyColumnWidths,
    sortField: null,
    sortOrder: 'asc',
  }
}

function loadInitialListViewPresets(): ListViewPreset[] {
  return parseStoredListViewPresets(readPersistedSetting(LIST_VIEW_PRESETS_STORAGE_KEY)) ?? []
}

function snapshotListViewState(
  columnVisibility: SourcesListColumnVisibility,
  columnWidths: SourcesListColumnWidths,
  sortField: SortField | null,
  sortOrder: SortOrder,
): StoredListViewState {
  return {
    columnVisibility: { ...columnVisibility },
    columnWidths: { ...columnWidths },
    sortField,
    sortOrder,
  }
}

function getRowMinWidth(
  columnVisibility: SourcesListColumnVisibility,
  columnWidths: SourcesListColumnWidths,
  showSimilarity = false,
  showInstrumentColumn = true,
): number {
  let width = 0
  const controlsColumnWidth = Math.max(
    72,
    Math.min(columnWidths.actions, DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.actions),
  )

  // checkbox + unified controls cluster + optional instrument slot
  width += 24
  width += controlsColumnWidth
  if (showInstrumentColumn) width += 16

  // always visible content columns
  width += columnWidths.name
  width += columnWidths.duration

  for (const key of OPTIONAL_COLUMNS) {
    if (!columnVisibility[key]) continue
    width += columnWidths[key]
  }

  if (showSimilarity) width += columnWidths.similarity

  // row gaps + left/right padding
  width += 220

  return width
}

export function SourcesSampleList({
  samples,
  selectedId,
  selectedIds,
  onSelect,
  onToggleSelect,
  onToggleSelectAll,
  showSelectAllControl = true,
  onToggleFavorite,
  onUpdateName,
  onDelete,
  onTagClick,
  isLoading = false,
  playMode = 'normal',
  loopEnabled = false,
  tuneTargetNote = null,
  tunePlaybackMode: _tunePlaybackMode = 'tape',
  bulkRenamePreviewById = new Map<number, { nextName: string; hasChange: boolean; highlightRanges: BulkRenameHighlightRange[] }>(),
  similarityMode = null,
  duplicatePairMetaBySampleId = new Map<number, DuplicatePairListMeta>(),
  onToggleDuplicateDeleteTarget,
  onKeepDuplicateSample,
}: SourcesSampleListProps) {
  const { confirm, prompt, dialogNode } = useAppDialog()
  const [playingId, setPlayingId] = useState<number | null>(null)
  const [initialListViewState] = useState<StoredListViewState>(() => loadInitialListViewState())
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const listContainerRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const rowsContainerRef = useRef<HTMLDivElement>(null)
  const [sortField, setSortField] = useState<SortField | null>(initialListViewState.sortField)
  const [sortOrder, setSortOrder] = useState<SortOrder>(initialListViewState.sortOrder)
  const [columnVisibility, setColumnVisibility] = useState<SourcesListColumnVisibility>(initialListViewState.columnVisibility)
  const [columnWidths, setColumnWidths] = useState<SourcesListColumnWidths>(initialListViewState.columnWidths)
  const [savedPresets, setSavedPresets] = useState<ListViewPreset[]>(loadInitialListViewPresets)
  const [isStorageReady, setIsStorageReady] = useState(
    () => typeof window === 'undefined' || !window.electron?.getSetting
  )
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(null)
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [columnsMenuPosition, setColumnsMenuPosition] = useState<MenuPosition>({ top: 0, left: 0 })
  const dragPreviewRef = useRef<HTMLElement | null>(null)
  const columnsMenuPopoverRef = useRef<HTMLDivElement>(null)
  const columnsMenuButtonRef = useRef<HTMLButtonElement>(null)
  const resizeStateRef = useRef<ResizeState | null>(null)
  const isDuplicatePairMode =
    Boolean(onToggleDuplicateDeleteTarget) && duplicatePairMetaBySampleId.size > 0

  const preparePlaybackForSample = (sample: SliceWithTrackExtended) =>
    prepareSamplePreviewPlayback(sample, tuneTargetNote)

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        releaseManagedAudio(audioRef.current)
        audioRef.current = null
      }
    }
  }, [isLoading, samples.length])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electron?.getSetting) {
      setIsStorageReady(true)
      return
    }

    let cancelled = false

    const hydrateFromElectron = async () => {
      const [stateRaw, legacyVisibilityRaw, legacyWidthsRaw, presetsRaw] = await Promise.all([
        hydratePersistedSettingFromElectron(LIST_VIEW_STATE_STORAGE_KEY),
        hydratePersistedSettingFromElectron(COLUMN_VISIBILITY_STORAGE_KEY),
        hydratePersistedSettingFromElectron(COLUMN_WIDTHS_STORAGE_KEY),
        hydratePersistedSettingFromElectron(LIST_VIEW_PRESETS_STORAGE_KEY),
      ])

      if (cancelled) return

      const persistedState = parseStoredListViewState(stateRaw)
      if (persistedState) {
        setSortField(persistedState.sortField)
        setSortOrder(persistedState.sortOrder)
        setColumnVisibility(persistedState.columnVisibility)
        setColumnWidths(persistedState.columnWidths)
      } else {
        const legacyVisibility = parseColumnVisibility(legacyVisibilityRaw)
        const legacyWidths = parseColumnWidths(legacyWidthsRaw)
        if (legacyVisibility) {
          setColumnVisibility(legacyVisibility)
        }
        if (legacyWidths) {
          setColumnWidths(legacyWidths)
        }
      }

      const parsedPresets = parseStoredListViewPresets(presetsRaw)
      if (parsedPresets) {
        setSavedPresets(parsedPresets)
      }

      setIsStorageReady(true)
    }

    void hydrateFromElectron()

    return () => {
      cancelled = true
    }
  }, [isLoading, samples.length])

  useEffect(() => {
    if (!isStorageReady) return
    const nextState = snapshotListViewState(columnVisibility, columnWidths, sortField, sortOrder)
    writePersistedSetting(LIST_VIEW_STATE_STORAGE_KEY, JSON.stringify(nextState))
    // Keep legacy keys populated for backward compatibility with older clients.
    writePersistedSetting(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility))
    writePersistedSetting(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths))
  }, [isStorageReady, columnVisibility, columnWidths, sortField, sortOrder])

  useEffect(() => {
    if (!isStorageReady) return
    writePersistedSetting(LIST_VIEW_PRESETS_STORAGE_KEY, JSON.stringify(savedPresets))
  }, [isStorageReady, savedPresets])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (columnsMenuButtonRef.current?.contains(target)) return
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

  useEffect(() => {
    const listContainer = listContainerRef.current
    if (!listContainer) return

    let rafId: number | null = null
    let resizeObserver: ResizeObserver | null = null

    const readScrollMetrics = () => {
      setScrollTop(listContainer.scrollTop)
      setViewportHeight(listContainer.clientHeight)
    }

    const scheduleMetricsRead = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        readScrollMetrics()
      })
    }

    readScrollMetrics()
    listContainer.addEventListener('scroll', scheduleMetricsRead, { passive: true })

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', scheduleMetricsRead)
    } else {
      resizeObserver = new ResizeObserver(scheduleMetricsRead)
      resizeObserver.observe(listContainer)
    }

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
      listContainer.removeEventListener('scroll', scheduleMetricsRead)
      window.removeEventListener('resize', scheduleMetricsRead)
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
    }
  }, [isLoading, samples.length])

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
        const sample = samples.find((s) => s.id === id)
        if (!sample) return
        try {
          const { url, playbackRate } = preparePlaybackForSample(sample)
          const audio = createManagedAudio(url, { loop: loopEnabled })
          audio.playbackRate = playbackRate
          audio.onended = () => {
            setPlayingId(null)
            releaseManagedAudio(audio)
            audioRef.current = null
          }
          void audio.play().catch((error) => {
            console.error('Failed to play sample preview:', error)
            releaseManagedAudio(audio)
            if (audioRef.current === audio) {
              audioRef.current = null
            }
            setPlayingId(null)
          })
          audioRef.current = audio
          setPlayingId(id)
        } catch (error) {
          console.error('Failed to play sample preview:', error)
          setPlayingId(null)
        }
      }
    } else if (playMode === 'one-shot') {
      if (audioRef.current) {
        audioRef.current.pause()
        releaseManagedAudio(audioRef.current)
        audioRef.current = null
      }
      const sample = samples.find((s) => s.id === id)
      if (!sample) return
      try {
        const { url, playbackRate } = preparePlaybackForSample(sample)
        const audio = createManagedAudio(url, { loop: false })
        audio.playbackRate = playbackRate
        audio.onended = () => {
          setPlayingId(null)
          releaseManagedAudio(audio)
          audioRef.current = null
        }
        void audio.play().catch((error) => {
          console.error('Failed to play sample preview:', error)
          releaseManagedAudio(audio)
          if (audioRef.current === audio) {
            audioRef.current = null
          }
          setPlayingId(null)
        })
        audioRef.current = audio
        setPlayingId(id)
      } catch (error) {
        console.error('Failed to play sample preview:', error)
        setPlayingId(null)
      }
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
      const sample = samples.find((s) => s.id === id)
      if (!sample) return
      try {
        const { url, playbackRate } = preparePlaybackForSample(sample)
        const audio = createManagedAudio(url, { loop: loopEnabled })
        audio.playbackRate = playbackRate
        audio.onended = () => {
          setPlayingId(null)
          releaseManagedAudio(audio)
          audioRef.current = null
        }
        void audio.play().catch((error) => {
          console.error('Failed to play sample preview:', error)
          releaseManagedAudio(audio)
          if (audioRef.current === audio) {
            audioRef.current = null
          }
          setPlayingId(null)
        })
        audioRef.current = audio
        setPlayingId(id)
      } catch (error) {
        console.error('Failed to play sample preview:', error)
        setPlayingId(null)
      }
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
    if (isDuplicatePairMode) return
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
    if (!sortField || isDuplicatePairMode) return samples

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
  }, [samples, sortField, sortOrder, isDuplicatePairMode])

  useEffect(() => {
    const listContainer = listContainerRef.current
    if (!listContainer) return

    let frameId: number | null = null
    frameId = window.requestAnimationFrame(() => {
      setScrollTop(listContainer.scrollTop)
      setViewportHeight(listContainer.clientHeight)
    })

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [sortedSamples])

  useEffect(() => {
    // Layout changes can affect row height, so re-measure on next paint.
    setMeasuredRowHeight(null)
  }, [columnVisibility, columnWidths, similarityMode?.enabled, bulkRenamePreviewById])

  const selectAllIndeterminate = selectedIds.size > 0 && selectedIds.size < sortedSamples.length
  const selectAllChecked = selectedIds.size === sortedSamples.length && sortedSamples.length > 0
  const showInstrumentColumn = useMemo(
    () => samples.some((sample) => Boolean(sample.instrumentType || sample.instrumentPrimary)),
    [samples],
  )

  const rowMinWidth = useMemo(
    () => getRowMinWidth(columnVisibility, columnWidths, similarityMode?.enabled, showInstrumentColumn),
    [columnVisibility, columnWidths, similarityMode?.enabled, showInstrumentColumn]
  )
  const controlsColumnWidth = Math.max(
    72,
    Math.min(columnWidths.actions, DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.actions),
  )

  const virtualWindow = useMemo(() => {
    const totalRows = sortedSamples.length
    if (totalRows === 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }

    const measuredOrDefaultRowHeight = measuredRowHeight ?? DEFAULT_LIST_ROW_HEIGHT_PX
    const rowHeight = clamp(
      measuredOrDefaultRowHeight,
      MIN_VIRTUALIZED_ROW_HEIGHT_PX,
      MAX_VIRTUALIZED_ROW_HEIGHT_PX,
    )
    const safeViewportRowHeight = Math.max(1, Math.min(rowHeight, DEFAULT_LIST_ROW_HEIGHT_PX))
    const minRowsToFillViewport =
      viewportHeight > 0
        ? Math.ceil(viewportHeight / safeViewportRowHeight) + LIST_ROW_OVERSCAN * 2
        : 0
    const renderedRowBudget = Math.max(MIN_RENDERED_LIST_ROWS, minRowsToFillViewport)

    const buildRowWindow = (targetRow: number) => {
      const maxStartRow = Math.max(0, totalRows - renderedRowBudget)
      const startRow = clamp(targetRow, 0, maxStartRow)
      const endRowExclusive = Math.min(totalRows, startRow + renderedRowBudget)
      return {
        startIndex: startRow,
        endIndex: endRowExclusive,
        topSpacer: startRow * rowHeight,
        bottomSpacer: Math.max(0, totalRows - endRowExclusive) * rowHeight,
      }
    }

    if (viewportHeight <= 0 || rowHeight <= 0) {
      // Avoid blank regions while viewport metrics are unavailable.
      return {
        startIndex: 0,
        endIndex: totalRows,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }

    const visibleTop = scrollTop
    const visibleBottom = visibleTop + viewportHeight

    const rawStartRow = Math.floor(visibleTop / rowHeight) - LIST_ROW_OVERSCAN
    const rawEndRowExclusive = Math.ceil(visibleBottom / rowHeight) + LIST_ROW_OVERSCAN

    if (rawEndRowExclusive <= 0) {
      return buildRowWindow(0)
    }

    if (rawStartRow >= totalRows) {
      return buildRowWindow(totalRows - renderedRowBudget)
    }

    const startRow = clamp(rawStartRow, 0, totalRows)
    const endRowExclusive = clamp(rawEndRowExclusive, 0, totalRows)
    if (startRow >= endRowExclusive) {
      return buildRowWindow(startRow)
    }

    return buildRowWindow(startRow)
  }, [sortedSamples.length, scrollTop, viewportHeight, measuredRowHeight])

  const visibleSamples = useMemo(
    () => sortedSamples.slice(virtualWindow.startIndex, virtualWindow.endIndex),
    [sortedSamples, virtualWindow.startIndex, virtualWindow.endIndex]
  )

  useEffect(() => {
    let frameId: number | null = null
    frameId = window.requestAnimationFrame(() => {
      const rowsContainer = rowsContainerRef.current
      if (!rowsContainer) return
      const rows = Array.from(
        rowsContainer.querySelectorAll<HTMLElement>('[data-sources-list-row="true"]')
      )
      if (rows.length === 0) return

      const heights = rows
        .map((row) => row.offsetHeight)
        .filter((height) => Number.isFinite(height) && height > 0)
        .sort((a, b) => a - b)
      if (heights.length === 0) return

      const medianHeight = heights[Math.floor(heights.length / 2)]
      setMeasuredRowHeight((previous) => {
        if (previous !== null && Math.abs(previous - medianHeight) < 1) {
          return previous
        }
        return medianHeight
      })
    })

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [
    virtualWindow.startIndex,
    virtualWindow.endIndex,
    columnVisibility,
    columnWidths,
    similarityMode?.enabled,
    bulkRenamePreviewById,
  ])

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

  const applyPreset = (preset: ListViewPreset) => {
    setColumnVisibility(preset.state.columnVisibility)
    setColumnWidths(preset.state.columnWidths)
    setSortField(preset.state.sortField)
    setSortOrder(preset.state.sortOrder)
  }

  const saveCurrentAsPreset = async () => {
    const inputName = await prompt({
      title: 'Save List Preset',
      message: 'Enter a name for this list view preset.',
      placeholder: 'Preset name',
      confirmText: 'Save preset',
      validate: (value) => {
        if (!value.trim()) {
          return 'Preset name is required.'
        }
        return null
      },
    })
    const presetName = inputName?.trim()
    if (!presetName) return

    const currentState = snapshotListViewState(columnVisibility, columnWidths, sortField, sortOrder)
    const timestamp = new Date().toISOString()
    const existing = savedPresets.find(
      (preset) => preset.name.toLowerCase() === presetName.toLowerCase(),
    )

    if (existing) {
      const shouldOverwrite = await confirm({
        title: 'Overwrite Preset?',
        message: `Preset "${existing.name}" already exists. Overwrite it?`,
        confirmText: 'Overwrite',
        cancelText: 'Cancel',
      })
      if (!shouldOverwrite) return

      setSavedPresets((current) =>
        current.map((preset) =>
          preset.id === existing.id
            ? {
                ...preset,
                name: presetName,
                updatedAt: timestamp,
                state: currentState,
              }
            : preset
        ),
      )
      return
    }

    setSavedPresets((current) => [
      {
        id: `list-view-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: presetName,
        state: currentState,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ...current,
    ])
  }

  const updatePreset = (presetId: string) => {
    const currentState = snapshotListViewState(columnVisibility, columnWidths, sortField, sortOrder)
    const timestamp = new Date().toISOString()
    setSavedPresets((current) =>
      current.map((preset) =>
        preset.id === presetId
          ? {
              ...preset,
              updatedAt: timestamp,
              state: currentState,
            }
          : preset
      ),
    )
  }

  const deletePreset = async (presetId: string) => {
    const preset = savedPresets.find((item) => item.id === presetId)
    if (!preset) return
    const confirmed = await confirm({
      title: 'Delete Preset',
      message: `Delete preset "${preset.name}"?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDestructive: true,
    })
    if (!confirmed) return

    setSavedPresets((current) => current.filter((item) => item.id !== presetId))
  }

  const toggleColumnsMenu = () => {
    if (showColumnsMenu) {
      setShowColumnsMenu(false)
      return
    }

    const MENU_WIDTH = 256 // Tailwind w-64
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

  const renderResizeHandle = (key: SourcesListColumnWidthKey, className?: string, tourId?: string) => (
    <button
      type="button"
      onMouseDown={(event) => startResize(key, event)}
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        resetColumnWidth(key)
      }}
      data-tour={tourId}
      className={`group absolute right-[-7px] top-0 z-10 flex h-full w-4 cursor-col-resize touch-none items-center justify-center rounded-sm border-l border-surface-border/60 bg-surface-base/25 hover:bg-accent-primary/20 transition-colors ${className ?? ''}`}
      title="Drag to resize (double-click to reset)"
      tabIndex={-1}
      aria-label={`Resize ${key} column`}
    >
      <GripVertical size={11} className="text-slate-400 opacity-0 group-hover:opacity-100 group-hover:text-slate-200 transition-opacity pointer-events-none" />
    </button>
  )

  const columnsButton = (
    <button
      ref={columnsMenuButtonRef}
      onClick={toggleColumnsMenu}
      data-tour="samples-list-columns-button"
      className="flex items-center gap-1 rounded-md border border-surface-border bg-surface-base px-2 py-1 text-slate-300 hover:text-white hover:bg-surface-overlay transition-colors flex-shrink-0"
      title="Show or hide list columns"
      aria-label="Show or hide list columns"
    >
      <SlidersHorizontal size={13} />
      <span className="text-[11px]">Columns</span>
    </button>
  )

  return (
    <div
      className={`sources-list-compact flex min-h-0 flex-col h-full overflow-hidden ${isDuplicatePairMode ? 'bg-surface-base/30' : ''}`}
      data-tour="samples-list-view"
    >
      <div ref={listContainerRef} className="flex-1 min-h-0 overflow-auto">
        <div
          ref={headerRef}
          className="sticky top-0 border-b border-surface-border flex-shrink-0 z-20 bg-surface-raised/95 backdrop-blur-sm relative"
          style={{ minWidth: rowMinWidth }}
        >
          <div className="grid">
            <div className="col-start-1 row-start-1 flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 pr-2" style={{ minWidth: rowMinWidth }}>
            {showSelectAllControl ? (
              <CustomCheckbox
                checked={selectAllChecked}
                indeterminate={selectAllIndeterminate}
                onChange={onToggleSelectAll}
                className="flex-shrink-0"
                title="Select all samples"
              />
            ) : (
              <div className="w-5 flex-shrink-0" aria-hidden />
            )}

            <div className="relative flex-shrink-0" style={{ width: controlsColumnWidth }}>
              <div className="h-3.5" aria-hidden />
              {renderResizeHandle('actions')}
            </div>

            {showInstrumentColumn && <span className="w-4 flex-shrink-0" aria-hidden />}

            {similarityMode?.enabled && (
              <div className="relative flex flex-shrink-0 justify-end pr-1" style={{ width: columnWidths.similarity }}>
                <button
                  data-tour="samples-list-similarity-sort"
                  onClick={() => handleSortClick('similarity')}
                  className={`w-full flex items-center justify-end text-right section-label transition-colors hover:text-text-secondary ${
                    sortField === 'similarity' ? 'text-accent-primary' : ''
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
                data-tour="samples-list-name-sort"
                onClick={() => handleSortClick('name')}
                className={`w-full min-w-0 flex items-center text-left section-label transition-colors hover:text-text-secondary ${
                  sortField === 'name' ? 'text-accent-primary' : ''
                }`}
              >
                Name
                {getSortIcon('name')}
              </button>
              {renderResizeHandle('name', undefined, 'samples-list-name-resize')}
            </div>

            {columnVisibility.tags && (
              <div className="relative flex flex-shrink-0 text-left pl-1" style={{ width: columnWidths.tags }}>
                <button
                  onClick={() => handleSortClick('tags')}
                  className={`w-full min-w-0 flex items-center text-left section-label transition-colors hover:text-text-secondary ${
                    sortField === 'tags' ? 'text-accent-primary' : ''
                  }`}
                >
                  <span className="truncate">Instruments</span>
                  {getSortIcon('tags')}
                </button>
                {renderResizeHandle('tags')}
              </div>
            )}

            {columnVisibility.artist && (
              <div className="relative flex flex-shrink-0 text-left min-w-0" style={{ width: columnWidths.artist }}>
                <button
                  onClick={() => handleSortClick('artist')}
                  className={`w-full min-w-0 flex items-center text-left section-label transition-colors hover:text-text-secondary ${
                    sortField === 'artist' ? 'text-accent-primary' : ''
                  }`}
                >
                  <span className="truncate">Artist</span>
                  {getSortIcon('artist')}
                </button>
                {renderResizeHandle('artist')}
              </div>
            )}
            {columnVisibility.album && (
              <div className="relative flex flex-shrink-0 text-left min-w-0" style={{ width: columnWidths.album }}>
                <button
                  onClick={() => handleSortClick('album')}
                  className={`w-full min-w-0 flex items-center text-left section-label transition-colors hover:text-text-secondary ${
                    sortField === 'album' ? 'text-accent-primary' : ''
                  }`}
                >
                  <span className="truncate">Album</span>
                  {getSortIcon('album')}
                </button>
                {renderResizeHandle('album')}
              </div>
            )}
            {columnVisibility.year && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.year }}>
                <button
                  onClick={() => handleSortClick('year')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'year' ? 'text-accent-primary' : ''
                  }`}
                >
                  Year
                  {getSortIcon('year')}
                </button>
                {renderResizeHandle('year')}
              </div>
            )}

            {columnVisibility.albumArtist && (
              <div className="relative flex flex-shrink-0 text-left min-w-0" style={{ width: columnWidths.albumArtist }}>
                <button
                  onClick={() => handleSortClick('albumArtist')}
                  className={`w-full min-w-0 flex items-center text-left section-label transition-colors hover:text-text-secondary ${
                    sortField === 'albumArtist' ? 'text-accent-primary' : ''
                  }`}
                >
                  <span className="truncate">Alb Artist</span>
                  {getSortIcon('albumArtist')}
                </button>
                {renderResizeHandle('albumArtist')}
              </div>
            )}

            {columnVisibility.genre && (
              <div className="relative flex flex-shrink-0 text-left min-w-0" style={{ width: columnWidths.genre }}>
                <button
                  onClick={() => handleSortClick('genre')}
                  className={`w-full min-w-0 flex items-center text-left section-label transition-colors hover:text-text-secondary ${
                    sortField === 'genre' ? 'text-accent-primary' : ''
                  }`}
                >
                  <span className="truncate">Genre</span>
                  {getSortIcon('genre')}
                </button>
                {renderResizeHandle('genre')}
              </div>
            )}

            {columnVisibility.trackNumber && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.trackNumber }}>
                <button
                  onClick={() => handleSortClick('trackNumber')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'trackNumber' ? 'text-accent-primary' : ''
                  }`}
                >
                  Trk
                  {getSortIcon('trackNumber')}
                </button>
                {renderResizeHandle('trackNumber')}
              </div>
            )}

            {columnVisibility.discNumber && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.discNumber }}>
                <button
                  onClick={() => handleSortClick('discNumber')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'discNumber' ? 'text-accent-primary' : ''
                  }`}
                >
                  Disc
                  {getSortIcon('discNumber')}
                </button>
                {renderResizeHandle('discNumber')}
              </div>
            )}

            {columnVisibility.tagBpm && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.tagBpm }}>
                <button
                  onClick={() => handleSortClick('tagBpm')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'tagBpm' ? 'text-accent-primary' : ''
                  }`}
                >
                  Detected BPM
                  {getSortIcon('tagBpm')}
                </button>
                {renderResizeHandle('tagBpm')}
              </div>
            )}

            {columnVisibility.musicalKey && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.musicalKey }}>
                <button
                  onClick={() => handleSortClick('musicalKey')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'musicalKey' ? 'text-accent-primary' : ''
                  }`}
                >
                  Detected Key
                  {getSortIcon('musicalKey')}
                </button>
                {renderResizeHandle('musicalKey')}
              </div>
            )}

            {columnVisibility.isrc && (
              <div className="relative flex flex-shrink-0 text-left min-w-0" style={{ width: columnWidths.isrc }}>
                <button
                  onClick={() => handleSortClick('isrc')}
                  className={`w-full min-w-0 flex items-center text-left section-label transition-colors hover:text-text-secondary ${
                    sortField === 'isrc' ? 'text-accent-primary' : ''
                  }`}
                >
                  <span className="truncate">ISRC</span>
                  {getSortIcon('isrc')}
                </button>
                {renderResizeHandle('isrc')}
              </div>
            )}

            {columnVisibility.bpm && (
              <div className="relative flex flex-shrink-0 items-center justify-center" style={{ width: columnWidths.bpm }}>
                <button
                  onClick={() => handleSortClick('bpm')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'bpm' ? 'text-accent-primary' : ''
                  }`}
                >
                  BPM
                  {getSortIcon('bpm')}
                </button>
                {renderResizeHandle('bpm')}
              </div>
            )}

            {columnVisibility.key && (
              <div className="relative flex flex-shrink-0 items-center justify-center" style={{ width: columnWidths.key }}>
                <button
                  onClick={() => handleSortClick('key')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'key' ? 'text-accent-primary' : ''
                  }`}
                >
                  Fund
                  {getSortIcon('key')}
                </button>
                {renderResizeHandle('key')}
              </div>
            )}

            {columnVisibility.scale && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.scale }}>
                <button
                  onClick={() => handleSortClick('scale')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'scale' ? 'text-accent-primary' : ''
                  }`}
                >
                  Scale
                  {getSortIcon('scale')}
                </button>
                {renderResizeHandle('scale')}
              </div>
            )}
            {columnVisibility.envelope && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.envelope }}>
                <button
                  onClick={() => handleSortClick('envelope')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'envelope' ? 'text-accent-primary' : ''
                  }`}
                >
                  Env
                  {getSortIcon('envelope')}
                </button>
                {renderResizeHandle('envelope')}
              </div>
            )}
            {columnVisibility.brightness && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.brightness }}>
                <button
                  onClick={() => handleSortClick('brightness')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'brightness' ? 'text-accent-primary' : ''
                  }`}
                >
                  Bright
                  {getSortIcon('brightness')}
                </button>
                {renderResizeHandle('brightness')}
              </div>
            )}
            {columnVisibility.noisiness && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.noisiness }}>
                <button
                  onClick={() => handleSortClick('noisiness')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'noisiness' ? 'text-accent-primary' : ''
                  }`}
                >
                  Noisy
                  {getSortIcon('noisiness')}
                </button>
                {renderResizeHandle('noisiness')}
              </div>
            )}
            {columnVisibility.warmth && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.warmth }}>
                <button
                  onClick={() => handleSortClick('warmth')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'warmth' ? 'text-accent-primary' : ''
                  }`}
                >
                  Warmth
                  {getSortIcon('warmth')}
                </button>
                {renderResizeHandle('warmth')}
              </div>
            )}
            {columnVisibility.hardness && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.hardness }}>
                <button
                  onClick={() => handleSortClick('hardness')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'hardness' ? 'text-accent-primary' : ''
                  }`}
                >
                  Hard
                  {getSortIcon('hardness')}
                </button>
                {renderResizeHandle('hardness')}
              </div>
            )}
            {columnVisibility.sharpness && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.sharpness }}>
                <button
                  onClick={() => handleSortClick('sharpness')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'sharpness' ? 'text-accent-primary' : ''
                  }`}
                >
                  Sharp
                  {getSortIcon('sharpness')}
                </button>
                {renderResizeHandle('sharpness')}
              </div>
            )}
            {columnVisibility.loudness && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.loudness }}>
                <button
                  onClick={() => handleSortClick('loudness')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'loudness' ? 'text-accent-primary' : ''
                  }`}
                >
                  Loud
                  {getSortIcon('loudness')}
                </button>
                {renderResizeHandle('loudness')}
              </div>
            )}
            {columnVisibility.sampleRate && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.sampleRate }}>
                <button
                  onClick={() => handleSortClick('sampleRate')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'sampleRate' ? 'text-accent-primary' : ''
                  }`}
                >
                  SR
                  {getSortIcon('sampleRate')}
                </button>
                {renderResizeHandle('sampleRate')}
              </div>
            )}
            {columnVisibility.channels && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.channels }}>
                <button
                  onClick={() => handleSortClick('channels')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'channels' ? 'text-accent-primary' : ''
                  }`}
                >
                  Ch
                  {getSortIcon('channels')}
                </button>
                {renderResizeHandle('channels')}
              </div>
            )}
            {columnVisibility.format && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.format }}>
                <button
                  onClick={() => handleSortClick('format')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'format' ? 'text-accent-primary' : ''
                  }`}
                >
                  Fmt
                  {getSortIcon('format')}
                </button>
                {renderResizeHandle('format')}
              </div>
            )}
            {columnVisibility.polyphony && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.polyphony }}>
                <button
                  onClick={() => handleSortClick('polyphony')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'polyphony' ? 'text-accent-primary' : ''
                  }`}
                >
                  Poly
                  {getSortIcon('polyphony')}
                </button>
                {renderResizeHandle('polyphony')}
              </div>
            )}
            {columnVisibility.dateAdded && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.dateAdded }}>
                <button
                  onClick={() => handleSortClick('dateAdded')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'dateAdded' ? 'text-accent-primary' : ''
                  }`}
                >
                  Added
                  {getSortIcon('dateAdded')}
                </button>
                {renderResizeHandle('dateAdded')}
              </div>
            )}
            {columnVisibility.dateCreated && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.dateCreated }}>
                <button
                  onClick={() => handleSortClick('dateCreated')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'dateCreated' ? 'text-accent-primary' : ''
                  }`}
                >
                  Created
                  {getSortIcon('dateCreated')}
                </button>
                {renderResizeHandle('dateCreated')}
              </div>
            )}
            {columnVisibility.dateModified && (
              <div className="relative flex flex-shrink-0 justify-center" style={{ width: columnWidths.dateModified }}>
                <button
                  onClick={() => handleSortClick('dateModified')}
                  className={`w-full flex items-center justify-center section-label transition-colors hover:text-text-secondary ${
                    sortField === 'dateModified' ? 'text-accent-primary' : ''
                  }`}
                >
                  Modified
                  {getSortIcon('dateModified')}
                </button>
                {renderResizeHandle('dateModified')}
              </div>
            )}
            {columnVisibility.path && (
              <div className="relative flex flex-shrink-0 text-left min-w-0" style={{ width: columnWidths.path }}>
                <button
                  onClick={() => handleSortClick('path')}
                  className={`w-full min-w-0 flex items-center text-left section-label transition-colors hover:text-text-secondary ${
                    sortField === 'path' ? 'text-accent-primary' : ''
                  }`}
                >
                  <span className="truncate">Path</span>
                  {getSortIcon('path')}
                </button>
                {renderResizeHandle('path')}
              </div>
            )}

              <div className="relative flex-shrink-0 flex items-center justify-end" style={{ width: columnWidths.duration }}>
                <button
                  onClick={() => handleSortClick('duration')}
                  className={`w-full flex items-center justify-end section-label transition-colors hover:text-text-secondary ${
                    sortField === 'duration' ? 'text-accent-primary' : ''
                  }`}
                >
                  Duration
                  {getSortIcon('duration')}
                </button>
                {renderResizeHandle('duration')}
              </div>
            </div>

            <div className="col-start-1 row-start-1 sticky right-3 z-20 self-center justify-self-end pointer-events-none">
              <div className="pointer-events-auto">
                {columnsButton}
              </div>
            </div>
          </div>
        </div>

        {isDuplicatePairMode && (
          <div className="border-b border-surface-border bg-surface-raised/70 px-3 py-1 text-[10px] text-slate-400">
            Duplicate pair mode keeps keep/duplicate rows adjacent.
          </div>
        )}

        <div ref={rowsContainerRef}>
          {virtualWindow.topSpacer > 0 && (
            <div aria-hidden="true" style={{ height: `${virtualWindow.topSpacer}px` }} />
          )}

          <div className="divide-y divide-surface-border">
            {visibleSamples.map((sample) => {
              const renamePreview = bulkRenamePreviewById.get(sample.id)
              const duplicatePairMeta = isDuplicatePairMode ? duplicatePairMetaBySampleId.get(sample.id) : undefined
              return (
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
                  showInstrumentColumn={showInstrumentColumn}
                  showSimilarity={similarityMode?.enabled}
                  bulkRenamePreviewName={renamePreview?.hasChange ? renamePreview.nextName : null}
                  bulkRenameHighlightRanges={renamePreview?.hasChange ? renamePreview.highlightRanges : []}
                  duplicatePairMeta={duplicatePairMeta}
                  onToggleDuplicateDeleteTarget={
                    duplicatePairMeta ? () => onToggleDuplicateDeleteTarget?.(sample.id) : undefined
                  }
                  onKeepDuplicateSample={
                    duplicatePairMeta ? () => onKeepDuplicateSample?.(sample.id) : undefined
                  }
                />
              )
            })}
          </div>

          {virtualWindow.bottomSpacer > 0 && (
            <div aria-hidden="true" style={{ height: `${virtualWindow.bottomSpacer}px` }} />
          )}
        </div>
      </div>

      {showColumnsMenu && typeof document !== 'undefined' && createPortal(
        <div
          ref={columnsMenuPopoverRef}
          data-tour="samples-list-columns-menu"
          className="fixed w-64 bg-surface-raised border border-surface-border rounded-lg shadow-xl z-[120] p-2"
          style={{ top: columnsMenuPosition.top, left: columnsMenuPosition.left }}
        >
          <div className="text-[11px] text-slate-500 px-2 py-1">Columns</div>
          <div className="px-2 pb-1 text-[10px] text-slate-500">Drag the <GripVertical size={10} className="inline" /> handles in the header to resize.</div>
          <div className="max-h-56 overflow-y-auto">
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
          <button
            onClick={() => {
              setSortField(null)
              setSortOrder('asc')
            }}
            className="mt-1 w-full px-2 py-1.5 text-xs text-slate-300 bg-surface-base border border-surface-border rounded hover:bg-surface-overlay transition-colors"
          >
            Reset sort
          </button>

          <div className="mt-2 border-t border-surface-border pt-2">
            <div className="flex items-center justify-between px-1">
              <div className="text-[11px] text-slate-500">Presets</div>
              <button
                type="button"
                onClick={() => {
                  void saveCurrentAsPreset()
                }}
                data-tour="samples-list-save-current"
                className="rounded border border-surface-border bg-surface-base px-2 py-1 text-[10px] text-slate-300 hover:bg-surface-overlay transition-colors"
                title="Save current list view as preset"
              >
                Save current
              </button>
            </div>

            {savedPresets.length === 0 ? (
              <div className="px-2 py-2 text-[10px] text-slate-500">No presets saved yet.</div>
            ) : (
              <div className="mt-1 max-h-36 space-y-1 overflow-y-auto">
                {savedPresets.map((preset) => (
                  <div key={preset.id} className="rounded border border-surface-border bg-surface-base/70 p-1.5">
                    <button
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="w-full truncate text-left text-[11px] text-slate-200 hover:text-white"
                      title={`Apply preset: ${preset.name}`}
                    >
                      {preset.name}
                    </button>
                    <div className="mt-1 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className="rounded border border-surface-border px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-surface-overlay transition-colors"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => updatePreset(preset.id)}
                        className="rounded border border-surface-border px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-surface-overlay transition-colors"
                      >
                        Update
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void deletePreset(preset.id)
                        }}
                        className="rounded border border-red-500/30 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/10 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
      {dialogNode}
    </div>
  )
}
