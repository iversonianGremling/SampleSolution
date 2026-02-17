import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseResizablePanelOptions {
  direction: 'horizontal' | 'vertical'
  initialSize: number
  minSize: number
  maxSize: number
  storageKey?: string
}

export interface UseResizablePanelReturn {
  size: number
  isDragging: boolean
  isExpanded: boolean
  isCollapsed: boolean
  dividerProps: {
    onMouseDown: (e: React.MouseEvent) => void
    onDoubleClick: () => void
  }
  collapse: () => void
  expand: () => void
  restore: () => void
}

export function useResizablePanel({
  direction,
  initialSize,
  minSize,
  maxSize,
  storageKey,
}: UseResizablePanelOptions): UseResizablePanelReturn {
  const [size, setSize] = useState(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = Number(stored)
        if (Number.isFinite(parsed) && parsed >= minSize && parsed <= maxSize) {
          return parsed
        }
      }
    }
    return initialSize
  })

  const [isDragging, setIsDragging] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const prevSizeRef = useRef(size)
  const startPosRef = useRef(0)
  const startSizeRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  // Persist to localStorage
  useEffect(() => {
    if (storageKey && !isCollapsed && !isExpanded) {
      localStorage.setItem(storageKey, String(size))
    }
  }, [size, storageKey, isCollapsed, isExpanded])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    setIsExpanded(false)
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY
    startSizeRef.current = size

    document.body.style.userSelect = 'none'
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (rafRef.current !== null) return

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const pos = direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY
        const delta = pos - startPosRef.current
        const newSize = Math.max(minSize, Math.min(maxSize, startSizeRef.current + delta))
        setSize(newSize)
        setIsCollapsed(false)
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [direction, size, minSize, maxSize])

  const handleDoubleClick = useCallback(() => {
    if (isExpanded) {
      // Restore from expanded
      setSize(prevSizeRef.current)
      setIsExpanded(false)
    } else {
      // Expand
      prevSizeRef.current = size
      setSize(maxSize)
      setIsExpanded(true)
      setIsCollapsed(false)
    }
  }, [isExpanded, size, maxSize])

  const collapse = useCallback(() => {
    prevSizeRef.current = size
    setSize(minSize)
    setIsCollapsed(true)
    setIsExpanded(false)
  }, [size, minSize])

  const expand = useCallback(() => {
    prevSizeRef.current = size
    setSize(maxSize)
    setIsExpanded(true)
    setIsCollapsed(false)
  }, [size, maxSize])

  const restore = useCallback(() => {
    setSize(prevSizeRef.current)
    setIsCollapsed(false)
    setIsExpanded(false)
  }, [])

  return {
    size,
    isDragging,
    isExpanded,
    isCollapsed,
    dividerProps: {
      onMouseDown: handleMouseDown,
      onDoubleClick: handleDoubleClick,
    },
    collapse,
    expand,
    restore,
  }
}
