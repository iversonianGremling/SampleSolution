import { useEffect, useRef, useState, useCallback } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { Region } from 'wavesurfer.js/dist/plugins/regions.js'

interface UseWavesurferOptions {
  audioUrl: string
  onRegionCreated?: (region: Region) => void
  onRegionUpdated?: (region: Region) => void
}

export function useWavesurfer({
  audioUrl,
  onRegionCreated,
  onRegionUpdated,
}: UseWavesurferOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<RegionsPlugin | null>(null)
  const onRegionCreatedRef = useRef(onRegionCreated)
  const onRegionUpdatedRef = useRef(onRegionUpdated)

  // Minimap refs
  const minimapRef = useRef<HTMLDivElement>(null)
  const minimapWavesurferRef = useRef<WaveSurfer | null>(null)
  const minimapRegionsRef = useRef<RegionsPlugin | null>(null)
  const viewportRegionRef = useRef<Region | null>(null)
  const playbackPositionRegionRef = useRef<Region | null>(null)
  const currentZoomRef = useRef<number>(150)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isReady, setIsReady] = useState(false)
  const [isMinimapReady, setIsMinimapReady] = useState(false)
  const [viewportStart, setViewportStart] = useState(0)
  const [viewportEnd, setViewportEnd] = useState(0)

  // Keep refs up to date
  useEffect(() => {
    onRegionCreatedRef.current = onRegionCreated
    onRegionUpdatedRef.current = onRegionUpdated
  }, [onRegionCreated, onRegionUpdated])

  // Initialize main waveform
  useEffect(() => {
    if (!containerRef.current || !audioUrl) return

    const regions = RegionsPlugin.create()
    regionsRef.current = regions

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4f46e5',
      progressColor: '#818cf8',
      cursorColor: '#f59e0b',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 128,
      normalize: true,
      minPxPerSec: 150,
      autoScroll: false,
      autoCenter: false,
      plugins: [regions],
    })

    wavesurferRef.current = ws

    ws.load(audioUrl)

    ws.on('ready', () => {
      setDuration(ws.getDuration())
      setIsReady(true)
    })

    ws.on('play', () => setIsPlaying(true))
    ws.on('pause', () => setIsPlaying(false))
    ws.on('timeupdate', (time) => setCurrentTime(time))

    regions.on('region-created', (region) => {
      onRegionCreatedRef.current?.(region)
    })

    // Listen to both region-updated (after update) and region-update (during update)
    regions.on('region-updated', (region) => {
      onRegionUpdatedRef.current?.(region)
    })

    regions.on('region-update', (region) => {
      if (region) {
        onRegionUpdatedRef.current?.(region)
      }
    })

    regions.enableDragSelection({
      color: 'rgba(245, 158, 11, 0.3)',
    })

    return () => {
      ws.destroy()
    }
  }, [audioUrl])

  // Initialize minimap waveform
  useEffect(() => {
    if (!minimapRef.current || !audioUrl) return

    const minimapRegions = RegionsPlugin.create()
    minimapRegionsRef.current = minimapRegions

    const minimapWs = WaveSurfer.create({
      container: minimapRef.current,
      waveColor: '#64748b',
      progressColor: '#475569',
      height: 60,
      normalize: true,
      interact: false,
      plugins: [minimapRegions],
    })

    minimapWavesurferRef.current = minimapWs
    minimapWs.load(audioUrl)

    minimapWs.on('ready', () => {
      setIsMinimapReady(true)
    })

    return () => {
      minimapWs.destroy()
    }
  }, [audioUrl])

  // Function to update main waveform based on viewport region changes
  // This is defined outside useEffect so it can be called from setViewportStart
  const updateMainWaveform = useCallback(() => {
    if (!viewportRegionRef.current || !wavesurferRef.current || !minimapWavesurferRef.current) {
      return
    }

    const region = viewportRegionRef.current
    const start = region.start
    const end = region.end
    const visibleDuration = end - start

    // Calculate zoom level (pixels per second)
    const mainWidth = wavesurferRef.current.getWidth()
    const pxPerSec = mainWidth / visibleDuration

    // Only apply zoom if it changed significantly (>1%) to reduce re-renders
    const zoomChange = Math.abs(pxPerSec - currentZoomRef.current) / currentZoomRef.current
    if (zoomChange > 0.01) {
      wavesurferRef.current.zoom(pxPerSec)
      currentZoomRef.current = pxPerSec
    }

    // Use WaveSurfer's native setScrollTime method to position the view
    // This moves the viewing window to show the start of the viewport region
    wavesurferRef.current.setScrollTime(start)
  }, [])

  // Create viewport region when both instances are ready
  useEffect(() => {
    if (!isReady || !isMinimapReady || !minimapRegionsRef.current || !wavesurferRef.current) {
      return
    }

    const duration = minimapWavesurferRef.current?.getDuration() || 0
    if (duration === 0) return

    // Create viewport region spanning the entire waveform initially
    // This means the main waveform will show the full audio on load
    const viewportRegion = minimapRegionsRef.current.addRegion({
      id: 'viewport-region',
      start: 0,
      end: duration,
      drag: true,
      resize: true,
      color: 'rgba(99, 102, 241, 0.25)',
      minLength: 0.5,
    })

    viewportRegionRef.current = viewportRegion

    // Initial sync
    updateMainWaveform()
    setViewportStart(viewportRegion.start)
    setViewportEnd(viewportRegion.end)

    // Track previous values to detect boundary hits and operation type
    let previousStart = viewportRegion.start
    let previousEnd = viewportRegion.end
    let lockedEnd: number | null = null
    let lockedStart: number | null = null
    let isUpdatingProgrammatically = false
    let dragOperationType: 'center' | 'left' | 'right' | null = null

    // Listen to region updates - both during drag/resize and after
    const handleViewportUpdate = () => {
      // Skip handling if this update was triggered by our own setOptions call
      if (isUpdatingProgrammatically) {
        return
      }
      let finalStart = viewportRegion.start
      let finalEnd = viewportRegion.end

      const epsilon = 0.005 // Small threshold for boundary detection
      const deltaThreshold = 0.001 // Threshold for detecting operation type

      // Calculate how much each edge changed
      const startDelta = Math.abs(finalStart - previousStart)
      const endDelta = Math.abs(finalEnd - previousEnd)

      // Detect if we're at boundaries
      const hasHitLeftLimit = Math.abs(finalStart) < epsilon
      const hasHitRightLimit = Math.abs(finalEnd - duration) < epsilon

      // Detect operation type on first update of this drag operation
      if (dragOperationType === null) {
        // Panning: Both edges move by approximately the same amount
        // Resizing: Only one edge moves significantly
        const bothEdgesMoving = startDelta > deltaThreshold && endDelta > deltaThreshold
        const movingTogether = Math.abs(startDelta - endDelta) < deltaThreshold

        if (bothEdgesMoving && movingTogether) {
          dragOperationType = 'center'
        } else if (startDelta > endDelta) {
          dragOperationType = 'left'
        } else if (endDelta > startDelta) {
          dragOperationType = 'right'
        }
      }

      const isDraggingFromCenter = dragOperationType === 'center'
      const isDraggingFromEdges = dragOperationType === 'left' || dragOperationType === 'right'

      console.log('[VIEWPORT UPDATE] start:', finalStart, 'end:', finalEnd, 'startDelta:', startDelta, 'endDelta:', endDelta, 'dragOperationType:', dragOperationType, 'isDraggingFromCenter:', isDraggingFromCenter, 'isDraggingFromEdges:', isDraggingFromEdges, 'hasHitLeftLimit:', hasHitLeftLimit, 'hasHitRightLimit:', hasHitRightLimit)

      // Apply boundary locking only during panning, not resizing
      if (isDraggingFromCenter) {
        if (hasHitLeftLimit) {
          // At left boundary - lock the end to prevent changes
          if (lockedEnd === null) {
            lockedEnd = previousEnd
            console.log('[VIEWPORT UPDATE] LOCKED END at:', lockedEnd)
          }
          finalEnd = lockedEnd
          console.log('[VIEWPORT UPDATE] At left boundary, setting finalEnd to:', finalEnd)
        } else if (hasHitRightLimit) {
          // At right boundary - lock the start to prevent changes
          if (lockedStart === null) {
            lockedStart = previousStart
            console.log('[VIEWPORT UPDATE] LOCKED START at:', lockedStart)
          }
          finalStart = lockedStart
          console.log('[VIEWPORT UPDATE] At right boundary, setting finalStart to:', finalStart)
        } else {
          // Not at boundaries, unlock
          lockedEnd = null
          lockedStart = null
        }
      } else {
        // During resize, don't apply boundary locking - clear locks
        lockedEnd = null
        lockedStart = null
      }

      // Update the region if we modified values
      if (Math.abs(finalStart - viewportRegion.start) > 0.0001 || Math.abs(finalEnd - viewportRegion.end) > 0.0001) {
        isUpdatingProgrammatically = true
        viewportRegion.setOptions({ start: finalStart, end: finalEnd })
        isUpdatingProgrammatically = false
      }

      previousStart = finalStart
      previousEnd = finalEnd

      updateMainWaveform()
      setViewportStart(finalStart)
      setViewportEnd(finalEnd)
    }

    // Handler for when drag/resize ends - clear locks
    const handleViewportUpdateEnd = () => {
      // Clear all locks when drag ends
      lockedEnd = null
      lockedStart = null
      dragOperationType = null

      // Update previous values to current position
      previousStart = viewportRegion.start
      previousEnd = viewportRegion.end

      // Update the main waveform
      updateMainWaveform()
      setViewportStart(viewportRegion.start)
      setViewportEnd(viewportRegion.end)
    }

    viewportRegion.on('update', handleViewportUpdate)
    viewportRegion.on('update-end', handleViewportUpdateEnd)

    // Calculate time duration that corresponds to 2px on the minimap
    // Formula: (2px / minimapWidth) * duration gives us the time needed for 2px
    const minimapWidth = minimapWavesurferRef.current?.getWidth() || 1
    const indicatorDuration = Math.max((2 / minimapWidth) * duration, 0.001)

    // Create playback position indicator on minimap
    const playbackPositionRegion = minimapRegionsRef.current.addRegion({
      id: 'playback-position',
      start: 0,
      end: indicatorDuration,
      drag: false,
      resize: false,
      color: 'rgba(239, 68, 68, 0.8)', // Brighter red for playback position
    })

    playbackPositionRegionRef.current = playbackPositionRegion

    // Update playback position during playback
    const updatePlaybackPosition = () => {
      if (playbackPositionRegionRef.current && wavesurferRef.current) {
        const currentTime = wavesurferRef.current.getCurrentTime()
        playbackPositionRegionRef.current.setOptions({
          start: currentTime,
          end: Math.min(currentTime + indicatorDuration, duration),
        })
      }
    }

    wavesurferRef.current.on('timeupdate', updatePlaybackPosition)

    // Handle clicks on minimap to pan viewport while maintaining width
    const handleMinimapClick = (relativeX: number) => {
      if (!viewportRegionRef.current || !minimapWavesurferRef.current) {
        return
      }

      const minimapWidth = minimapWavesurferRef.current.getWidth()
      const clickTime = (relativeX / minimapWidth) * duration

      const viewportStart = viewportRegionRef.current.start
      const viewportEnd = viewportRegionRef.current.end
      const viewportDuration = viewportEnd - viewportStart

      // If clicked outside the viewport, pan to center the viewport on the clicked position
      if (clickTime < viewportStart || clickTime > viewportEnd) {
        // Center the viewport on the clicked position
        let newStart = clickTime - viewportDuration / 2
        let newEnd = clickTime + viewportDuration / 2

        // Clamp to boundaries while maintaining width
        if (newStart < 0) {
          newStart = 0
          newEnd = viewportDuration
        }
        if (newEnd > duration) {
          newEnd = duration
          newStart = duration - viewportDuration
        }

        viewportRegionRef.current.setOptions({
          start: newStart,
          end: newEnd,
        })
      }
    }

    minimapWavesurferRef.current?.on('click', handleMinimapClick)

    return () => {
      viewportRegionRef.current = null
      playbackPositionRegionRef.current = null
      wavesurferRef.current?.un('timeupdate', updatePlaybackPosition)
      minimapWavesurferRef.current?.un('click', handleMinimapClick)
    }
  }, [isReady, isMinimapReady])

  const play = useCallback(() => {
    wavesurferRef.current?.play()
  }, [])

  const pause = useCallback(() => {
    wavesurferRef.current?.pause()
  }, [])

  const playPause = useCallback(() => {
    wavesurferRef.current?.playPause()
  }, [])

  const seekTo = useCallback((time: number) => {
    if (wavesurferRef.current && duration > 0) {
      wavesurferRef.current.seekTo(time / duration)
    }
  }, [duration])

  const playRegion = useCallback((start: number, end: number) => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setTime(start)
      wavesurferRef.current.play()

      const checkEnd = () => {
        if (wavesurferRef.current && wavesurferRef.current.getCurrentTime() >= end) {
          wavesurferRef.current.pause()
          wavesurferRef.current.un('timeupdate', checkEnd)
        }
      }
      wavesurferRef.current.on('timeupdate', checkEnd)
    }
  }, [])

  const addRegion = useCallback(
    (id: string, start: number, end: number, color?: string) => {
      if (regionsRef.current) {
        return regionsRef.current.addRegion({
          id,
          start,
          end,
          color: color || 'rgba(245, 158, 11, 0.3)',
          drag: true,
          resize: true,
          minLength: 0.1,
        })
      }
    },
    []
  )

  const clearRegions = useCallback(() => {
    regionsRef.current?.clearRegions()
  }, [])

  const removeRegion = useCallback((id: string) => {
    const region = regionsRef.current?.getRegions().find((r) => r.id === id)
    if (region) {
      region.remove()
    }
  }, [])

  const getRegions = useCallback(() => {
    return regionsRef.current?.getRegions() || []
  }, [])

  const setViewportRegion = useCallback(
    (start: number, end: number) => {
      if (!viewportRegionRef.current || !duration) return

      const epsilon = 0.001 // 1ms threshold for floating point comparison
      const currentRegion = viewportRegionRef.current
      const currentStart = currentRegion.start
      const currentEnd = currentRegion.end

      // Determine which edge is being changed
      const startChanged = Math.abs(currentStart - start) > epsilon
      const endChanged = Math.abs(currentEnd - end) > epsilon

      if (!startChanged && !endChanged) {
        return // No change, skip update
      }

      let finalStart: number
      let finalEnd: number

      if (startChanged && !endChanged) {
        // Only start is changing - preserve end exactly
        finalStart = Math.max(0, Math.min(start, duration))
        finalEnd = currentEnd
      } else if (endChanged && !startChanged) {
        // Only end is changing - preserve start exactly
        finalStart = currentStart
        finalEnd = Math.max(0, Math.min(end, duration))
      } else {
        // Both changing (panning) - clamp both
        finalStart = Math.max(0, Math.min(start, duration))
        finalEnd = Math.max(0, Math.min(end, duration))
      }

      // Update state
      setViewportStart(finalStart)
      setViewportEnd(finalEnd)

      // Update the region
      currentRegion.setOptions({
        start: finalStart,
        end: finalEnd,
      })
    },
    [duration]
  )

  return {
    containerRef,
    minimapRef,
    isPlaying,
    isReady,
    currentTime,
    duration,
    play,
    pause,
    playPause,
    seekTo,
    playRegion,
    addRegion,
    clearRegions,
    removeRegion,
    getRegions,
    viewportStart,
    viewportEnd,
    setViewportRegion,
  }
}
