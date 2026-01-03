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
  const [inputStart, setInputStart] = useState(viewportStart.toFixed(2))
  const [inputEnd, setInputEnd] = useState(viewportEnd.toFixed(2))

  // Update inputs instantly when viewport changes
  useEffect(() => {
    setInputStart(viewportStart.toFixed(2))
    setInputEnd(viewportEnd.toFixed(2))
  }, [viewportStart, viewportEnd])

  // Calculate overlay position and width
  const overlayLeftPercent = (viewportStart / duration) * 100
  const overlayWidthPercent = ((viewportEnd - viewportStart) / duration) * 100

  const handleApplyViewport = () => {
    if (!onSetViewport) return
    const start = parseFloat(inputStart) || 0
    const end = parseFloat(inputEnd) || duration
    onSetViewport(start, end)
  }

  return (
    <div className="mb-2">

      <div className="relative">
        <div
          ref={minimapRef}
          className={`bg-gray-900 rounded overflow-hidden border border-gray-700 ${
            isReady ? 'opacity-100' : 'opacity-50'
          }`}
        />
        {/* Yellow viewport overlay */}
        <div
          ref={containerRef}
          className="absolute top-0 left-0 w-full h-full"
          style={{ pointerEvents: onSetViewport ? 'auto' : 'none' }}
        >
          {/* Left draggable area */}
          <div
            className="absolute top-0 left-0 h-full"
            style={{
              width: `${overlayLeftPercent}%`,
              cursor: 'col-resize',
            }}
            onMouseDown={(e) => {
              if (!containerRef.current) return
              const rect = containerRef.current.getBoundingClientRect()
              const clickX = e.clientX - rect.left
              const clickTime = (clickX / rect.width) * duration
              const newStart = Math.max(0, Math.min(clickTime, viewportEnd - 0.1))
              onSetViewport?.(newStart, viewportEnd)

              // Allow dragging after snap
              e.preventDefault()
              const startX = e.clientX
              const startStart = newStart

              const handleMouseMove = (moveEvent: MouseEvent) => {
                if (!containerRef.current) return
                const deltaX = moveEvent.clientX - startX
                const containerWidth = containerRef.current.offsetWidth
                const deltaTime = (deltaX / containerWidth) * duration
                const dragStart = Math.max(0, Math.min(startStart + deltaTime, viewportEnd - 0.1))
                onSetViewport?.(dragStart, viewportEnd)
              }

              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove)
                document.removeEventListener('mouseup', handleMouseUp)
              }

              document.addEventListener('mousemove', handleMouseMove)
              document.addEventListener('mouseup', handleMouseUp)
            }}
          />

          {/* Yellow center box */}
          <div
            className="absolute top-0 h-full bg-yellow-400 opacity-30 flex items-center justify-center text-xs group"
            style={{
              left: `${overlayLeftPercent}%`,
              width: `${overlayWidthPercent}%`,
            }}
          >
            {/* Left resize handle */}
            <div
              className="absolute left-0 top-0 h-full w-3 bg-yellow-600 opacity-0 group-hover:opacity-60 cursor-col-resize transition-opacity"
              style={{ cursor: 'col-resize' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                const startX = e.clientX
                const startStart = viewportStart

                const handleMouseMove = (moveEvent: MouseEvent) => {
                  if (!containerRef.current) return
                  const deltaX = moveEvent.clientX - startX
                  const containerWidth = containerRef.current.offsetWidth
                  const deltaTime = (deltaX / containerWidth) * duration
                  const newStart = Math.max(0, Math.min(startStart + deltaTime, viewportEnd - 0.1))
                  onSetViewport?.(newStart, viewportEnd)
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
              className="absolute right-0 top-0 h-full w-3 bg-yellow-600 opacity-0 group-hover:opacity-60 cursor-col-resize transition-opacity"
              style={{ cursor: 'col-resize' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                const startX = e.clientX
                const startEnd = viewportEnd

                const handleMouseMove = (moveEvent: MouseEvent) => {
                  if (!containerRef.current) return
                  const deltaX = moveEvent.clientX - startX
                  const containerWidth = containerRef.current.offsetWidth
                  const deltaTime = (deltaX / containerWidth) * duration
                  const newEnd = Math.min(duration, Math.max(startEnd + deltaTime, viewportStart + 0.1))
                  onSetViewport?.(viewportStart, newEnd)
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

          {/* Right draggable area */}
          <div
            className="absolute top-0 h-full"
            style={{
              left: `${overlayLeftPercent + overlayWidthPercent}%`,
              width: `${100 - (overlayLeftPercent + overlayWidthPercent)}%`,
              cursor: 'col-resize',
            }}
            onMouseDown={(e) => {
              if (!containerRef.current) return
              const rect = containerRef.current.getBoundingClientRect()
              const clickX = e.clientX - rect.left
              const clickTime = (clickX / rect.width) * duration
              const newEnd = Math.min(duration, Math.max(clickTime, viewportStart + 0.1))
              onSetViewport?.(viewportStart, newEnd)

              // Allow dragging after snap
              e.preventDefault()
              const startX = e.clientX
              const startEnd = newEnd

              const handleMouseMove = (moveEvent: MouseEvent) => {
                if (!containerRef.current) return
                const deltaX = moveEvent.clientX - startX
                const containerWidth = containerRef.current.offsetWidth
                const deltaTime = (deltaX / containerWidth) * duration
                const dragEnd = Math.min(duration, Math.max(startEnd + deltaTime, viewportStart + 0.1))
                onSetViewport?.(viewportStart, dragEnd)
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
        Drag edges to zoom, drag center to pan, click to move window
      </div>
    </div>
  )
}
