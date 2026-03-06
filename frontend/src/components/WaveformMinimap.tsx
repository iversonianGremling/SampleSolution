import { useRef, useState, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { GripHorizontal } from 'lucide-react'
import { drawWaveformBars } from '../utils/waveformSource'

interface WaveformMinimapProps {
  minimapRef: React.RefObject<HTMLDivElement>
  isReady: boolean
  viewportStart: number
  viewportEnd: number
  duration: number
  peaks?: number[]
  currentTime?: number
  onSetViewport?: (start: number, end: number) => void
  onSeek?: (seconds: number) => void
}

const MIN_WIDTH = 0.02
const ZOOM_SENSITIVITY = 0.01
const HANDLE_WIDTH = 12

export function WaveformMinimap({
  minimapRef,
  isReady,
  viewportStart,
  viewportEnd,
  duration,
  peaks,
  currentTime = 0,
  onSetViewport,
  onSeek,
}: WaveformMinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [showContent, setShowContent] = useState(false)

  // Draw minimap waveform onto canvas whenever peaks, time, or size changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks?.length || !duration) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(canvas.clientWidth * dpr)
    const h = Math.round(canvas.clientHeight * dpr)
    if (!w || !h) return
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    drawWaveformBars(canvas, peaks, currentTime, duration, {
      waveColor: '#64748b',
      progressColor: '#475569',
      cursorColor: 'rgba(239, 68, 68, 0.8)',
    })
  }, [peaks, currentTime, duration])

  // Resize observer to re-draw when canvas element resizes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(canvas.clientWidth * dpr)
      canvas.height = Math.round(canvas.clientHeight * dpr)
      if (peaks?.length && duration) {
        drawWaveformBars(canvas, peaks, currentTime, duration, {
          waveColor: '#64748b',
          progressColor: '#475569',
          cursorColor: 'rgba(239, 68, 68, 0.8)',
        })
      }
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [peaks, currentTime, duration])

  // Optimistic local state for instant visual feedback during dragging
  const [localStart, setLocalStart] = useState(viewportStart)
  const [localEnd, setLocalEnd] = useState(viewportEnd)
  const isDraggingRef = useRef(false)

  // Sync local state with props when not dragging
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalStart(viewportStart)
      setLocalEnd(viewportEnd)
    }
  }, [viewportStart, viewportEnd])

  // Direct viewport update - no throttling for maximum responsiveness
  const updateViewport = (start: number, end: number) => {
    // Force synchronous state update for instant visual feedback
    flushSync(() => {
      setLocalStart(start)
      setLocalEnd(end)
    })

    // Update parent immediately
    onSetViewport?.(start, end)
  }

  useEffect(() => {
    if (isReady) {
      const timer = setTimeout(() => setShowContent(true), 300)
      return () => clearTimeout(timer)
    } else {
      setShowContent(false)
    }
  }, [isReady])

  // Prevent division by zero
  const safeDuration = duration || 1
  // Use local state for visual rendering (instant feedback during drag)
  // Default to full-width selector when duration is not yet known (pre-load state)
  const leftPercent = duration > 0 ? (localStart / safeDuration) * 100 : 0
  const widthPercent = duration > 0 ? ((localEnd - localStart) / safeDuration) * 100 : 100

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value))

  // ========== RESIZE HANDLES ==========
  const doResize = (e: React.MouseEvent, isLeft: boolean) => {
    e.preventDefault()
    e.stopPropagation()

    isDraggingRef.current = true

    const startX = e.clientX
    const initStart = viewportStart
    const initEnd = viewportEnd

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current || !duration) return
      const dx = ((moveEvent.clientX - startX) / containerRef.current.offsetWidth) * duration

      if (isLeft) {
        const newStart = clamp(initStart + dx, 0, initEnd - MIN_WIDTH)
        updateViewport(newStart, initEnd)
      } else {
        const newEnd = clamp(initEnd + dx, initStart + MIN_WIDTH, duration)
        updateViewport(initStart, newEnd)
      }
    }

    const onMouseUp = () => {
      isDraggingRef.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // ========== CENTER DRAG (PAN + ZOOM SIMULTANEOUS) ==========
  const handleCenterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!duration) return

    isDraggingRef.current = true

    const startClientX = e.clientX
    const startClientY = e.clientY
    const initStart = viewportStart
    const initEnd = viewportEnd
    const initWidth = initEnd - initStart
    const initCenter = (initStart + initEnd) / 2

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current) return

      const dxPixels = moveEvent.clientX - startClientX
      const dyPixels = moveEvent.clientY - startClientY
      const containerWidth = containerRef.current.offsetWidth

      // ZOOM: vertical movement changes width (down = zoom out, up = zoom in)
      // Make zoom exponential: smaller selections = more precise, larger = faster
      // Use current viewport width for adaptive sensitivity
      const currentWidth = viewportEnd - viewportStart
      const widthFactor = currentWidth / duration // 0 to 1 range
      const adjustedSensitivity = ZOOM_SENSITIVITY * (0.5 + widthFactor * 0.5) // 0.5x to 1x sensitivity
      const widthMultiplier = 1 + dyPixels * adjustedSensitivity
      let newWidth = initWidth * widthMultiplier
      newWidth = Math.max(newWidth, MIN_WIDTH)

      // PAN: horizontal movement shifts the center
      const dxSeconds = (dxPixels / containerWidth) * duration
      const newCenter = initCenter + dxSeconds

      // Calculate max width possible without either edge hitting a wall at this center
      const maxWidth = Math.min(newCenter * 2, (duration - newCenter) * 2, duration)
      newWidth = Math.min(newWidth, maxWidth)

      // Calculate bounds
      let nStart = newCenter - newWidth / 2
      let nEnd = newCenter + newWidth / 2

      // Clamp to walls while preserving width
      if (nStart < 0) {
        nStart = 0
        nEnd = newWidth
      }
      if (nEnd > duration) {
        nEnd = duration
        nStart = duration - newWidth
      }

      updateViewport(nStart, nEnd)
    }

    const onMouseUp = (upEvent: MouseEvent) => {
      isDraggingRef.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)

      // Click-to-seek: if mouse barely moved, seek to the clicked position
      const movedX = Math.abs(upEvent.clientX - startClientX)
      const movedY = Math.abs(upEvent.clientY - startClientY)
      if (movedX < 5 && movedY < 5 && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const seekSeconds = Math.max(0, Math.min(duration, ((startClientX - rect.left) / rect.width) * duration))
        onSeek?.(seekSeconds)
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // Top handle height in px — must match the CSS height of the grip bar (0.65rem ≈ 10.4px)
  const TOP_HANDLE_PX = 10.4

  // ========== SELECTOR MOUSEDOWN: routes to resize or center drag ==========
  const handleSelectorMouseDown = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const width = rect.width
    const height = rect.height

    // Top handle takes priority — always pan, never resize
    if (y < TOP_HANDLE_PX) {
      handleCenterMouseDown(e)
      return
    }

    const inLeftZone = x < HANDLE_WIDTH
    const inRightZone = x > width - HANDLE_WIDTH

    if (inLeftZone || inRightZone) {
      let useLeft: boolean
      if (inLeftZone && inRightZone) {
        // Handles overlap: top half → left handle, bottom half → right handle
        useLeft = y < height / 2
      } else {
        useLeft = inLeftZone
      }
      doResize(e, useLeft)
    } else {
      handleCenterMouseDown(e)
    }
  }

  // ========== BACKGROUND CLICK ==========
  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    // Only handle clicks directly on the background, not on children
    if (e.target !== e.currentTarget) return
    if (!containerRef.current || !duration) return

    e.preventDefault()

    isDraggingRef.current = true

    const rect = containerRef.current.getBoundingClientRect()
    const currentWidth = viewportEnd - viewportStart

    if (currentWidth >= duration) return

    const getClampedStart = (clientX: number) => {
      const clickSeconds = ((clientX - rect.left) / rect.width) * duration
      const start = clickSeconds - currentWidth / 2
      return clamp(start, 0, duration - currentWidth)
    }

    const nStart = getClampedStart(e.clientX)
    updateViewport(nStart, nStart + currentWidth)

    const onMouseMove = (moveEvent: MouseEvent) => {
      const mStart = getClampedStart(moveEvent.clientX)
      updateViewport(mStart, mStart + currentWidth)
    }

    const onMouseUp = () => {
      isDraggingRef.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // ========== DOUBLE CLICK ==========
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (duration) {
      onSetViewport?.(0, duration)
    }
  }

  return (
    <div className="mb-2 select-none">
      <div className="relative h-16">
        {/* Waveform minimap — custom canvas rendering */}
        <div
          ref={minimapRef}
          className="absolute inset-0 hidden"
          aria-hidden="true"
        />
        <canvas
          ref={canvasRef}
          className={`w-full h-full bg-gray-900 rounded overflow-hidden border border-gray-700 transition-opacity duration-300 ${
            showContent ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Interaction layer - must be on top with z-index */}
        <div
          ref={containerRef}
          className="absolute inset-0 z-10"
          style={{ pointerEvents: onSetViewport ? 'auto' : 'none' }}
          onMouseDown={handleBackgroundMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          {/* Selector box */}
          <div
            className="absolute top-0 h-full rounded-sm cursor-grab active:cursor-grabbing"
            style={{
              left: `${leftPercent}%`,
              width: `${widthPercent}%`,
              backgroundColor: 'rgba(99, 102, 241, 0.3)',
              border: '1px solid rgba(99, 102, 241, 0.6)',
              pointerEvents: 'auto',
            }}
            onMouseDown={handleSelectorMouseDown}
            onDoubleClick={handleDoubleClick}
          >
            {/* Top drag handle — pan the viewport */}
            <div
              className="absolute top-0 left-0 right-0 flex items-center justify-center"
              style={{ height: '0.65rem', backgroundColor: 'rgba(99, 102, 241, 0.85)', pointerEvents: 'none' }}
            >
              <GripHorizontal size={14} className="text-white/90 pointer-events-none" />
            </div>

            {/* Left handle — visual only, events bubble to selector */}
            <div
              className="absolute left-0 bottom-0"
              style={{ width: HANDLE_WIDTH, top: '0', cursor: 'ew-resize', zIndex: 1 }}
            >
              {/* Left-pointing chevron at top */}
              <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', top: 14, left: 1 }}>
                <path d="M3,2 L7,5 L3,8" stroke="rgba(225,225,235,0.95)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            {/* Right handle — visual only, events bubble to selector */}
            <div
              className="absolute right-0 bottom-0"
              style={{ width: HANDLE_WIDTH, top: '0.65rem', cursor: 'ew-resize', zIndex: 1 }}
            >
              {/* Left-pointing chevron at bottom */}
              <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', bottom: 3, right: 1 }}>
                <path d="M7,2 L3,5 L7,8" stroke="rgba(225,225,235,0.95)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
