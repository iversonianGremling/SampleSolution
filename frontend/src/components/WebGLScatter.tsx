import { useRef, useEffect, useState, useCallback } from 'react'
import * as PIXI from 'pixi.js'
import type { SamplePoint } from '../types'
import { getClusterColor } from '../hooks/useClustering'

interface WebGLScatterProps {
  points: SamplePoint[]
  onPointHover: (point: SamplePoint | null) => void
  onPointClick: (point: SamplePoint) => void
  onSelectionChange?: (selectedIds: number[]) => void
  width: number
  height: number
}

const POINT_RADIUS = 6
const POINT_RADIUS_HOVER = 10
const PADDING = 40

export function WebGLScatter({
  points,
  onPointHover,
  onPointClick,
  onSelectionChange,
  width,
  height,
}: WebGLScatterProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const pointsContainerRef = useRef<PIXI.Container | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Transform coordinates from -1..1 to screen space
  const transformX = useCallback(
    (x: number) => PADDING + ((x + 1) / 2) * (width - PADDING * 2),
    [width]
  )
  const transformY = useCallback(
    (y: number) => PADDING + ((1 - y) / 2) * (height - PADDING * 2), // Flip Y
    [height]
  )

  // Initialize PIXI application
  useEffect(() => {
    if (!containerRef.current || width <= 0 || height <= 0) return

    const app = new PIXI.Application()

    const initApp = async () => {
      await app.init({
        width,
        height,
        backgroundColor: 0x1f2937, // gray-800
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      })

      if (containerRef.current && !appRef.current) {
        containerRef.current.appendChild(app.canvas as HTMLCanvasElement)
        appRef.current = app

        // Create container for points
        const pointsContainer = new PIXI.Container()
        app.stage.addChild(pointsContainer)
        pointsContainerRef.current = pointsContainer
      }
    }

    initApp()

    return () => {
      if (appRef.current) {
        appRef.current.destroy(true, { children: true })
        appRef.current = null
        pointsContainerRef.current = null
      }
    }
  }, []) // Only run once on mount

  // Update canvas size
  useEffect(() => {
    if (appRef.current && width > 0 && height > 0) {
      appRef.current.renderer.resize(width, height)
    }
  }, [width, height])

  // Render points
  useEffect(() => {
    const container = pointsContainerRef.current
    if (!container) return

    // Clear existing points
    container.removeChildren()

    // Draw each point
    points.forEach((point) => {
      const graphics = new PIXI.Graphics()
      const x = transformX(point.x)
      const y = transformY(point.y)
      const color = getClusterColor(point.cluster)
      const isHovered = hoveredId === point.id
      const isSelected = selectedIds.has(point.id)
      const radius = isHovered ? POINT_RADIUS_HOVER : POINT_RADIUS

      // Draw outer ring if selected
      if (isSelected) {
        graphics.circle(x, y, radius + 3)
        graphics.fill({ color: 0xffffff, alpha: 0.8 })
      }

      // Draw point
      graphics.circle(x, y, radius)
      graphics.fill({ color: parseInt(color.slice(1), 16), alpha: isHovered ? 1 : 0.8 })

      // Make interactive
      graphics.eventMode = 'static'
      graphics.cursor = 'pointer'
      graphics.hitArea = new PIXI.Circle(x, y, POINT_RADIUS_HOVER)

      graphics.on('pointerover', () => {
        setHoveredId(point.id)
        onPointHover(point)
      })

      graphics.on('pointerout', () => {
        setHoveredId(null)
        onPointHover(null)
      })

      graphics.on('pointertap', () => {
        onPointClick(point)
        // Toggle selection
        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (next.has(point.id)) {
            next.delete(point.id)
          } else {
            next.add(point.id)
          }
          return next
        })
      })

      container.addChild(graphics)
    })
  }, [points, hoveredId, selectedIds, transformX, transformY, onPointHover, onPointClick])

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.(Array.from(selectedIds))
  }, [selectedIds, onSelectionChange])

  return (
    <div
      ref={containerRef}
      className="relative rounded-lg overflow-hidden"
      style={{ width, height }}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
