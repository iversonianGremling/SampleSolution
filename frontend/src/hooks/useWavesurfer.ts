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
    // drag/resize are FALSE - WaveformMinimap component handles all interaction
    // color is transparent - WaveformMinimap component handles the visual overlay
    const viewportRegion = minimapRegionsRef.current.addRegion({
      id: 'viewport-region',
      start: 0,
      end: duration,
      drag: false,
      resize: false,
      color: 'transparent',
    })

    viewportRegionRef.current = viewportRegion

    // Initial sync
    updateMainWaveform()
    setViewportStart(viewportRegion.start)
    setViewportEnd(viewportRegion.end)

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

    return () => {
      viewportRegionRef.current = null
      playbackPositionRegionRef.current = null
      wavesurferRef.current?.un('timeupdate', updatePlaybackPosition)
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

      // Clamp values to valid range
      const finalStart = Math.max(0, Math.min(start, duration))
      const finalEnd = Math.max(0, Math.min(end, duration))

      // Update state
      setViewportStart(finalStart)
      setViewportEnd(finalEnd)

      // Update the visual region
      viewportRegionRef.current.setOptions({
        start: finalStart,
        end: finalEnd,
      })

      // Sync main waveform
      updateMainWaveform()
    },
    [duration, updateMainWaveform]
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
