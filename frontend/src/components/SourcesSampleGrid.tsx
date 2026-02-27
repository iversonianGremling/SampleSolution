import { useState, useRef, useEffect, useMemo, type ReactNode } from 'react'
import { Play, Pause, Heart, GripVertical, ArrowUpDown, ArrowUp, ArrowDown, Disc3, Info } from 'lucide-react'
import { CustomCheckbox } from './CustomCheckbox'
import { createDragPreview } from './DragPreview'
import { InstrumentIcon, resolveInstrumentType } from './InstrumentIcon'
import { DrumRackPadPicker } from './DrumRackPadPicker'
import type { SliceWithTrackExtended } from '../types'
import { createManagedAudio, releaseManagedAudio } from '../services/globalAudioVolume'
import { prepareSamplePreviewPlayback } from '../services/samplePreviewPlayback'
import type { TunePlaybackMode } from '../utils/tunePlaybackMode'
import { freqToNoteName, freqToPitchDisplay } from '../utils/musicTheory'
import type { BulkRenameHighlightRange } from '../utils/bulkRename'

type SortField =
  | 'name'
  | 'duration'
  | 'bpm'
  | 'key'
  | 'dateAdded'
  | 'tags'
  | 'artist'
  | 'album'
  | 'year'
  | 'albumArtist'
  | 'genre'
  | 'composer'
  | 'trackNumber'
  | 'discNumber'
  | 'tagBpm'
  | 'musicalKey'
  | 'isrc'
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
  | 'dateCreated'
  | 'dateModified'
  | 'path'
type SortOrder = 'asc' | 'desc'
export type PlayMode = 'normal' | 'one-shot' | 'reproduce-while-clicking'

type DuplicatePairMatchType = 'exact' | 'content' | 'file' | 'near-duplicate'

