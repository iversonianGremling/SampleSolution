import { useRef, useState, useEffect } from 'react'

interface WaveformMinimapProps {
  minimapRef: React.RefObject<HTMLDivElement>
  isReady: boolean
  viewportStart: number
  viewportEnd: number
  duration: number
  onSetViewport?: (start: number, end: number) => void
}

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

  // Fade in the waveform after a delay once ready
  useEffect(() => {
    if (isReady) {
      const timer = setTimeout(() => {
        setShowContent(true)
      }, 300)
      return () => clearTimeout(timer)
    } else {
      setShowContent(false)
    }
  }, [isReady])

  // Calculate overlay position and width
  const overlayLeftPercent = (viewportStart / duration) * 100
  const overlayWidthPercent = ((viewportEnd - viewportStart) / duration) * 100

  return (
    <div className="mb-2">

      <div className="relative">
        <div
          ref={minimapRef}
          className={`bg-gray-900 rounded overflow-hidden border border-gray-700 transition-opacity duration-300 ${
            showContent ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {/* Loading animation */}
        {!showContent && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 rounded">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-3 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
              <span className="text-xs text-slate-400">Loading minimap...</span>
            </div>
          </div>
        )}
        {/* Yellow viewport overlay */}
        <div
          ref={containerRef}
          className={`absolute top-0 left-0 w-full h-full transition-opacity duration-300 ${
            showContent ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ pointerEvents: onSetViewport ? 'auto' : 'none' }}
        >
          {/* Left draggable area - pans viewport while maintaining width */}
          <div
            className="absolute top-0 left-0 h-full"
            style={{
              width: `${overlayLeftPercent}%`,
              cursor: 'grab',
            }}
            onMouseDown={(e) => {
              if (!containerRef.current) return
              e.preventDefault()
              const startX = e.clientX
              const startViewportStart = viewportStart
              const startViewportEnd = viewportEnd
              const viewportWidth = viewportEnd - viewportStart

              const handleMouseMove = (moveEvent: MouseEvent) => {
                if (!containerRef.current) return
                const deltaX = moveEvent.clientX - startX
                const containerWidth = containerRef.current.offsetWidth
                const deltaTime = (deltaX / containerWidth) * duration

                // Calculate new positions
                let newStart = startViewportStart + deltaTime
                let newEnd = startViewportEnd + deltaTime

                // Clamp to boundaries while maintaining constant width
                if (newStart < 0) {
                  newStart = 0
                  newEnd = viewportWidth
                } else if (newEnd > duration) {
                  newEnd = duration
                  newStart = duration - viewportWidth
                }

                // Ensure bounds are respected (edge case protection)
                newStart = Math.max(0, newStart)
                newEnd = Math.min(duration, newEnd)

                onSetViewport?.(newStart, newEnd)
              }

              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove)
                document.removeEventListener('mouseup', handleMouseUp)
              }

              document.addEventListener('mousemove', handleMouseMove)
              document.addEventListener('mouseup', handleMouseUp)
            }}
          />

          {/* Yellow center box - draggable for panning */}
          <div
            className="absolute top-0 h-full bg-yellow-400 opacity-30 flex items-center justify-center text-xs group"
            style={{
              left: `${overlayLeftPercent}%`,
              width: `${overlayWidthPercent}%`,
              cursor: 'grab',
            }}
            onMouseDown={(e) => {
              // Only handle center area dragging if not clicking on resize handles
              if ((e.target as HTMLElement).classList.contains('resize-handle')) {
                return
              }

              console.log('[CENTER PAN] MouseDown - start:', viewportStart, 'end:', viewportEnd, 'duration:', duration)
              e.preventDefault()
              const startX = e.clientX
              const startViewportStart = viewportStart
              const startViewportEnd = viewportEnd

              const handleMouseMove = (moveEvent: MouseEvent) => {
                if (!containerRef.current) return
                const deltaX = moveEvent.clientX - startX
                const containerWidth = containerRef.current.offsetWidth
                const deltaTime = (deltaX / containerWidth) * duration

                // Calculate new positions
                let newStart = startViewportStart + deltaTime
                let newEnd = startViewportEnd + deltaTime

                console.log('[CENTER PAN] Move - deltaTime:', deltaTime, 'newStart:', newStart, 'newEnd:', newEnd)

                // Only allow panning if both edges stay within boundaries
                // This keeps the viewport width constant during center panning
                if (newStart < 0 || newEnd > duration) {
                  console.log('[CENTER PAN] BLOCKED - out of bounds')
                  return
                }

                console.log('[CENTER PAN] Calling onSetViewport(', newStart, ',', newEnd, ')')
                onSetViewport?.(newStart, newEnd)
              }

              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove)
                document.removeEventListener('mouseup', handleMouseUp)
              }

              document.addEventListener('mousemove', handleMouseMove)
              document.addEventListener('mouseup', handleMouseUp)
            }}
          >
            {/* Left resize handle */}
            <div
              className="resize-handle absolute left-0 top-0 h-full w-3 bg-yellow-600 opacity-0 group-hover:opacity-60 cursor-col-resize transition-opacity"
              style={{ cursor: 'col-resize' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                const startX = e.clientX
                const startStart = viewportStart
                const startEnd = viewportEnd
                let lastStart = startStart

                const handleMouseMove = (moveEvent: MouseEvent) => {
                  if (!containerRef.current) return
                  const deltaX = moveEvent.clientX - startX
                  const containerWidth = containerRef.current.offsetWidth
                  const deltaTime = (deltaX / containerWidth) * duration
                  const newStart = Math.max(0, Math.min(startStart + deltaTime, startEnd - 0.1))

                  // Only update if the value actually changed
                  if (newStart !== lastStart) {
                    onSetViewport?.(newStart, startEnd)
                    lastStart = newStart
                  }
                }

                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove)
                  document.removeEventListener('mouseup', handleMouseUp)
                }

                document.addEventListener('mousemove', handleMouseMove)
                document.addEventListener('mouseup', handleMouseUp)
              }}
            />

            <span className="text-gray-900 font-semibold whitespace-nowrap px-1 drop-shadow pointer-events-none">
              {viewportStart.toFixed(2)} - {viewportEnd.toFixed(2)}
            </span>

            {/* Right resize handle */}
            <div
              className="resize-handle absolute right-0 top-0 h-full w-3 bg-yellow-600 opacity-0 group-hover:opacity-60 cursor-col-resize transition-opacity"
              style={{ cursor: 'col-resize' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                const startX = e.clientX
                const startEnd = viewportEnd
                const startStart = viewportStart
                let lastEnd = startEnd

                const handleMouseMove = (moveEvent: MouseEvent) => {
                  if (!containerRef.current) return
                  const deltaX = moveEvent.clientX - startX
                  const containerWidth = containerRef.current.offsetWidth
                  const deltaTime = (deltaX / containerWidth) * duration
                  const newEnd = Math.min(duration, Math.max(startEnd + deltaTime, startStart + 0.1))

                  // Only update if the value actually changed
                  if (newEnd !== lastEnd) {
                    onSetViewport?.(startStart, newEnd)
                    lastEnd = newEnd
                  }
                }

                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove)
                  document.removeEventListener('mouseup', handleMouseUp)
                }

                document.addEventListener('mousemove', handleMouseMove)
                document.addEventListener('mouseup', handleMouseUp)
              }}
            />
          </div>

          {/* Right draggable area - pans viewport while maintaining width */}
          <div
            className="absolute top-0 h-full"
            style={{
              left: `${overlayLeftPercent + overlayWidthPercent}%`,
              width: `${100 - (overlayLeftPercent + overlayWidthPercent)}%`,
              cursor: 'grab',
            }}
            onMouseDown={(e) => {
              if (!containerRef.current) return
              e.preventDefault()
              const startX = e.clientX
              const startViewportStart = viewportStart
              const startViewportEnd = viewportEnd
              const viewportWidth = viewportEnd - viewportStart

              const handleMouseMove = (moveEvent: MouseEvent) => {
                if (!containerRef.current) return
                const deltaX = moveEvent.clientX - startX
                const containerWidth = containerRef.current.offsetWidth
                const deltaTime = (deltaX / containerWidth) * duration

                // Calculate new positions
                let newStart = startViewportStart + deltaTime
                let newEnd = startViewportEnd + deltaTime

                // Clamp to boundaries while maintaining constant width
                if (newStart < 0) {
                  newStart = 0
                  newEnd = viewportWidth
                } else if (newEnd > duration) {
                  newEnd = duration
                  newStart = duration - viewportWidth
                }

                // Ensure bounds are respected (edge case protection)
                newStart = Math.max(0, newStart)
                newEnd = Math.min(duration, newEnd)

                onSetViewport?.(newStart, newEnd)
              }

              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove)
                document.removeEventListener('mouseup', handleMouseUp)
              }

              document.addEventListener('mousemove', handleMouseMove)
              document.addEventListener('mouseup', handleMouseUp)
            }}
          />
        </div>
      </div>
      <div className="text-xs text-gray-500 mt-1 px-1">
        Drag edge handles to resize, drag anywhere to pan, double-click to select all
      </div>
    </div>
  )
}
