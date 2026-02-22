import { useState, useRef, useEffect, useMemo, type ReactNode } from 'react'
import { Play, Pause, Heart, ChevronDown, ChevronRight, GripVertical, Scissors, Trash2 } from 'lucide-react'
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

interface SourcesYouTubeGroupedGridProps {
  samples: SliceWithTrackExtended[]
  selectedId: number | null
  selectedIds?: Set<number>
  onSelect: (id: number) => void
  onToggleSelect?: (id: number) => void
  onToggleSelectAll?: () => void
  onToggleFavorite?: (id: number) => void
  onEditTrack?: (trackId: number) => void
  onTagClick?: (tagId: number) => void
  isLoading?: boolean
  playMode?: PlayMode
  loopEnabled?: boolean
  tuneTargetNote?: string | null
  tunePlaybackMode?: TunePlaybackMode
  sourceTree?: SourceTree | undefined
  onDeleteSource?: (scope: string, label: string) => void
}

const GRID_GAP_PX = 8
const GRID_HORIZONTAL_PADDING_PX = 32
const CARD_ASPECT_RATIO = 3 / 4
const CARD_META_HEIGHT_PX = 50
const ROW_OVERSCAN = 1
const MAX_RENDERED_ROWS = 5
const YOUTUBE_SLICE_CARD_SELECTOR = '[data-youtube-slice-card="true"]'