interface DuplicatePairCardMeta {
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

interface SourcesSampleGridProps {
  samples: SliceWithTrackExtended[]
  selectedId: number | null
  selectedIds?: Set<number>
  onSelect: (id: number) => void
  onToggleSelect?: (id: number) => void
  onToggleSelectAll?: () => void
  showSelectAllControl?: boolean
  showSortControls?: boolean
  onToggleFavorite?: (id: number) => void
  onTagClick?: (tagId: number) => void
  isLoading?: boolean
  playMode?: PlayMode
  loopEnabled?: boolean
  tuneTargetNote?: string | null
  tunePlaybackMode?: TunePlaybackMode
  scaleDegreeGroups?: Map<string, SliceWithTrackExtended[]> | null
  bulkRenamePreviewById?: Map<number, { nextName: string; hasChange: boolean; highlightRanges: BulkRenameHighlightRange[] }>
  duplicatePairMetaBySampleId?: Map<number, DuplicatePairCardMeta>
  onToggleDuplicateDeleteTarget?: (sampleId: number) => void
  onKeepDuplicateSample?: (sampleId: number) => void
}

const GRID_GAP_PX = 10
const GRID_HORIZONTAL_PADDING_PX = 32
const GRID_VERTICAL_PADDING_PX = 16
const CARD_ASPECT_RATIO = 9 / 16
const CARD_META_HEIGHT_PX = 62
const ROW_OVERSCAN = 1
const MIN_RENDERED_ROWS = 5
const SAMPLE_CARD_SELECTOR = '[data-sources-sample-card="true"]'

const QUICK_SORT_OPTIONS: Array<{ field: SortField; label: string }> = [
  { field: 'name', label: 'Name' },
  { field: 'bpm', label: 'BPM' },
  { field: 'key', label: 'Key' },
  { field: 'duration', label: 'Duration' },
  { field: 'dateAdded', label: 'Added' },
]

const MORE_SORT_OPTIONS: Array<{ field: SortField; label: string }> = [
  { field: 'tags', label: 'Instruments' },
  { field: 'artist', label: 'Artist' },
  { field: 'album', label: 'Album' },
  { field: 'year', label: 'Year' },
  { field: 'albumArtist', label: 'Album Artist' },
  { field: 'genre', label: 'Genre' },
  { field: 'composer', label: 'Composer' },
  { field: 'trackNumber', label: 'Track #' },
  { field: 'discNumber', label: 'Disc #' },
  { field: 'tagBpm', label: 'Detected BPM' },
  { field: 'musicalKey', label: 'Detected Key' },
  { field: 'isrc', label: 'ISRC' },
  { field: 'scale', label: 'Scale' },
  { field: 'envelope', label: 'Envelope' },
  { field: 'brightness', label: 'Brightness' },
  { field: 'noisiness', label: 'Noisiness' },
  { field: 'warmth', label: 'Warmth' },
  { field: 'hardness', label: 'Hardness' },
  { field: 'sharpness', label: 'Sharpness' },
  { field: 'loudness', label: 'Loudness' },
  { field: 'sampleRate', label: 'Sample Rate' },
  { field: 'channels', label: 'Channels' },
  { field: 'format', label: 'Format' },
  { field: 'polyphony', label: 'Polyphony' },
  { field: 'dateCreated', label: 'Date Created' },
  { field: 'dateModified', label: 'Date Modified' },
  { field: 'path', label: 'Path' },
]

const QUICK_SORT_FIELD_SET = new Set(QUICK_SORT_OPTIONS.map((option) => option.field))

const getResponsiveColumnCount = (width: number, pairMode = false) => {
  if (pairMode) {
    if (width >= 1536) return 6
    if (width >= 1024) return 4
    if (width >= 640) return 2
    return 1
  }

  if (width >= 1536) return 6
  if (width >= 1280) return 5
  if (width >= 1024) return 4
  if (width >= 768) return 3
  if (width >= 640) return 2
  return 1
}

const findScrollParent = (node: HTMLElement | null): HTMLElement | null => {
  if (!node) return null
  let current: HTMLElement | null = node.parentElement
  while (current) {
    const style = window.getComputedStyle(current)
    if (/(auto|scroll|overlay)/.test(style.overflowY)) {
      return current
    }
    current = current.parentElement
  }
  return null
}

const getOffsetTopWithinParent = (element: HTMLElement, parent: HTMLElement) => {
  const elementRect = element.getBoundingClientRect()
  const parentRect = parent.getBoundingClientRect()
  return elementRect.top - parentRect.top + parent.scrollTop
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function getPathDisplay(sample: SliceWithTrackExtended): string | null {
  return sample.pathDisplay || sample.track.relativePath || sample.track.originalPath || null
}

function getKeyDisplay(sample: SliceWithTrackExtended): string | null {
  return (
    (sample.fundamentalFrequency
      ? freqToPitchDisplay(sample.fundamentalFrequency)?.compactLabel ?? null
      : null) ||
    sample.keyEstimate ||
    null
  )
}

function getKeySortValue(sample: SliceWithTrackExtended): string | null {
  return (sample.fundamentalFrequency ? freqToNoteName(sample.fundamentalFrequency) : null) || sample.keyEstimate || null
}

function getSortValue(sample: SliceWithTrackExtended, field: SortField): string | number | null {
  switch (field) {
    case 'name':
      return sample.name.toLowerCase()
    case 'duration':
      return sample.endTime - sample.startTime
    case 'bpm':
      return sample.bpm ?? null
    case 'key':
      return getKeySortValue(sample)?.toLowerCase() ?? null
    case 'dateAdded':
      return parseDate(sample.dateAdded || sample.createdAt)
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
    case 'composer':
      return sample.track.composer?.toLowerCase() ?? null
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
    case 'scale':
      return sample.scale?.toLowerCase() ?? null
    case 'envelope':
      return sample.envelopeType?.toLowerCase() ?? null
    case 'brightness':
      return sample.subjectiveNormalized?.brightness ?? sample.brightness ?? null
    case 'noisiness':
      return sample.subjectiveNormalized?.noisiness ?? sample.noisiness ?? sample.roughness ?? null
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
    case 'dateCreated':
      return parseDate(sample.dateCreated)
    case 'dateModified':
      return parseDate(sample.dateModified)
    case 'path':
      return getPathDisplay(sample)?.toLowerCase() ?? null
    default:
      return null
  }
}

function renderHighlightedRenameText(
  value: string,
  ranges: BulkRenameHighlightRange[],
): ReactNode {
  if (ranges.length === 0) return value

  const orderedRanges = [...ranges]
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)

  if (orderedRanges.length === 0) return value

  const fragments: ReactNode[] = []
  let cursor = 0

  orderedRanges.forEach((range, index) => {
    const start = Math.max(cursor, Math.min(range.start, value.length))
    const end = Math.max(start, Math.min(range.end, value.length))
    if (start > cursor) {
      fragments.push(value.slice(cursor, start))
    }
    if (end > start) {
      fragments.push(
        <span key={`bulk-rename-highlight-${index}`} className="text-sky-300">
          {value.slice(start, end)}
        </span>,
      )
    }
    cursor = end
  })

  if (cursor < value.length) {
    fragments.push(value.slice(cursor))
  }

  return fragments
}

function FadeInOnMount({ children }: { children: ReactNode }) {
  return (
    <div className="animate-fade-in motion-reduce:animate-none">
      {children}
    </div>
  )
}

function getDuplicateMatchLabel(matchType: DuplicatePairMatchType): string {
  if (matchType === 'exact') return 'Fingerprint'
  if (matchType === 'content') return 'Content'
  if (matchType === 'near-duplicate') return 'Near-duplicate'
  return 'File'
}

export function SourcesSampleGrid({
  samples,
  selectedId,
  selectedIds = new Set(),
  onSelect,
  onToggleSelect,
  onToggleSelectAll,
  showSelectAllControl = true,
  showSortControls = true,
  onToggleFavorite,
  onTagClick,
  isLoading = false,
  playMode = 'normal',
  loopEnabled = false,
  tuneTargetNote = null,
  tunePlaybackMode: _tunePlaybackMode = 'tape',
  scaleDegreeGroups = null,
  bulkRenamePreviewById = new Map<number, { nextName: string; hasChange: boolean; highlightRanges: BulkRenameHighlightRange[] }>(),
  duplicatePairMetaBySampleId = new Map<number, DuplicatePairCardMeta>(),
  onToggleDuplicateDeleteTarget,
  onKeepDuplicateSample,
}: SourcesSampleGridProps) {
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const flatGridContainerRef = useRef<HTMLDivElement | null>(null)
  const groupedGridRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const scrollParentRef = useRef<HTMLElement | null>(null)
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const [padPickerSample, setPadPickerSample] = useState<SliceWithTrackExtended | null>(null)
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [tagPopupId, setTagPopupId] = useState<number | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 0))
  const [gridWidth, setGridWidth] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [useWindowScroll, setUseWindowScroll] = useState(false)
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(null)
  const dragPreviewRef = useRef<HTMLElement | null>(null)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [infoOverlaySampleId, setInfoOverlaySampleId] = useState<number | null>(null)
  const hasGridContent = !isLoading && samples.length > 0
  const isDuplicatePairMode =
    Boolean(onToggleDuplicateDeleteTarget || onKeepDuplicateSample) && duplicatePairMetaBySampleId.size > 0

  const preparePlaybackForSample = (sample: SliceWithTrackExtended) =>
    prepareSamplePreviewPlayback(sample, tuneTargetNote)

  // Stop audio when unmounting
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        releaseManagedAudio(audioRef.current)
        audioRef.current = null
      }
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
        closeTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const scrollParent = findScrollParent(root)
    scrollParentRef.current = scrollParent ?? null
    let rafId: number | null = null
    let resizeObserver: ResizeObserver | null = null

    const readScrollMetrics = () => {
      const activeScrollParent = scrollParentRef.current
      const hasScrollParent = Boolean(activeScrollParent && activeScrollParent.clientHeight > 0)
      setViewportWidth(window.innerWidth)
      if (hasScrollParent && activeScrollParent) {
        setUseWindowScroll(false)
        setScrollTop(activeScrollParent.scrollTop)
        setViewportHeight(activeScrollParent.clientHeight)
      } else {
        setUseWindowScroll(true)
        setScrollTop(window.scrollY || document.documentElement.scrollTop || 0)
        setViewportHeight(window.innerHeight)
      }
    }

    const updateScrollState = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        setTagPopupId(null)
        setInfoOverlaySampleId(null)
        readScrollMetrics()
      })
    }

    readScrollMetrics()
    if (scrollParent) {
      scrollParent.addEventListener('scroll', updateScrollState, { passive: true })
    }
    window.addEventListener('scroll', updateScrollState, { passive: true })
    window.addEventListener('resize', updateScrollState)
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateScrollState)
      resizeObserver.observe(root)
      if (scrollParent) {
        resizeObserver.observe(scrollParent)
      }
    }

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
      if (scrollParent) {
        scrollParent.removeEventListener('scroll', updateScrollState)
      }
      window.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
    }
  }, [hasGridContent])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const updateGridWidth = () => {
      const flatGridWidth = flatGridContainerRef.current?.clientWidth ?? 0
      setGridWidth(flatGridWidth || root.clientWidth)
    }

    updateGridWidth()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateGridWidth)
      return () => {
        window.removeEventListener('resize', updateGridWidth)
      }
    }

    const observer = new ResizeObserver(() => {
      updateGridWidth()
    })
    observer.observe(root)

    return () => {
      observer.disconnect()
    }
  }, [hasGridContent])

  useEffect(() => {
    let frameId: number | null = null
    frameId = window.requestAnimationFrame(() => {
      const scrollParent = scrollParentRef.current
      setViewportWidth(window.innerWidth)

      if (scrollParent && scrollParent.clientHeight > 0) {
        setUseWindowScroll(false)
        setScrollTop(scrollParent.scrollTop)
        setViewportHeight(scrollParent.clientHeight)
        return
      }

      setUseWindowScroll(true)
      setScrollTop(window.scrollY || document.documentElement.scrollTop || 0)
      setViewportHeight(window.innerHeight)
    })

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [samples, scaleDegreeGroups])

  const formatDuration = (startTime: number, endTime: number) => {
    const duration = endTime - startTime
    if (duration < 60) {
      return `${duration.toFixed(1)}s`
    }
    const mins = Math.floor(duration / 60)
    const secs = Math.floor(duration % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatSampleRate = (sampleRate: number | null | undefined) => {
    if (!sampleRate || sampleRate <= 0) return 'n/a'
    return `${(sampleRate / 1000).toFixed(1)}kHz`
  }

  const formatDate = (value: string | null | undefined) => {
    if (!value) return 'n/a'
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return 'n/a'
    return parsed.toLocaleDateString()
  }

  const clamp01 = (value: number, fallback = 0.5) => {
    if (!Number.isFinite(value)) return fallback
    return Math.max(0, Math.min(1, value))
  }

  const normalizeLoudness = (loudness: number | null | undefined) => {
    if (loudness === null || loudness === undefined || Number.isNaN(loudness)) return 0.5
    // Typical sample loudness range in dB
    return clamp01((loudness + 48) / 42, 0.5)
  }

  const normalizeHarmonicity = (sample: SliceWithTrackExtended) => {
    const ratio = (sample as SliceWithTrackExtended & { harmonicPercussiveRatio?: number | null }).harmonicPercussiveRatio
    if (ratio !== null && ratio !== undefined && Number.isFinite(ratio) && ratio >= 0) {
      // Squash to 0..1 where 0.5 means balanced, >0.5 means more harmonic
      return clamp01(ratio / (1 + ratio), 0.5)
    }

    // Fallback: roughness is usually inverse-correlated with harmonicity
    const roughness = clamp01(sample.roughness ?? 0.5, 0.5)
    return 1 - roughness
  }

  const isLightTheme = () =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light'

  const getMetricGradient = (sample: SliceWithTrackExtended) => {
    const brightness = clamp01(sample.brightness ?? 0.5, 0.5)
    const loudness = normalizeLoudness(sample.loudness)
    const harmonicity = normalizeHarmonicity(sample)
    const noisiness = 1 - harmonicity

    const lightTheme = isLightTheme()

    // Shiny triad palette for card view: magenta, cyan, and yellow.
    // Keep luminosity theme-aware so icon/text contrast remains strong.
    const baseHue = 236 - brightness * 18 + loudness * 10
    const baseSaturation = (lightTheme ? 64 : 40) + loudness * (lightTheme ? 20 : 16)
    const baseLightTop = (lightTheme ? 72 : 18) + brightness * (lightTheme ? 9 : 8) + loudness * (lightTheme ? 4 : 6)
    const baseLightBottom = (lightTheme ? 58 : 11) + harmonicity * (lightTheme ? 10 : 8)

    const magentaColor = `hsla(${312 + brightness * 10}, ${lightTheme ? 88 : 88}%, ${lightTheme ? 56 : 58}%, ${lightTheme ? 0.24 + brightness * 0.14 : 0.16 + brightness * 0.2})`
    const cyanColor = `hsla(${188 + loudness * 8}, ${lightTheme ? 90 : 90}%, ${lightTheme ? 50 : 54}%, ${lightTheme ? 0.22 + loudness * 0.14 : 0.14 + loudness * 0.2})`
    const yellowColor = `hsla(${50 + noisiness * 10}, ${lightTheme ? 94 : 94}%, ${lightTheme ? 54 : 58}%, ${lightTheme ? 0.2 + noisiness * 0.14 : 0.12 + noisiness * 0.2})`
    const sheenColor = lightTheme ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.14)'
    const vignetteColor = lightTheme ? 'rgba(15,23,42,0.16)' : 'rgba(2,6,23,0.32)'
    const baseTopColor = `hsl(${baseHue}, ${baseSaturation}%, ${baseLightTop}%)`
    const baseBottomColor = `hsl(${baseHue - 8}, ${Math.max(18, baseSaturation - 8)}%, ${baseLightBottom}%)`

    return {
      backgroundColor: baseTopColor,
      backgroundImage: `
        radial-gradient(120% 105% at 16% 16%, ${magentaColor} 0%, transparent 56%),
        radial-gradient(110% 100% at 86% 18%, ${cyanColor} 0%, transparent 55%),
        radial-gradient(125% 112% at 52% 96%, ${yellowColor} 0%, transparent 58%),
        linear-gradient(165deg, ${sheenColor} 0%, transparent 42%),
        linear-gradient(180deg, transparent 54%, ${vignetteColor} 100%),
        linear-gradient(145deg, ${baseTopColor} 0%, ${baseBottomColor} 100%)
      `,
      boxShadow: lightTheme
        ? 'inset 0 0 0 1px rgba(71,85,105,0.42)'
        : 'inset 0 0 0 1px rgba(255,255,255,0.08)',
    }
  }

  const getInstrumentBadgeStyle = (sample: SliceWithTrackExtended) => {
    const lightTheme = isLightTheme()
    return {
      ...getMetricGradient(sample),
      backgroundSize: '220% 220%',
      border: lightTheme ? '1px solid rgba(30,41,59,0.28)' : '1px solid rgba(255,255,255,0.12)',
      boxShadow: lightTheme
        ? '0 2px 8px rgba(15,23,42,0.28), inset 0 0 0 1px rgba(51,65,85,0.45)'
        : '0 2px 8px rgba(2,6,23,0.45), inset 0 0 0 1px rgba(255,255,255,0.14)',
    }
  }

  useEffect(() => {
    if (!isDuplicatePairMode) return
    setSortField(null)
    setSortOrder('asc')
  }, [isDuplicatePairMode])

  const handleSortClick = (field: SortField) => {
    if (isDuplicatePairMode) return
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const handleMoreSortChange = (field: SortField) => {
    if (isDuplicatePairMode) return
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortField(field)
    setSortOrder('asc')
  }

  const toggleSortOrder = () => {
    if (isDuplicatePairMode) return
    setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
  }

  const sortItems = (items: SliceWithTrackExtended[]) => {
    if (!sortField || isDuplicatePairMode) return items

    return [...items].sort((a, b) => {
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
  }

  const sortedSamples = useMemo(() => {
    return sortItems(samples)
  }, [samples, sortField, sortOrder, isDuplicatePairMode])

  const sortedScaleDegreeGroups = useMemo(() => {
    if (!scaleDegreeGroups) return null
    return Array.from(scaleDegreeGroups.entries()).map(([degree, groupSamples]) => [
      degree,
      sortItems(groupSamples),
    ] as const)
  }, [scaleDegreeGroups, sortField, sortOrder, isDuplicatePairMode])

  const columnCount = useMemo(
    () => getResponsiveColumnCount(viewportWidth, isDuplicatePairMode),
    [viewportWidth, isDuplicatePairMode],
  )

  const cardMetaHeight = isDuplicatePairMode ? 92 : CARD_META_HEIGHT_PX

  const estimatedRowHeight = useMemo(() => {
    const usableWidth = Math.max(
      0,
      gridWidth - GRID_HORIZONTAL_PADDING_PX - GRID_GAP_PX * Math.max(0, columnCount - 1),
    )
    const cardWidth = columnCount > 0 ? usableWidth / columnCount : usableWidth
    return cardWidth * CARD_ASPECT_RATIO + cardMetaHeight + GRID_GAP_PX
  }, [gridWidth, columnCount, cardMetaHeight])

  const rowHeight = measuredRowHeight ?? estimatedRowHeight

  const getVirtualWindow = (itemCount: number, gridNode: HTMLElement | null) => {
    const safeColumnCount = Math.max(1, columnCount)
    const totalRows = Math.ceil(itemCount / safeColumnCount)
    const minRowsToFillViewport = rowHeight > 0 && viewportHeight > 0
      ? Math.ceil(viewportHeight / rowHeight) + ROW_OVERSCAN * 2
      : 0
    const maxRenderedRows = Math.max(MIN_RENDERED_ROWS, minRowsToFillViewport)
    const buildRowWindow = (targetRow: number) => {
      const maxStartRow = Math.max(0, totalRows - maxRenderedRows)
      const startRow = clamp(targetRow, 0, maxStartRow)
      const endRowExclusive = Math.min(totalRows, startRow + maxRenderedRows)
      return {
        startIndex: Math.min(itemCount, startRow * safeColumnCount),
        endIndex: Math.min(itemCount, endRowExclusive * safeColumnCount),
        topSpacer: startRow * rowHeight,
        bottomSpacer: Math.max(0, totalRows - endRowExclusive) * rowHeight,
      }
    }

    if (totalRows === 0) {
      return {
        startIndex: 0,
        endIndex: itemCount,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }

    if (!gridNode || viewportHeight <= 0 || rowHeight <= 0) {
      // If we cannot place the virtual window yet, render all items to avoid blank
      // regions caused by stale/unknown container measurements.
      return {
        startIndex: 0,
        endIndex: itemCount,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }

    const scrollParent = scrollParentRef.current
    const gridOffsetTop = useWindowScroll
      ? gridNode.getBoundingClientRect().top + (window.scrollY || document.documentElement.scrollTop || 0)
      : scrollParent
      ? getOffsetTopWithinParent(gridNode, scrollParent)
      : gridNode.offsetTop
    const visibleTop = scrollTop - gridOffsetTop - GRID_VERTICAL_PADDING_PX
    const visibleBottom = visibleTop + viewportHeight

    const rawStartRow = Math.floor(visibleTop / rowHeight) - ROW_OVERSCAN
    const rawEndRowExclusive = Math.ceil(visibleBottom / rowHeight) + ROW_OVERSCAN
    const startRow = clamp(rawStartRow, 0, totalRows)
    const endRowExclusive = clamp(rawEndRowExclusive, 0, totalRows)

    if (startRow >= endRowExclusive) {
      if (rawEndRowExclusive <= 0) {
        return buildRowWindow(0)
      }

      if (rawStartRow >= totalRows) {
        return buildRowWindow(totalRows - maxRenderedRows)
      }

      return buildRowWindow(startRow)
    }

    let windowStartRow = startRow
    let windowEndRowExclusive = endRowExclusive
    if (windowEndRowExclusive - windowStartRow > maxRenderedRows) {
      if (windowEndRowExclusive >= totalRows) {
        windowEndRowExclusive = totalRows
        windowStartRow = Math.max(0, windowEndRowExclusive - maxRenderedRows)
      } else {
        windowEndRowExclusive = windowStartRow + maxRenderedRows
      }
    }

    const startIndex = Math.min(itemCount, windowStartRow * safeColumnCount)
    const endIndex = Math.min(itemCount, windowEndRowExclusive * safeColumnCount)
    const renderedRows = Math.max(0, windowEndRowExclusive - windowStartRow)

    if (endIndex <= startIndex) {
      return buildRowWindow(startRow)
    }

    return {
      startIndex,
      endIndex,
      topSpacer: windowStartRow * rowHeight,
      bottomSpacer: Math.max(0, totalRows - windowStartRow - renderedRows) * rowHeight,
    }
  }

  const flatVirtualWindow = useMemo(() => {
    if (scaleDegreeGroups) {
      return {
        startIndex: 0,
        endIndex: sortedSamples.length,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }
    return getVirtualWindow(sortedSamples.length, flatGridContainerRef.current)
  }, [scaleDegreeGroups, sortedSamples, columnCount, rowHeight, scrollTop, viewportHeight, useWindowScroll])

  const visibleFlatSamples = useMemo(() => {
    if (scaleDegreeGroups) return []
    return sortedSamples.slice(flatVirtualWindow.startIndex, flatVirtualWindow.endIndex)
  }, [scaleDegreeGroups, sortedSamples, flatVirtualWindow.startIndex, flatVirtualWindow.endIndex])

  useEffect(() => {
    // Layout changes invalidate any previously measured row height.
    setMeasuredRowHeight(null)
  }, [columnCount, gridWidth, scaleDegreeGroups ? scaleDegreeGroups.size : 0])

  useEffect(() => {
    let frameId: number | null = null
    frameId = window.requestAnimationFrame(() => {
      const root = rootRef.current
      if (!root) return
      const cards = Array.from(root.querySelectorAll<HTMLElement>(SAMPLE_CARD_SELECTOR))
      if (cards.length === 0) return

      const uniqueRowTops = Array.from(new Set(cards.map((card) => card.offsetTop))).sort((a, b) => a - b)
      let measuredHeight = cards[0].offsetHeight + GRID_GAP_PX

      if (uniqueRowTops.length > 1) {
        const rowSteps = uniqueRowTops
          .slice(1)
          .map((top, index) => top - uniqueRowTops[index])
          .filter((step) => Number.isFinite(step) && step > 0)
          .sort((a, b) => a - b)

        if (rowSteps.length > 0) {
          measuredHeight = rowSteps[Math.floor(rowSteps.length / 2)]
        }
      }

      if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return
      setMeasuredRowHeight((previous) => {
        if (previous !== null && Math.abs(previous - measuredHeight) < 1) {
          return previous
        }
        return measuredHeight
      })
    })

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [
    columnCount,
    gridWidth,
    scrollTop,
    sortedSamples.length,
    sortedScaleDegreeGroups?.length,
    flatVirtualWindow.startIndex,
    flatVirtualWindow.endIndex,
  ])

  const handlePlay = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()

    if (playMode === 'normal') {
      // Normal mode: toggle play/pause
      if (playingId === id) {
        // Stop playing
        if (audioRef.current) {
          audioRef.current.pause()
          releaseManagedAudio(audioRef.current)
          audioRef.current = null
        }
        setPlayingId(null)
      } else {
        // Stop previous
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
      // One-shot mode: always play the whole sample, stop others (loop disabled)
      // Stop previous
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
      // Stop current if playing
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
      // Stop playing when mouse is released
      if (audioRef.current) {
        audioRef.current.pause()
        releaseManagedAudio(audioRef.current)
        audioRef.current = null
      }
      setPlayingId(null)
    }
  }

  const handleDragStart = (e: React.DragEvent, sample: SliceWithTrackExtended) => {
    setDraggedId(sample.id)

    // Determine which samples to drag
    let samplesToDrag: number[]
    if (selectedIds.has(sample.id)) {
      // If the dragged sample is selected, drag all selected samples
      samplesToDrag = Array.from(selectedIds)
    } else {
      // Otherwise, just drag this one sample
      samplesToDrag = [sample.id]
    }

    // Set drag data
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'samples',
      sampleIds: samplesToDrag,
      slice: samplesToDrag.length === 1 ? sample : undefined,
    }))
    e.dataTransfer.effectAllowed = 'copy'

    // Create and set custom drag preview
    const sampleName = samplesToDrag.length === 1 ? sample.name : undefined
    const preview = createDragPreview(samplesToDrag.length, sampleName)
    dragPreviewRef.current = preview

    // Set the drag image synchronously
    try {
      e.dataTransfer.setDragImage(preview, 35, 20)
    } catch (err) {
      console.error('Failed to set drag image:', err)
    }
  }

  const handleDragEnd = () => {
    setDraggedId(null)

    // Clean up preview element
    if (dragPreviewRef.current && dragPreviewRef.current.parentNode) {
      document.body.removeChild(dragPreviewRef.current)
      dragPreviewRef.current = null
    }
  }

  const handleTagPopupOpen = (sampleId: number) => {
    // Clear any pending close timeout
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setTagPopupId(sampleId)
  }

  const handleTagPopupClose = () => {
    // Add a small delay before closing to make it easier to move mouse to popup
    closeTimeoutRef.current = setTimeout(() => {
      setTagPopupId(null)
    }, 150)
  }

  const handleTagPopupEnter = (sampleId: number) => {
    // Cancel close if mouse enters popup
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setTagPopupId(sampleId)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
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
    if (sortField !== field) {
      return <ArrowUpDown size={14} className="ml-1" />
    }
    return sortOrder === 'asc' ? <ArrowUp size={14} className="ml-1" /> : <ArrowDown size={14} className="ml-1" />
  }

  const activeMoreSortField = sortField && !QUICK_SORT_FIELD_SET.has(sortField) ? sortField : ''

  // Determine if select-all checkbox should be indeterminate
  const selectAllIndeterminate = selectedIds.size > 0 && selectedIds.size < sortedSamples.length
  const selectAllChecked = selectedIds.size === sortedSamples.length && sortedSamples.length > 0

  const renderSampleCard = (sample: SliceWithTrackExtended) => {
        const isSelected = selectedId === sample.id
        const isChecked = selectedIds.has(sample.id)
        const isPlaying = playingId === sample.id
        const isDragging = draggedId === sample.id
        const isTagPopupOpen = tagPopupId === sample.id
        const isInfoOverlayOpen = infoOverlaySampleId === sample.id
        const renamePreview = bulkRenamePreviewById.get(sample.id)
        const hasRenamePreview = Boolean(renamePreview?.hasChange)
        const duplicatePairMeta = isDuplicatePairMode ? duplicatePairMetaBySampleId.get(sample.id) : undefined
        const duplicateRoleClass = duplicatePairMeta
          ? duplicatePairMeta.selectedForDelete
            ? 'bg-red-500/20 text-red-100'
            : duplicatePairMeta.role === 'keep'
              ? 'bg-emerald-500/20 text-emerald-200'
              : 'bg-amber-500/20 text-amber-200'
          : ''
        const duplicateRoleLabel = duplicatePairMeta
          ? duplicatePairMeta.role === 'keep'
            ? 'Keep'
            : 'Duplicate'
          : null
        const duplicateCanToggleDelete =
          Boolean(duplicatePairMeta && duplicatePairMeta.canDelete && onToggleDuplicateDeleteTarget)
        const duplicateCanKeepThis =
          Boolean(duplicatePairMeta && duplicatePairMeta.canDeletePartner && onKeepDuplicateSample)
        const duplicateKeepThisSelected =
          Boolean(
            duplicatePairMeta &&
            duplicatePairMeta.selectedDeleteSampleId === duplicatePairMeta.partnerSampleId,
          )
        const duplicateDeleteThisSelected = Boolean(duplicatePairMeta?.selectedForDelete)
        const bpmDisplay = typeof sample.bpm === 'number' && Number.isFinite(sample.bpm)
          ? `${Math.round(sample.bpm)}`
          : 'n/a'
        const keyDisplay = getKeyDisplay(sample) || 'n/a'
        const formatDisplay = sample.format?.toUpperCase() || 'n/a'
        const channelsDisplay = sample.channels && sample.channels > 0 ? `${sample.channels}ch` : 'n/a'
        const addedDisplay = formatDate(sample.dateAdded || sample.createdAt)
        const artistDisplay = sample.track.artist?.trim() || 'Unknown'
        const resolvedInstrumentType = resolveInstrumentType(
          sample.instrumentType,
          sample.instrumentPrimary,
          ...sample.tags.map(t => t.name),
          sample.name,
          sample.filePath,
        )
        const defaultCardStateClass = duplicatePairMeta
          ? duplicatePairMeta.selectedForDelete
            ? 'ring-2 ring-red-500/60 shadow-lg shadow-red-500/20'
            : duplicatePairMeta.role === 'keep'
              ? 'ring-1 ring-emerald-500/50 shadow-md shadow-emerald-500/10'
              : 'ring-1 ring-amber-500/50 shadow-md shadow-amber-500/10'
          : 'hover:bg-surface-overlay hover:shadow-lg hover:scale-[1.02]'

        return (
          <FadeInOnMount key={sample.id}>
            <div
              data-sources-sample-card="true"
              data-tour="sample-card"
              onClick={() => {
                setInfoOverlaySampleId(null)
                onSelect(sample.id)
              }}
              draggable
              onDragStart={(e) => handleDragStart(e, sample)}
              onDragEnd={handleDragEnd}
              className={`group relative ${isTagPopupOpen ? 'z-[70]' : 'z-0 hover:z-10'} bg-surface-raised rounded-xl overflow-visible cursor-pointer transition-all ${
                isSelected
                  ? 'ring-2 ring-accent-warm shadow-lg shadow-accent-warm/20'
                  : isChecked
                  ? 'ring-2 ring-accent-primary/60 shadow-md shadow-accent-primary/10'
                  : defaultCardStateClass
              } ${isDragging ? 'opacity-50' : ''}`}
            >
              {/* Instrument visual area */}
              <div className="aspect-[16/9] relative flex items-center justify-center overflow-hidden rounded-t-xl" style={getMetricGradient(sample)}>
                <div className="absolute inset-0 flex items-center justify-center text-white/90">
                  <InstrumentIcon type={resolvedInstrumentType} size={56} className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]" />
                </div>

                {/* Play button overlay */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isInfoOverlayOpen) {
                      setInfoOverlaySampleId(null)
                      return
                    }
                    if (playMode !== 'reproduce-while-clicking') {
                      handlePlay(sample.id, e)
                    }
                  }}
                  onMouseDown={playMode === 'reproduce-while-clicking'
                    ? (e) => {
                        if (isInfoOverlayOpen) {
                          e.stopPropagation()
                          setInfoOverlaySampleId(null)
                          return
                        }
                        handleMouseDown(sample.id, e)
                      }
                    : undefined}
                  onMouseUp={playMode === 'reproduce-while-clicking' ? handleMouseUp : undefined}
                  onMouseLeave={playMode === 'reproduce-while-clicking' ? handleMouseUp : undefined}
                  className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                    isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    isPlaying ? 'bg-accent-primary' : 'bg-surface-base/60 hover:bg-surface-base/80'
                  }`}>
                    {isPlaying && playMode === 'normal' ? (
                      <Pause size={18} className="text-white" />
                    ) : (
                      <Play size={18} className="text-white ml-0.5" />
                    )}
                  </div>
                </button>

                {/* Checkbox for selection */}
                {onToggleSelect && (
                  <div
                    className={`absolute top-1.5 left-1.5 transition-opacity ${
                      isChecked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleSelect(sample.id)
                    }}
                  >
                    <CustomCheckbox
                      checked={isChecked}
                      onChange={() => {}}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleSelect(sample.id)
                      }}
                    />
                  </div>
                )}

                <div
                  data-tour="sample-card-hover-actions"
                  className="absolute top-1 right-1 h-7 w-[72px] pointer-events-none"
                  aria-hidden
                />

                {/* Favorite button */}
                {onToggleFavorite && (
                  <button
                    data-tour="sample-card-favorite"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleFavorite(sample.id)
                    }}
                    className={`absolute top-1.5 right-1.5 p-1 rounded transition-all ${
                      sample.favorite
                        ? 'text-amber-400 bg-amber-400/20'
                        : 'text-slate-400 opacity-0 group-hover:opacity-100 hover:text-amber-400 hover:bg-amber-400/20'
                    }`}
                  >
                    <Heart size={14} className={sample.favorite ? 'fill-current' : ''} />
                  </button>
                )}

                {/* Send to Drum Rack button */}
                <button
                  data-tour="sample-card-drumrack"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPadPickerSample(sample)
                  }}
                  className="absolute top-1.5 right-8 p-1 rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:text-accent-primary hover:bg-accent-primary/20 transition-all"
                  title="Send to Drum Rack"
                >
                  <Disc3 size={14} />
                </button>

                {/* Details button */}
                <button
                  data-tour="sample-card-details"
                  onClick={(e) => {
                    e.stopPropagation()
                    setInfoOverlaySampleId((current) => (current === sample.id ? null : sample.id))
                  }}
                  className={`absolute top-1.5 right-14 p-1 rounded transition-all ${
                    isInfoOverlayOpen
                      ? 'text-white bg-black/50 opacity-100'
                      : 'text-slate-400 opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-surface-base/40'
                  }`}
                  title={isInfoOverlayOpen ? 'Hide sample info' : 'Show sample info'}
                  aria-pressed={isInfoOverlayOpen}
                >
                  <Info size={14} />
                </button>

                {/* Drag handle */}
                {!onToggleSelect && (
                  <div className="absolute top-1.5 left-1.5 p-1 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
                    <GripVertical size={14} />
                  </div>
                )}

                {/* Duration badge */}
                <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0 text-[10px] font-medium bg-surface-base/60 rounded text-white inline-block">
                  {formatDuration(sample.startTime, sample.endTime)}
                </span>

                {/* Instrument type badge */}
                <div
                  className="absolute bottom-1.5 left-1.5 p-1 rounded text-white"
                  title={`${resolvedInstrumentType} • brightness + loudness + harmonic/noisy`}
                  style={getInstrumentBadgeStyle(sample)}
                >
                  <InstrumentIcon
                    type={resolvedInstrumentType}
                    size={12}
                    className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]"
                  />
                </div>

                <div
                  className={`pointer-events-none absolute inset-0 z-20 flex flex-col justify-center gap-0.5 bg-black/70 px-2.5 text-left transition-all duration-200 ${
                    isInfoOverlayOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
                  }`}
                  aria-hidden={!isInfoOverlayOpen}
                >
                  <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[10px] leading-tight">
                    <span className="text-white/55">Track</span>
                    <span className="truncate text-white/90">{sample.track.title?.trim() || 'Unknown track'}</span>
                    <span className="text-white/55">Artist</span>
                    <span className="truncate text-white/80">{artistDisplay}</span>
                    <span className="text-white/55">Length</span>
                    <span className="truncate text-white/80">{formatDuration(sample.startTime, sample.endTime)}</span>
                    <span className="text-white/55">Tempo</span>
                    <span className="truncate text-white/80">{bpmDisplay} BPM · {keyDisplay}</span>
                    <span className="text-white/55">Audio</span>
                    <span className="truncate text-white/80">{formatDisplay} · {formatSampleRate(sample.sampleRate)} · {channelsDisplay}</span>
                    <span className="text-white/55">Added</span>
                    <span className="truncate text-white/80">{addedDisplay} · {sample.tags.length} instrument{sample.tags.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
              </div>

              {/* Info */}
              <div className={`px-2 py-1.5 overflow-visible ${duplicatePairMeta ? 'h-[92px] space-y-0.5' : 'h-[62px]'}`}>
                {duplicatePairMeta && duplicateRoleLabel && (
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium ${duplicateRoleClass}`}>
                        Pair {duplicatePairMeta.pairIndex} • {duplicateRoleLabel}
                      </span>
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            if (!duplicateCanKeepThis) return
                            onKeepDuplicateSample?.(sample.id)
                          }}
                          disabled={!duplicateCanKeepThis}
                          className={`inline-flex h-5 items-center justify-center whitespace-nowrap rounded border px-2 text-[10px] font-medium transition-colors ${
                            !duplicatePairMeta.canDeletePartner
                              ? 'border-surface-border text-slate-500 cursor-not-allowed'
                              : duplicateKeepThisSelected
                                ? 'border-emerald-500/45 bg-emerald-500/20 text-emerald-100'
                                : 'border-emerald-500/35 text-emerald-200 hover:bg-emerald-500/15'
                          }`}
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            if (!duplicateCanToggleDelete) return
                            onToggleDuplicateDeleteTarget?.(sample.id)
                          }}
                          disabled={!duplicateCanToggleDelete}
                          className={`inline-flex h-5 items-center justify-center whitespace-nowrap rounded border px-2 text-[10px] font-medium transition-colors ${
                            !duplicatePairMeta.canDelete
                              ? 'border-surface-border text-slate-500 cursor-not-allowed'
                              : duplicateDeleteThisSelected
                                ? 'border-red-500/40 bg-red-500/20 text-red-100 hover:bg-red-500/25'
                                : 'border-red-500/35 text-red-200 hover:bg-red-500/15'
                          }`}
                        >
                          {duplicatePairMeta.canDelete ? 'Delete' : 'Protected'}
                        </button>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {getDuplicateMatchLabel(duplicatePairMeta.matchType)} {duplicatePairMeta.similarityPercent}%
                    </div>
                  </div>
                )}
                {hasRenamePreview ? (
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-slate-500 truncate line-through" title={sample.name}>
                      {sample.name}
                    </p>
                    <p className="text-sm font-medium text-accent-primary truncate" title={renamePreview!.nextName}>
                      {renderHighlightedRenameText(renamePreview!.nextName, renamePreview!.highlightRanges)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm font-medium text-white truncate" title={sample.name}>
                    {sample.name}
                  </p>
                )}

                {/* Instruments preview */}
                {sample.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 items-center">
                    {sample.tags.slice(0, 2).map(tag => (
                      <span
                        key={tag.id}
                        onClick={(e) => {
                          if (onTagClick) {
                            e.stopPropagation()
                            onTagClick(tag.id)
                          }
                        }}
                        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                        style={{
                          backgroundColor: tag.color + '25',
                          color: tag.color,
                        }}
                        title={onTagClick ? `Filter by ${tag.name}` : tag.name}
                      >
                        {tag.name}
                      </span>
                    ))}
                    {sample.tags.length > 2 && (
                      <div
                        className="relative inline-block"
                        onMouseEnter={() => handleTagPopupOpen(sample.id)}
                        onMouseLeave={handleTagPopupClose}
                      >
                        <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] leading-none text-slate-500 cursor-default bg-surface-overlay/50">
                          +{sample.tags.length - 2}
                        </span>
                        {tagPopupId === sample.id && (
                          <div
                            className="absolute right-0 bottom-full mb-1 z-[60] bg-surface-raised border border-surface-border rounded-lg shadow-lg py-1 px-2 max-w-[200px] max-h-40 overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                            onMouseEnter={() => handleTagPopupEnter(sample.id)}
                            onMouseLeave={handleTagPopupClose}
                          >
                            <div className="flex flex-col gap-1">
                              {sample.tags.slice(2).map((tag) => (
                                <span
                                  key={tag.id}
                                  onClick={(e) => {
                                    if (onTagClick) {
                                      e.stopPropagation()
                                      onTagClick(tag.id)
                                      setTagPopupId(null)
                                      if (closeTimeoutRef.current) {
                                        clearTimeout(closeTimeoutRef.current)
                                        closeTimeoutRef.current = null
                                      }
                                    }
                                  }}
                                  className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                                  style={{
                                    backgroundColor: tag.color + '25',
                                    color: tag.color,
                                  }}
                                  title={onTagClick ? `Filter by ${tag.name}` : tag.name}
                                >
                                  {tag.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </FadeInOnMount>
        )
  }

  const gridClass = isDuplicatePairMode
    ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6 gap-[10px]'
    : 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-[10px]'

  return (
    <div ref={rootRef} data-tour="samples-card-view" className="relative isolate flex min-h-0 flex-col">
      {showSortControls && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-surface-border bg-surface-base/95 px-4 py-2 backdrop-blur-sm">
          {showSelectAllControl && onToggleSelect && onToggleSelectAll && (
            <>
              <CustomCheckbox
                checked={selectAllChecked}
                indeterminate={selectAllIndeterminate}
                onChange={onToggleSelectAll}
                className="flex-shrink-0"
                title="Select all samples"
              />
              <div className="w-px h-5 bg-surface-border" />
            </>
          )}
          <span className="text-sm text-slate-400">Sort by:</span>
          {QUICK_SORT_OPTIONS.map((option) => (
            <button
              key={option.field}
              onClick={() => handleSortClick(option.field)}
              disabled={isDuplicatePairMode}
              className={`flex items-center px-3 py-1.5 text-sm rounded transition-colors ${
                sortField === option.field
                  ? 'bg-accent-primary text-white'
                  : 'bg-surface-raised text-slate-300 hover:bg-surface-base'
              } ${isDuplicatePairMode ? 'opacity-50 cursor-not-allowed hover:bg-surface-raised' : ''}`}
            >
              {option.label}
              {getSortIcon(option.field)}
            </button>
          ))}
          <select
            value={activeMoreSortField}
            onChange={(e) => {
              const field = e.target.value as SortField
              if (!field) return
              handleMoreSortChange(field)
            }}
            className={`px-3 py-1.5 text-sm rounded border border-surface-border bg-surface-raised text-slate-300 focus:outline-none focus:border-accent-primary ${isDuplicatePairMode ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="More sorting metrics"
            disabled={isDuplicatePairMode}
          >
            <option value="">More metrics...</option>
            {MORE_SORT_OPTIONS.map((option) => (
              <option key={option.field} value={option.field}>
                {option.label}
              </option>
            ))}
          </select>
          {sortField && (
            <button
              onClick={toggleSortOrder}
              className={`flex items-center justify-center px-2.5 py-1.5 text-sm rounded bg-surface-raised text-slate-300 hover:bg-surface-base transition-colors ${isDuplicatePairMode ? 'opacity-50 cursor-not-allowed hover:bg-surface-raised' : ''}`}
              title={sortOrder === 'asc' ? 'Ascending sort' : 'Descending sort'}
              disabled={isDuplicatePairMode}
            >
              {sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            </button>
          )}
          {isDuplicatePairMode && (
            <span className="text-[11px] text-slate-500 ml-auto">
              Pair mode keeps duplicate matches together.
            </span>
          )}
        </div>
      )}

      {/* Grid - grouped or flat */}
      {sortedScaleDegreeGroups ? (
        <div className="px-4 pt-2.5 pb-3">
          {sortedScaleDegreeGroups.map(([degree, groupSamples]) => (
            <div key={degree} className="mb-3">
              <h3 className="text-sm font-semibold text-slate-300 mb-2 px-1 border-l-2 border-accent-primary pl-2">
                {degree}
                <span className="text-xs text-slate-500 ml-2">({groupSamples.length})</span>
              </h3>
              {(() => {
                const groupVirtualWindow = getVirtualWindow(groupSamples.length, groupedGridRefs.current[degree] ?? null)
                const visibleGroupSamples = groupSamples.slice(groupVirtualWindow.startIndex, groupVirtualWindow.endIndex)

                return (
                  <div
                    ref={(el) => { groupedGridRefs.current[degree] = el }}
                    className={gridClass}
                  >
                    {groupVirtualWindow.topSpacer > 0 && (
                      <div
                        aria-hidden="true"
                        style={{ height: `${groupVirtualWindow.topSpacer}px`, gridColumn: '1 / -1' }}
                      />
                    )}
                    {visibleGroupSamples.map(sample => renderSampleCard(sample))}
                    {groupVirtualWindow.bottomSpacer > 0 && (
                      <div
                        aria-hidden="true"
                        style={{ height: `${groupVirtualWindow.bottomSpacer}px`, gridColumn: '1 / -1' }}
                      />
                    )}
                  </div>
                )
              })()}
            </div>
          ))}
        </div>
      ) : (
        <div ref={flatGridContainerRef} className="px-4 pt-3 pb-3">
          {flatVirtualWindow.topSpacer > 0 && (
            <div aria-hidden="true" style={{ height: `${flatVirtualWindow.topSpacer}px` }} />
          )}
          <div className={gridClass}>
            {visibleFlatSamples.map(sample => renderSampleCard(sample))}
          </div>
          {flatVirtualWindow.bottomSpacer > 0 && (
            <div aria-hidden="true" style={{ height: `${flatVirtualWindow.bottomSpacer}px` }} />
          )}
        </div>
      )}

      {/* Drum Rack Pad Picker */}
      {padPickerSample && (
        <DrumRackPadPicker
          sample={padPickerSample}
          onClose={() => setPadPickerSample(null)}
        />
      )}
    </div>
  )
}
