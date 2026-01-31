import { useRef, useState, useEffect } from 'react'
import { GripVertical } from 'lucide-react'

interface WaveformMinimapProps {
  minimapRef: React.RefObject<HTMLDivElement>
  isReady: boolean
  viewportStart: number
  viewportEnd: number
  duration: number
  onSetViewport?: (start: number, end: number) => void
}

const MIN_WIDTH = 0.1
const ZOOM_SENSITIVITY = 0.004

export function WaveformMinimap({
  minimapRef,
  isReady,
  viewportStart,
  viewportEnd,
  duration,
  onSetViewport,
}: WaveformMinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [showContent, setShowContent] = useState(false)
  const rafRef = useRef<number | null>(null)
  const pendingUpdateRef = useRef<{ start: number; end: number } | null>(null)

  // Throttled update using requestAnimationFrame
  const throttledSetViewport = (start: number, end: number) => {
    pendingUpdateRef.current = { start, end }

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (pendingUpdateRef.current) {
          onSetViewport?.(pendingUpdateRef.current.start, pendingUpdateRef.current.end)
          pendingUpdateRef.current = null
        }
      })
    }
  }

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (isReady) {
      const timer = setTimeout(() => setShowContent(true), 300)
      return () => clearTimeout(timer)
    }
  }, [isReady])

  // Prevent division by zero
  const safeDuration = duration || 1
  const leftPercent = (viewportStart / safeDuration) * 100
  const widthPercent = ((viewportEnd - viewportStart) / safeDuration) * 100

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value))

  // ========== RESIZE HANDLES ==========
  const handleResizeMouseDown = (e: React.MouseEvent, isLeft: boolean) => {
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const initStart = viewportStart
    const initEnd = viewportEnd

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current || !duration) return
      const dx = ((moveEvent.clientX - startX) / containerRef.current.offsetWidth) * duration

      if (isLeft) {
        const newStart = clamp(initStart + dx, 0, initEnd - MIN_WIDTH)
        throttledSetViewport(newStart, initEnd)
      } else {
        const newEnd = clamp(initEnd + dx, initStart + MIN_WIDTH, duration)
        throttledSetViewport(initStart, newEnd)
      }
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // ========== CENTER DRAG (PAN + ZOOM SIMULTANEOUS) ==========
  const handleCenterMouseDown = (e: React.MouseEvent) => {
    // Don't handle if clicking on resize handles
    const target = e.target as HTMLElement
    if (target.closest('.resize-handle')) return

    e.preventDefault()
    e.stopPropagation()

    if (!duration) return

    const startX = e.clientX
    const startY = e.clientY
    const initStart = viewportStart
    const initEnd = viewportEnd
    const initWidth = initEnd - initStart
    const initCenter = (initStart + initEnd) / 2

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current) return

      const dxPixels = moveEvent.clientX - startX
      const dyPixels = moveEvent.clientY - startY
      const containerWidth = containerRef.current.offsetWidth

      // ZOOM: vertical movement changes width (down = zoom out, up = zoom in)
      const widthMultiplier = 1 + dyPixels * ZOOM_SENSITIVITY
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

      throttledSetViewport(nStart, nEnd)
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // ========== BACKGROUND CLICK ==========
  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    // Only handle clicks directly on the background, not on children
    if (e.target !== e.currentTarget) return
    if (!containerRef.current || !duration) return

    e.preventDefault()

    const rect = containerRef.current.getBoundingClientRect()
    const currentWidth = viewportEnd - viewportStart

    if (currentWidth >= duration) return

    const getClampedStart = (clientX: number) => {
      const clickSeconds = ((clientX - rect.left) / rect.width) * duration
      const start = clickSeconds - currentWidth / 2
      return clamp(start, 0, duration - currentWidth)
    }

    const nStart = getClampedStart(e.clientX)
    throttledSetViewport(nStart, nStart + currentWidth)

    const onMouseMove = (moveEvent: MouseEvent) => {
      const mStart = getClampedStart(moveEvent.clientX)
      throttledSetViewport(mStart, mStart + currentWidth)
    }

    const onMouseUp = () => {
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
        {/* Waveform minimap canvas - rendered by wavesurfer */}
        <div
          ref={minimapRef}
          className={`bg-gray-900 h-full rounded overflow-hidden border border-gray-700 transition-opacity duration-300 ${
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
            onMouseDown={handleCenterMouseDown}
            onDoubleClick={handleDoubleClick}
          >
            {/* Left resize handle */}
            <div
              className="resize-handle absolute left-0 top-0 h-full w-3 cursor-ew-resize flex items-center justify-center bg-indigo-500/40 hover:bg-indigo-500/70 transition-colors"
              onMouseDown={(e) => handleResizeMouseDown(e, true)}
            >
              <GripVertical size={12} className="text-white/70" />
            </div>

            {/* Right resize handle */}
            <div
              className="resize-handle absolute right-0 top-0 h-full w-3 cursor-ew-resize flex items-center justify-center bg-indigo-500/40 hover:bg-indigo-500/70 transition-colors"
              onMouseDown={(e) => handleResizeMouseDown(e, false)}
            >
              <GripVertical size={12} className="text-white/70" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
