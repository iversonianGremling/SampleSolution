import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, ChevronRight, Loader2, Scissors, Trash2 } from 'lucide-react'
import {
  SourcesSampleListRow,
  DEFAULT_SOURCES_LIST_COLUMN_WIDTHS,
  DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY,
  type SourcesListColumnVisibility,
} from './SourcesSampleListRow'
import { CustomCheckbox } from './CustomCheckbox'
import { createDragPreview } from './DragPreview'
import type { SliceWithTrackExtended, SourceTree } from '../types'
import { createManagedAudio, releaseManagedAudio } from '../services/globalAudioVolume'
import { prepareSamplePreviewPlayback } from '../services/samplePreviewPlayback'
import type { TunePlaybackMode } from '../utils/tunePlaybackMode'

export type PlayMode = 'normal' | 'one-shot' | 'reproduce-while-clicking'

interface VideoGroup {
  trackId: number
  trackTitle: string
  youtubeId: string
  thumbnailUrl?: string
  slices: SliceWithTrackExtended[]
  sliceCount: number
}

interface SourcesYouTubeGroupedListProps {
  samples: SliceWithTrackExtended[]
  selectedYouTubeTrackId?: number | null
  selectedId: number | null
  selectedIds: Set<number>
  onSelect: (id: number) => void
  onToggleSelect: (id: number) => void
  onToggleSelectAll: () => void
  onToggleFavorite: (id: number) => void
  onUpdateName: (id: number, name: string) => void
  onDelete: (id: number) => void
  onEditTrack?: (trackId: number) => void
  onTagClick?: (tagId: number) => void
  isLoading?: boolean
  playMode?: PlayMode
  loopEnabled: boolean
  tuneTargetNote?: string | null
  tunePlaybackMode?: TunePlaybackMode
  sourceTree?: SourceTree | undefined
  onDeleteSource?: (scope: string, label: string) => void
}

const DEFAULT_LIST_ROW_HEIGHT_PX = 46
const LIST_ROW_OVERSCAN = 4
const MIN_RENDERED_LIST_ROWS = 20
const MIN_VIRTUALIZED_ROW_HEIGHT_PX = Math.max(22, Math.floor(DEFAULT_LIST_ROW_HEIGHT_PX * 0.5))
const MAX_VIRTUALIZED_ROW_HEIGHT_PX = DEFAULT_LIST_ROW_HEIGHT_PX * 3
const COLUMN_VISIBILITY_STORAGE_KEY = 'sources-list-column-visibility-v1'
const CONTROLS_COLUMN_WIDTH = Math.max(72, DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.actions)
const OPTIONAL_COLUMN_KEYS: Array<keyof SourcesListColumnVisibility> = [
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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function getRowMinWidth(columnVisibility: SourcesListColumnVisibility): number {
  let width = 0

  width += 24 // checkbox
  width += CONTROLS_COLUMN_WIDTH
  width += 16 // instrument icon
  width += DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.name
  width += DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.duration

  for (const key of OPTIONAL_COLUMN_KEYS) {
    if (!columnVisibility[key]) continue
    width += DEFAULT_SOURCES_LIST_COLUMN_WIDTHS[key]
  }

  // Includes row padding and inter-column gaps.
  width += 220

  return width
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
      envelope: parsed.envelope ?? DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY.envelope,
      loudness: parsed.loudness ?? DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY.loudness,
    }
  } catch {
    return DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY
  }
}

