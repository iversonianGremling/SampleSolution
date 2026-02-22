import { useState, useRef, useEffect } from 'react'
import { ChevronDown, ChevronRight, Loader2, Scissors, Trash2 } from 'lucide-react'
import { SourcesSampleListRow } from './SourcesSampleListRow'
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
const MAX_RENDERED_LIST_ROWS = 80

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function SourcesYouTubeGroupedList({
  samples,
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
  const groupedRowsRef = useRef<Record<number, HTMLDivElement | null>>({})
  const dragPreviewRef = useRef<HTMLElement | null>(null)
  const [expandedVideos, setExpandedVideos] = useState<Set<number>>(new Set())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(null)

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
  }, [])

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
  const rowHeight = measuredRowHeight ?? DEFAULT_LIST_ROW_HEIGHT_PX

  const getVirtualWindow = (itemCount: number, groupNode: HTMLDivElement | null) => {
    if (itemCount === 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        topSpacer: 0,
        bottomSpacer: 0,
      }
    }

    if (!groupNode || viewportHeight <= 0 || rowHeight <= 0) {
      const fallbackEndIndex = Math.min(itemCount, MAX_RENDERED_LIST_ROWS)
      return {
        startIndex: 0,
        endIndex: fallbackEndIndex,
        topSpacer: 0,
        bottomSpacer: Math.max(0, itemCount - fallbackEndIndex) * rowHeight,
      }
    }

    const groupOffsetTop = groupNode.offsetTop
    const visibleTop = scrollTop - groupOffsetTop
    const visibleBottom = visibleTop + viewportHeight

    const rawStartRow = Math.floor(visibleTop / rowHeight) - LIST_ROW_OVERSCAN
    const rawEndRowExclusive = Math.ceil(visibleBottom / rowHeight) + LIST_ROW_OVERSCAN
    const startRow = clamp(rawStartRow, 0, itemCount)
    const endRowExclusive = clamp(rawEndRowExclusive, 0, itemCount)

    if (startRow >= endRowExclusive) {
      if (rawEndRowExclusive <= 0) {
        const fallbackEndIndex = Math.min(itemCount, MAX_RENDERED_LIST_ROWS)
        return {
          startIndex: 0,
          endIndex: fallbackEndIndex,
          topSpacer: 0,
          bottomSpacer: Math.max(0, itemCount - fallbackEndIndex) * rowHeight,
        }
      }

      if (rawStartRow >= itemCount) {
        const fallbackStartRow = Math.max(0, itemCount - MAX_RENDERED_LIST_ROWS)
        return {
          startIndex: fallbackStartRow,
          endIndex: itemCount,
          topSpacer: fallbackStartRow * rowHeight,
          bottomSpacer: 0,
        }
      }

      return {
        startIndex: startRow,
        endIndex: startRow,
        topSpacer: startRow * rowHeight,
        bottomSpacer: Math.max(0, itemCount - startRow) * rowHeight,
      }
    }

    const cappedEndRowExclusive = Math.min(endRowExclusive, startRow + MAX_RENDERED_LIST_ROWS)
    return {
      startIndex: startRow,
      endIndex: cappedEndRowExclusive,
      topSpacer: startRow * rowHeight,
      bottomSpacer: Math.max(0, itemCount - cappedEndRowExclusive) * rowHeight,
    }
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
    <div className="flex flex-col h-full overflow-hidden">
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
      <div ref={listBodyRef} className="flex-1 overflow-y-auto">
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
            <div key={group.trackId} className="border-b border-surface-border">
              {/* Video header */}
              <div className="flex items-center gap-3 p-3 bg-surface-raised hover:bg-surface-base transition-colors">
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