const getResponsiveColumnCount = (width: number) => {
  if (width >= 1536) return 7
  if (width >= 1280) return 6
  if (width >= 1024) return 5
  if (width >= 768) return 4
  if (width >= 640) return 3
  return 2
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

function FadeInOnMount({ children }: { children: ReactNode }) {
  return (
    <div className="animate-fade-in motion-reduce:animate-none">
      {children}
    </div>
  )
}

export function SourcesYouTubeGroupedGrid({
  samples,
  selectedId,
  selectedIds = new Set(),
  onSelect,
  onToggleSelect,
  onToggleSelectAll,
  onToggleFavorite,
  onEditTrack,
  onTagClick,
  isLoading = false,
  playMode = 'normal',
  loopEnabled = false,
  tuneTargetNote = null,
  tunePlaybackMode: _tunePlaybackMode = 'tape',
  sourceTree,
  onDeleteSource,
}: SourcesYouTubeGroupedGridProps) {
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollParentRef = useRef<HTMLElement | null>(null)
  const groupGridRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const dragPreviewRef = useRef<HTMLElement | null>(null)
  const [expandedVideos, setExpandedVideos] = useState<Set<number>>(new Set())
  const [tagPopupId, setTagPopupId] = useState<number | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 0))
  const [gridWidth, setGridWidth] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [useWindowScroll, setUseWindowScroll] = useState(false)
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(null)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const updateGridWidth = () => {
      setGridWidth(root.clientWidth)
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
  }, [])

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
  }, [samples, expandedVideos])

  // Group samples by video - use sourceTree if available to show all videos
  const videoGroups: VideoGroup[] = (() => {
    if (sourceTree?.youtube) {
      // Create groups from source tree to include videos with 0 samples
      const samplesByTrack = samples.reduce((acc, sample) => {
        if (!acc[sample.trackId]) {
          acc[sample.trackId] = []
        }
        acc[sample.trackId].push(sample)
        return acc
      }, {} as Record<number, SliceWithTrackExtended[]>)

      return sourceTree.youtube.map(video => {
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
      samples.reduce((acc, sample) => {
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

  const columnCount = useMemo(() => getResponsiveColumnCount(viewportWidth), [viewportWidth])

  const estimatedRowHeight = useMemo(() => {
    const usableWidth = Math.max(
      0,
      gridWidth - GRID_HORIZONTAL_PADDING_PX - GRID_GAP_PX * Math.max(0, columnCount - 1),
    )
    const cardWidth = columnCount > 0 ? usableWidth / columnCount : usableWidth
    return cardWidth * CARD_ASPECT_RATIO + CARD_META_HEIGHT_PX + GRID_GAP_PX
  }, [gridWidth, columnCount])

  const rowHeight = measuredRowHeight ?? estimatedRowHeight

  const getVirtualWindow = (itemCount: number, gridNode: HTMLElement | null) => {
    const safeColumnCount = Math.max(1, columnCount)
    const totalRows = Math.ceil(itemCount / safeColumnCount)
    const buildRowWindow = (targetRow: number) => {
      const maxStartRow = Math.max(0, totalRows - MAX_RENDERED_ROWS)
      const startRow = clamp(targetRow, 0, maxStartRow)
      const endRowExclusive = Math.min(totalRows, startRow + MAX_RENDERED_ROWS)
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
        endIndex: 0,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }

    if (!gridNode || viewportHeight <= 0 || rowHeight <= 0) {
      const fallbackEndIndex = Math.min(itemCount, safeColumnCount * MAX_RENDERED_ROWS)
      const fallbackRenderedRows = Math.ceil(fallbackEndIndex / safeColumnCount)
      return {
        startIndex: 0,
        endIndex: fallbackEndIndex,
        topSpacer: 0,
        bottomSpacer: rowHeight > 0 ? Math.max(0, totalRows - fallbackRenderedRows) * rowHeight : 0,
      }
    }

    const scrollParent = scrollParentRef.current
    const gridOffsetTop = useWindowScroll
      ? gridNode.getBoundingClientRect().top + (window.scrollY || document.documentElement.scrollTop || 0)
      : scrollParent
      ? getOffsetTopWithinParent(gridNode, scrollParent)
      : gridNode.offsetTop
    const visibleTop = scrollTop - gridOffsetTop
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
        return buildRowWindow(totalRows - MAX_RENDERED_ROWS)
      }

      return buildRowWindow(startRow)
    }

    const cappedEndRowExclusive = Math.min(endRowExclusive, startRow + MAX_RENDERED_ROWS)
    const startIndex = Math.min(itemCount, startRow * safeColumnCount)
    const endIndex = Math.min(itemCount, cappedEndRowExclusive * safeColumnCount)
    const renderedRows = Math.max(0, cappedEndRowExclusive - startRow)

    if (endIndex <= startIndex) {
      return buildRowWindow(startRow)
    }

    return {
      startIndex,
      endIndex,
      topSpacer: startRow * rowHeight,
      bottomSpacer: Math.max(0, totalRows - startRow - renderedRows) * rowHeight,
    }
  }

  const formatDuration = (startTime: number, endTime: number) => {
    const duration = endTime - startTime
    if (duration < 60) {
      return `${duration.toFixed(1)}s`
    }
    const mins = Math.floor(duration / 60)
    const secs = Math.floor(duration % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

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

  useEffect(() => {
    // Layout changes invalidate any previously measured row height.
    setMeasuredRowHeight(null)
  }, [columnCount, gridWidth, expandedVideos])

  useEffect(() => {
    let frameId: number | null = null
    frameId = window.requestAnimationFrame(() => {
      const root = rootRef.current
      if (!root) return
      const cards = Array.from(root.querySelectorAll<HTMLElement>(YOUTUBE_SLICE_CARD_SELECTOR))
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
  }, [columnCount, gridWidth, scrollTop, samples.length, expandedVideos])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
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

  // Determine if select-all checkbox should be indeterminate
  const selectAllIndeterminate = selectedIds.size > 0 && selectedIds.size < samples.length
  const selectAllChecked = selectedIds.size === samples.length && samples.length > 0

  return (
    <div ref={rootRef} className="relative isolate flex min-h-0 flex-col">
      {/* Controls */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-surface-border bg-surface-base/95 px-4 py-2 backdrop-blur-sm">
        {onToggleSelect && onToggleSelectAll && (
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
        <span className="min-w-0 flex-1 truncate text-sm text-slate-400">
          {videoGroups.length} video{videoGroups.length !== 1 ? 's' : ''}{samples.length > 0 && `, ${samples.length} slice${samples.length !== 1 ? 's' : ''}`}
        </span>
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

      {/* Video groups */}
      <div className="space-y-4 p-4">
        {videoGroups.map(group => {
          const isExpanded = expandedVideos.has(group.trackId)

          // Calculate selection state for this video's slices
          const videoSliceIds = group.slices.map(s => s.id)
          const selectedInVideo = videoSliceIds.filter(id => selectedIds.has(id)).length
          const allVideoSlicesSelected = selectedInVideo === videoSliceIds.length && videoSliceIds.length > 0
          const someVideoSlicesSelected = selectedInVideo > 0 && selectedInVideo < videoSliceIds.length

          const toggleVideoSelection = () => {
            if (!onToggleSelect) return
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
            <div key={group.trackId} className="bg-surface-raised rounded-lg overflow-visible">
              {/* Video header */}
              <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 hover:bg-surface-base transition-colors">
                <button
                  onClick={() => {
                    if (group.sliceCount > 0) {
                      toggleVideoExpanded(group.trackId)
                    } else if (onEditTrack) {
                      onEditTrack(group.trackId)
                    }
                  }}
                  className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0"
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
                      className="w-16 h-10 sm:w-24 sm:h-14 object-cover rounded flex-shrink-0"
                    />
                  )}

                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-xs sm:text-sm font-medium text-white truncate">{group.trackTitle}</p>
                    <p className={`text-[10px] sm:text-xs mt-0.5 truncate ${group.sliceCount === 0 ? 'text-slate-500' : 'text-slate-400'}`}>
                      {group.sliceCount} slice{group.sliceCount !== 1 ? 's' : ''}
                      {group.sliceCount === 0 && onEditTrack && <span className="ml-1 text-slate-500">(click to cut)</span>}
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
                    className="p-1.5 sm:p-2 flex-shrink-0 text-slate-400 hover:text-white hover:bg-surface-base rounded transition-colors"
                    title="Open sample cut view"
                  >
                    <Scissors size={16} />
                  </button>
                )}

                {/* Select all checkbox for this video */}
                {onToggleSelect && (
                  <CustomCheckbox
                    checked={allVideoSlicesSelected}
                    indeterminate={someVideoSlicesSelected}
                    onChange={handleVideoCheckboxChange}
                    className="flex-shrink-0"
                    title={`Select all slices from ${group.trackTitle}`}
                  />
                )}
              </div>

              {/* Slices grid */}
              {isExpanded && (() => {
                const groupVirtualWindow = getVirtualWindow(group.slices.length, groupGridRefs.current[group.trackId] ?? null)
                const visibleSlices = group.slices.slice(groupVirtualWindow.startIndex, groupVirtualWindow.endIndex)

                return (
                  <div
                    ref={(el) => { groupGridRefs.current[group.trackId] = el }}
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2 p-3 pt-0"
                  >
                    {groupVirtualWindow.topSpacer > 0 && (
                      <div
                        aria-hidden="true"
                        style={{ height: `${groupVirtualWindow.topSpacer}px`, gridColumn: '1 / -1' }}
                      />
                    )}
                    {visibleSlices.map(sample => {
                    const isSelected = selectedId === sample.id
                    const isChecked = selectedIds.has(sample.id)
                    const isPlaying = playingId === sample.id
                    const isDragging = draggedId === sample.id
                    const isTagPopupOpen = tagPopupId === sample.id

                    return (
                      <FadeInOnMount key={sample.id}>
                        <div
                          data-youtube-slice-card="true"
                          onClick={() => onSelect(sample.id)}
                          draggable
                          onDragStart={(e) => handleDragStart(e, sample)}
                          onDragEnd={handleDragEnd}
                          className={`group relative ${isTagPopupOpen ? 'z-[70]' : 'z-0 hover:z-10'} bg-surface-base rounded-lg overflow-visible cursor-pointer transition-all ${
                            isSelected
                              ? 'ring-2 ring-accent-primary shadow-lg shadow-accent-primary/20'
                              : isChecked
                              ? 'ring-2 ring-indigo-400/60 shadow-md shadow-indigo-400/10'
                              : 'hover:bg-surface-raised hover:shadow-md'
                          } ${isDragging ? 'opacity-50' : ''}`}
                        >
                          {/* YouTube thumbnail as background */}
                          <div className="aspect-[4/3] relative flex items-center justify-center overflow-hidden rounded-t-lg bg-gradient-to-br from-slate-700/60 via-slate-800/70 to-slate-950/90">
                            {group.thumbnailUrl && (
                              <img
                                src={group.thumbnailUrl}
                                alt=""
                                className="absolute inset-0 w-full h-full object-cover opacity-55"
                              />
                            )}

                            {/* Overlay gradient */}
                            <div className="absolute inset-0 bg-gradient-to-t from-surface-base/35 via-surface-base/12 to-transparent" />

                            {/* Play button overlay */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                if (playMode !== 'reproduce-while-clicking') {
                                  handlePlay(sample.id, e)
                                }
                              }}
                              onMouseDown={playMode === 'reproduce-while-clicking' ? (e) => handleMouseDown(sample.id, e) : undefined}
                              onMouseUp={playMode === 'reproduce-while-clicking' ? handleMouseUp : undefined}
                              onMouseLeave={playMode === 'reproduce-while-clicking' ? handleMouseUp : undefined}
                              className={`relative z-10 transition-opacity ${
                                isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                              }`}
                            >
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                                isPlaying ? 'bg-accent-primary' : 'bg-surface-base/60 hover:bg-surface-base/80'
                              }`}>
                                {isPlaying && playMode === 'normal' ? (
                                  <Pause size={14} className="text-white" />
                                ) : (
                                  <Play size={14} className="text-white ml-0.5" />
                                )}
                              </div>
                            </button>

                          {/* Checkbox for selection */}
                          {onToggleSelect && (
                            <div
                              className={`absolute top-1 left-1 transition-opacity z-10 ${
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

                          {/* Favorite button */}
                          {onToggleFavorite && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onToggleFavorite(sample.id)
                              }}
                              className={`absolute top-1 right-1 p-1 rounded transition-all z-10 ${
                                sample.favorite
                                  ? 'text-amber-400 bg-amber-400/20'
                                  : 'text-slate-400 opacity-0 group-hover:opacity-100 hover:text-amber-400 hover:bg-amber-400/20'
                              }`}
                            >
                              <Heart size={12} className={sample.favorite ? 'fill-current' : ''} />
                            </button>
                          )}

                          {/* Drag handle */}
                          {!onToggleSelect && (
                            <div className="absolute top-1 left-1 p-1 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab z-10">
                              <GripVertical size={12} />
                            </div>
                          )}

                          {/* Duration badge */}
                          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 text-[10px] font-medium bg-surface-base/80 rounded text-white z-10">
                            {formatDuration(sample.startTime, sample.endTime)}
                          </span>
                        </div>

                          {/* Info */}
                          <div className="h-[50px] p-1.5 overflow-visible">
                            <p className="text-xs font-medium text-white truncate" title={sample.name}>
                              {sample.name}
                            </p>

                          {/* Tags preview */}
                          {sample.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {sample.tags.slice(0, 1).map(tag => (
                                <span
                                  key={tag.id}
                                  onClick={(e) => {
                                    if (onTagClick) {
                                      e.stopPropagation()
                                      onTagClick(tag.id)
                                    }
                                  }}
                                  className={`inline-flex items-center rounded-full px-1 py-0.5 text-[9px] leading-none whitespace-nowrap ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                                  style={{
                                    backgroundColor: tag.color + '25',
                                    color: tag.color,
                                  }}
                                  title={onTagClick ? `Filter by ${tag.name}` : tag.name}
                                >
                                  {tag.name}
                                </span>
                              ))}
                              {sample.tags.length > 1 && (
                                <div
                                  className="relative inline-block"
                                  onMouseEnter={() => handleTagPopupOpen(sample.id)}
                                  onMouseLeave={handleTagPopupClose}
                                >
                                  <span className="inline-flex items-center rounded-full px-1 py-0.5 text-[9px] leading-none text-slate-500 cursor-default bg-surface-overlay/50">
                                    +{sample.tags.length - 1}
                                  </span>
                                  {isTagPopupOpen && (
                                    <div
                                      className="absolute right-0 bottom-full mb-1 z-[80] bg-surface-raised border border-surface-border rounded-lg shadow-lg py-1 px-2 max-w-[200px] max-h-40 overflow-y-auto"
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseEnter={() => handleTagPopupEnter(sample.id)}
                                      onMouseLeave={handleTagPopupClose}
                                    >
                                      <div className="flex flex-col gap-1">
                                        {sample.tags.slice(1).map((tag) => (
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
                                            className={`inline-flex items-center rounded-full px-1 py-0.5 text-[9px] leading-none whitespace-nowrap ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
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
                    })}
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
          )
        })}
      </div>
    </div>
  )
}