export function SourcesYouTubeGroupedList({
  samples,
  selectedYouTubeTrackId = null,
  selectedId,
  selectedIds,
  onSelect,
  onToggleSelect,
  onToggleSelectAll,
  onToggleFavorite,
  onUpdateName,
  onDelete,
  onEditTrack,
  onTagClick,
  isLoading = false,
  playMode = 'normal',
  loopEnabled,
  tuneTargetNote = null,
  tunePlaybackMode: _tunePlaybackMode = 'tape',
  sourceTree,
  onDeleteSource,
}: SourcesYouTubeGroupedListProps) {
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const columnHeaderRef = useRef<HTMLDivElement | null>(null)
  const groupedRowsRef = useRef<Record<number, HTMLDivElement | null>>({})
  const dragPreviewRef = useRef<HTMLElement | null>(null)
  const [expandedVideos, setExpandedVideos] = useState<Set<number>>(new Set())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(null)
  const [columnHeaderHeight, setColumnHeaderHeight] = useState(0)
  const [columnVisibility] = useState<SourcesListColumnVisibility>(loadColumnVisibility)
  const rowMinWidth = useMemo(
    () => getRowMinWidth(columnVisibility),
    [columnVisibility],
  )

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
    }
  }, [])

  const scopedSamples =
    selectedYouTubeTrackId === null
      ? samples
      : samples.filter((sample) => sample.trackId === selectedYouTubeTrackId)

  // Group samples by video - use sourceTree if available to show all videos
  const videoGroups: VideoGroup[] = (() => {
    if (sourceTree?.youtube) {
      const scopedVideos =
        selectedYouTubeTrackId === null
          ? sourceTree.youtube
          : sourceTree.youtube.filter((video) => video.id === selectedYouTubeTrackId)

      // Create groups from source tree to include videos with 0 samples
      const samplesByTrack = scopedSamples.reduce((acc, sample) => {
        if (!acc[sample.trackId]) {
          acc[sample.trackId] = []
        }
        acc[sample.trackId].push(sample)
        return acc
      }, {} as Record<number, SliceWithTrackExtended[]>)

      return scopedVideos.map(video => {
        const videoSamples = samplesByTrack[video.id] || []
        // Try to get track info from first sample if available
        const firstSample = videoSamples[0]
        return {
          trackId: video.id,
          trackTitle: video.title,
          youtubeId: firstSample?.track.youtubeId || '',
          thumbnailUrl: video.thumbnailUrl,
          slices: videoSamples,
          sliceCount: video.sliceCount,
        }
      })
    }

    // Fallback to old behavior if sourceTree is not available
    return Object.values(
      scopedSamples.reduce((acc, sample) => {
        const trackId = sample.trackId
        if (!acc[trackId]) {
          acc[trackId] = {
            trackId,
            trackTitle: sample.track.title,
            youtubeId: sample.track.youtubeId,
            thumbnailUrl: `https://i.ytimg.com/vi/${sample.track.youtubeId}/mqdefault.jpg`,
            slices: [],
            sliceCount: 0,
          }
        }
        acc[trackId].slices.push(sample)
        acc[trackId].sliceCount = acc[trackId].slices.length
        return acc
      }, {} as Record<number, VideoGroup>)
    )
  })()

  // Auto-expand all videos on mount
  useEffect(() => {
    setExpandedVideos(new Set(videoGroups.map(v => v.trackId)))
  }, [])

  useEffect(() => {
    const listBody = listBodyRef.current
    if (!listBody) return

    let rafId: number | null = null
    let resizeObserver: ResizeObserver | null = null

    const readScrollMetrics = () => {
      setScrollTop(listBody.scrollTop)
      setViewportHeight(listBody.clientHeight)
    }

    const scheduleMetricsRead = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        readScrollMetrics()
      })
    }

    readScrollMetrics()
    listBody.addEventListener('scroll', scheduleMetricsRead, { passive: true })

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', scheduleMetricsRead)
    } else {
      resizeObserver = new ResizeObserver(scheduleMetricsRead)
      resizeObserver.observe(listBody)
    }

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
      listBody.removeEventListener('scroll', scheduleMetricsRead)
      window.removeEventListener('resize', scheduleMetricsRead)
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
    }
  }, [isLoading, videoGroups.length])

  useEffect(() => {
    const listBody = listBodyRef.current
    if (!listBody) return

    let frameId: number | null = null
    frameId = window.requestAnimationFrame(() => {
      setScrollTop(listBody.scrollTop)
      setViewportHeight(listBody.clientHeight)
    })

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [samples, expandedVideos])

  useEffect(() => {
    // Group expand/collapse changes layout; force a fresh row-height measurement.
    setMeasuredRowHeight(null)
  }, [expandedVideos, samples.length])

  useEffect(() => {
    const headerNode = columnHeaderRef.current
    if (!headerNode) return

    let frameId: number | null = null
    let resizeObserver: ResizeObserver | null = null

    const measureHeader = () => {
      const height = Math.round(headerNode.getBoundingClientRect().height)
      setColumnHeaderHeight((current) => (current === height ? current : height))
    }

    measureHeader()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureHeader)
      return () => {
        window.removeEventListener('resize', measureHeader)
      }
    }

    resizeObserver = new ResizeObserver(() => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        measureHeader()
      })
    })
    resizeObserver.observe(headerNode)

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
    }
  }, [])

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
      // One-shot mode: always play the whole sample, stop others
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

  const handleDragStart = (sample: SliceWithTrackExtended) => (e: React.DragEvent) => {
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
    // Clean up preview element
    if (dragPreviewRef.current && dragPreviewRef.current.parentNode) {
      document.body.removeChild(dragPreviewRef.current)
      dragPreviewRef.current = null
    }
  }

  const toggleVideoExpanded = (trackId: number) => {
    setExpandedVideos(prev => {
      const next = new Set(prev)
      if (next.has(trackId)) {
        next.delete(trackId)
      } else {
        next.add(trackId)
      }
      return next
    })
  }

  // Determine if select-all checkbox should be indeterminate
  const selectAllIndeterminate = selectedIds.size > 0 && selectedIds.size < samples.length
  const selectAllChecked = selectedIds.size === samples.length && samples.length > 0
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

  const getVirtualWindow = (itemCount: number, groupNode: HTMLDivElement | null) => {
    if (itemCount === 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }

    const buildRowWindow = (targetRow: number) => {
      const maxStartRow = Math.max(0, itemCount - renderedRowBudget)
      const startRow = clamp(targetRow, 0, maxStartRow)
      const endRowExclusive = Math.min(itemCount, startRow + renderedRowBudget)
      return {
        startIndex: startRow,
        endIndex: endRowExclusive,
        topSpacer: startRow * rowHeight,
        bottomSpacer: Math.max(0, itemCount - endRowExclusive) * rowHeight,
      }
    }

    if (!groupNode || viewportHeight <= 0 || rowHeight <= 0) {
      // Avoid blank regions while viewport metrics are unavailable.
      return {
        startIndex: 0,
        endIndex: itemCount,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }

    const groupOffsetTop = groupNode.offsetTop
    const visibleTop = scrollTop - groupOffsetTop
    const visibleBottom = visibleTop + viewportHeight

    const rawStartRow = Math.floor(visibleTop / rowHeight) - LIST_ROW_OVERSCAN
    const rawEndRowExclusive = Math.ceil(visibleBottom / rowHeight) + LIST_ROW_OVERSCAN

    if (rawEndRowExclusive <= 0) {
      return buildRowWindow(0)
    }

    if (rawStartRow >= itemCount) {
      return buildRowWindow(itemCount - renderedRowBudget)
    }

    const startRow = clamp(rawStartRow, 0, itemCount)
    const endRowExclusive = clamp(rawEndRowExclusive, 0, itemCount)
    if (startRow >= endRowExclusive) {
      return buildRowWindow(startRow)
    }

    return buildRowWindow(startRow)
  }

  useEffect(() => {
    let frameId: number | null = null
    frameId = window.requestAnimationFrame(() => {
      const listBody = listBodyRef.current
      if (!listBody) return
      const rows = Array.from(
        listBody.querySelectorAll<HTMLElement>('[data-sources-list-row="true"]')
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
  }, [scrollTop, viewportHeight, expandedVideos, samples.length])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} />
        Loading samples...
      </div>
    )
  }

  if (samples.length === 0 && videoGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <p className="text-lg">No samples found</p>
        <p className="text-sm mt-1">Try adjusting your filters or selecting a different source</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col h-full overflow-hidden">
      {/* Header row */}
      <div className="sticky top-0 bg-surface-raised border-b border-surface-border px-4 py-2 flex-shrink-0 z-10">
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Select all checkbox */}
          <CustomCheckbox
            checked={selectAllChecked}
            indeterminate={selectAllIndeterminate}
            onChange={onToggleSelectAll}
            className="flex-shrink-0"
            title="Select all samples"
          />

          {/* Info */}
          <span className="text-sm text-slate-400">
            {videoGroups.length} video{videoGroups.length !== 1 ? 's' : ''}{samples.length > 0 && `, ${samples.length} slice${samples.length !== 1 ? 's' : ''}`}
          </span>
          <div className="flex-1" />
          {onDeleteSource && (
            <button
              onClick={() => onDeleteSource('youtube', 'all YouTube sources')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
              title="Delete all YouTube sources"
            >
              <Trash2 size={14} />
              <span className="text-xs sm:text-sm">Delete All</span>
            </button>
          )}
        </div>
      </div>

      {/* List items grouped by video */}
      <div ref={listBodyRef} className="flex-1 min-h-0 overflow-y-auto">
        <div
          ref={columnHeaderRef}
          className="sticky top-0 z-[5] border-b border-surface-border bg-surface-raised"
          style={{
            width: 'max-content',
            minWidth: rowMinWidth,
          }}
        >
          <div
            className="px-3 py-1.5"
            style={{
              width: 'max-content',
              minWidth: rowMinWidth,
            }}
          >
            <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] uppercase tracking-wide text-slate-500">
              <div className="w-5 flex-shrink-0" aria-hidden />
              <div className="flex-shrink-0 text-center" style={{ width: CONTROLS_COLUMN_WIDTH }}>Controls</div>
              <div className="w-4 flex-shrink-0 text-center">Inst</div>
              <div className="flex-shrink-0 min-w-0 pl-1" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.name }}>Name</div>

              {columnVisibility.tags && (
                <div className="flex-shrink-0 pl-1" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.tags }}>Instruments</div>
              )}
              {columnVisibility.artist && (
                <div className="flex-shrink-0 min-w-0" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.artist }}>Artist</div>
              )}
              {columnVisibility.album && (
                <div className="flex-shrink-0 min-w-0" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.album }}>Album</div>
              )}
              {columnVisibility.year && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.year }}>Year</div>
              )}
              {columnVisibility.albumArtist && (
                <div className="flex-shrink-0 min-w-0" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.albumArtist }}>Alb Artist</div>
              )}
              {columnVisibility.genre && (
                <div className="flex-shrink-0 min-w-0" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.genre }}>Genre</div>
              )}
              {columnVisibility.trackNumber && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.trackNumber }}>Trk</div>
              )}
              {columnVisibility.discNumber && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.discNumber }}>Disc</div>
              )}
              {columnVisibility.tagBpm && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.tagBpm }}>Det BPM</div>
              )}
              {columnVisibility.musicalKey && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.musicalKey }}>Det Key</div>
              )}
              {columnVisibility.isrc && (
                <div className="flex-shrink-0 min-w-0" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.isrc }}>ISRC</div>
              )}
              {columnVisibility.bpm && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.bpm }}>BPM</div>
              )}
              {columnVisibility.key && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.key }}>Fund</div>
              )}
              {columnVisibility.scale && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.scale }}>Scale</div>
              )}
              {columnVisibility.envelope && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.envelope }}>Env</div>
              )}
              {columnVisibility.brightness && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.brightness }}>Bright</div>
              )}
              {columnVisibility.noisiness && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.noisiness }}>Noisy</div>
              )}
              {columnVisibility.warmth && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.warmth }}>Warmth</div>
              )}
              {columnVisibility.hardness && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.hardness }}>Hard</div>
              )}
              {columnVisibility.sharpness && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.sharpness }}>Sharp</div>
              )}
              {columnVisibility.loudness && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.loudness }}>Loud</div>
              )}
              {columnVisibility.sampleRate && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.sampleRate }}>SR</div>
              )}
              {columnVisibility.channels && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.channels }}>Ch</div>
              )}
              {columnVisibility.format && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.format }}>Fmt</div>
              )}
              {columnVisibility.polyphony && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.polyphony }}>Poly</div>
              )}
              {columnVisibility.dateAdded && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.dateAdded }}>Added</div>
              )}
              {columnVisibility.dateCreated && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.dateCreated }}>Created</div>
              )}
              {columnVisibility.dateModified && (
                <div className="flex-shrink-0 text-center" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.dateModified }}>Mod</div>
              )}
              {columnVisibility.path && (
                <div className="flex-shrink-0 min-w-0" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.path }}>Path</div>
              )}
              <div className="flex-shrink-0 text-right" style={{ width: DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.duration }}>Duration</div>
            </div>
          </div>
        </div>

        {videoGroups.map(group => {
          const isExpanded = expandedVideos.has(group.trackId)
          const groupVirtualWindow = isExpanded
            ? getVirtualWindow(group.slices.length, groupedRowsRef.current[group.trackId] ?? null)
            : null
          const visibleSlices = groupVirtualWindow
            ? group.slices.slice(groupVirtualWindow.startIndex, groupVirtualWindow.endIndex)
            : []

          // Calculate selection state for this video's slices
          const videoSliceIds = group.slices.map(s => s.id)
          const selectedInVideo = videoSliceIds.filter(id => selectedIds.has(id)).length
          const allVideoSlicesSelected = selectedInVideo === videoSliceIds.length && videoSliceIds.length > 0
          const someVideoSlicesSelected = selectedInVideo > 0 && selectedInVideo < videoSliceIds.length

          const toggleVideoSelection = () => {
            if (allVideoSlicesSelected) {
              // Deselect all slices from this video
              videoSliceIds.forEach(id => {
                if (selectedIds.has(id)) {
                  onToggleSelect(id)
                }
              })
            } else {
              // Select all slices from this video
              videoSliceIds.forEach(id => {
                if (!selectedIds.has(id)) {
                  onToggleSelect(id)
                }
              })
            }
          }

          const handleVideoCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            e.stopPropagation()
            toggleVideoSelection()
          }

          return (
            <div
              key={group.trackId}
              className="relative border-b border-surface-border"
              style={{
                width: 'max-content',
                minWidth: rowMinWidth,
              }}
            >
              {/* Video header */}
              <div
                className="sticky z-20 flex items-center gap-3 border-b border-surface-border bg-surface-raised p-3 transition-colors hover:bg-surface-base"
                style={{ top: columnHeaderHeight > 0 ? columnHeaderHeight : 32 }}
              >
                <button
                  onClick={() => group.sliceCount > 0 && toggleVideoExpanded(group.trackId)}
                  className="flex items-center gap-3 flex-1"
                  disabled={group.sliceCount === 0}
                >
                  {group.sliceCount > 0 ? (
                    isExpanded ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />
                  ) : (
                    <div className="w-[18px]" />
                  )}

                  {/* YouTube thumbnail */}
                  {group.thumbnailUrl && (
                    <img
                      src={group.thumbnailUrl}
                      alt={group.trackTitle}
                      className="w-24 h-14 object-cover rounded"
                    />
                  )}

                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-white truncate">{group.trackTitle}</p>
                    <p className={`text-xs mt-0.5 ${group.sliceCount === 0 ? 'text-slate-500' : 'text-slate-400'}`}>
                      {group.sliceCount} slice{group.sliceCount !== 1 ? 's' : ''}
                      {group.sliceCount === 0 && <span className="ml-1 text-slate-500">(no samples yet)</span>}
                    </p>
                  </div>
                </button>

                {/* Open sample cut editor for this video */}
                {onEditTrack && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditTrack(group.trackId)
                    }}
                    className="p-1.5 flex-shrink-0 text-slate-400 hover:text-white hover:bg-surface-overlay rounded transition-colors"
                    title="Open sample cut view"
                  >
                    <Scissors size={16} />
                  </button>
                )}

                {/* Select all checkbox for this video */}
                {group.sliceCount > 0 && (
                  <CustomCheckbox
                    checked={allVideoSlicesSelected}
                    indeterminate={someVideoSlicesSelected}
                    onChange={handleVideoCheckboxChange}
                    title={`Select all slices from ${group.trackTitle}`}
                  />
                )}
              </div>

              {/* Slices list */}
              {isExpanded && (
                <div
                  ref={(el) => { groupedRowsRef.current[group.trackId] = el }}
                  className="bg-surface-base"
                  style={{ minWidth: rowMinWidth }}
                >
                  {groupVirtualWindow && groupVirtualWindow.topSpacer > 0 && (
                    <div aria-hidden="true" style={{ height: `${groupVirtualWindow.topSpacer}px` }} />
                  )}

                  <div className="divide-y divide-surface-border">
                    {visibleSlices.map((sample) => (
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
                      />
                    ))}
                  </div>

                  {groupVirtualWindow && groupVirtualWindow.bottomSpacer > 0 && (
                    <div aria-hidden="true" style={{ height: `${groupVirtualWindow.bottomSpacer}px` }} />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
