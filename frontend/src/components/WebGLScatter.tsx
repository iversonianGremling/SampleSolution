import { useRef, useEffect, useState, useCallback } from 'react'
import * as PIXI from 'pixi.js'
import type { SamplePoint } from '../types'
import { getClusterColor } from '../hooks/useClustering'
import AudioManager from '../services/AudioManager'

interface WebGLScatterProps {
  points: SamplePoint[]
  onPointHover: (point: SamplePoint | null) => void
  onPointClick: (point: SamplePoint) => void
  onSelectionChange?: (selectedIds: number[]) => void
  onPointSelect?: (point: SamplePoint | null) => void
  width: number
  height: number
}

const POINT_RADIUS = 4
const POINT_RADIUS_HOVER = 8
const GLOW_RADIUS = 20
const GLOW_RADIUS_HOVER = 32
const PADDING = 40
const MIN_POINT_DISTANCE = 25 // Minimum pixel distance between points

// Apply minimum distance spreading to prevent point clustering
function applyMinimumDistance(points: SamplePoint[], minDistance: number): SamplePoint[] {
  if (points.length === 0) return points

  // Create a map of screen positions to point groups
  const positionMap = new Map<string, SamplePoint[]>()

  points.forEach((point) => {
    const key = `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`
    if (!positionMap.has(key)) {
      positionMap.set(key, [])
    }
    positionMap.get(key)!.push(point)
  })

  // Spread out points that are too close together
  const spreadPoints: SamplePoint[] = []

  positionMap.forEach((group) => {
    if (group.length === 1) {
      spreadPoints.push(group[0])
      return
    }

    // Calculate mean position
    const meanX = group.reduce((sum, p) => sum + p.x, 0) / group.length
    const meanY = group.reduce((sum, p) => sum + p.y, 0) / group.length

    // Arrange points in a circle around the mean position
    const angleStep = (Math.PI * 2) / group.length
    const radius = minDistance / 2

    group.forEach((point, index) => {
      const angle = angleStep * index
      const offsetX = Math.cos(angle) * radius
      const offsetY = Math.sin(angle) * radius

      spreadPoints.push({
        ...point,
        x: meanX + offsetX,
        y: meanY + offsetY,
      })
    })
  })

  return spreadPoints
}

// Create a glowing star texture
function createStarTexture(): PIXI.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')!

  // Draw radial gradient glow
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)')
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)

  // Draw bright center point
  ctx.fillStyle = 'rgba(255, 255, 255, 1)'
  ctx.fillRect(30, 30, 4, 4)

  return PIXI.Texture.from(canvas)
}

export function WebGLScatter({
  points,
  onPointHover,
  onPointClick,
  onSelectionChange,
  onPointSelect,
  width,
  height,
}: WebGLScatterProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const pointsContainerRef = useRef<PIXI.Container | null>(null)
  const glowsContainerRef = useRef<PIXI.Container | null>(null)
  const pointGraphicsRef = useRef<Map<number, PIXI.Graphics>>(new Map())
  const glowSpritesRef = useRef<Map<number, PIXI.Sprite>>(new Map())
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const audioManagerRef = useRef<AudioManager>(AudioManager.getInstance())
  const starTextureRef = useRef<PIXI.Texture | null>(null)

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

    const initApp = async () => {
      try {
        const app = new PIXI.Application()
        const dpr = window.devicePixelRatio || 1

        await app.init({
          width: Math.floor(width * dpr),
          height: Math.floor(height * dpr),
          backgroundColor: 0x0f1419, // Very dark navy/black
          antialias: true,
          resolution: 1,
          autoDensity: false,
        })

        if (containerRef.current && !appRef.current) {
          const canvas = app.canvas as HTMLCanvasElement
          canvas.style.display = 'block'
          canvas.style.width = '100%'
          canvas.style.height = '100%'
          containerRef.current.appendChild(canvas)
          appRef.current = app

          // Create container for glows (behind points)
          const glowsContainer = new PIXI.Container()
          app.stage.addChild(glowsContainer)
          glowsContainerRef.current = glowsContainer

          // Create container for points (on top)
          const pointsContainer = new PIXI.Container()
          app.stage.addChild(pointsContainer)
          pointsContainerRef.current = pointsContainer

          // Create star texture once
          starTextureRef.current = createStarTexture()
        }
      } catch (error) {
        console.error('Failed to initialize PixiJS:', error)
        if (containerRef.current) {
          containerRef.current.innerHTML = '<div style="padding: 20px; color: #ef4444; text-align: center;">WebGL not supported. Please update your browser or enable hardware acceleration.</div>'
        }
      }
    }

    initApp()

    return () => {
      if (appRef.current) {
        appRef.current.destroy(true, { children: true })
        appRef.current = null
        pointsContainerRef.current = null
        glowsContainerRef.current = null
      }
      if (starTextureRef.current) {
        starTextureRef.current.destroy()
        starTextureRef.current = null
      }
    }
  }, [width, height]) // Re-initialize when dimensions change

  // Update canvas size and reposition points when dimensions change
  useEffect(() => {
    if (appRef.current && width > 0 && height > 0) {
      const dpr = window.devicePixelRatio || 1
      appRef.current.renderer.resize(Math.floor(width * dpr), Math.floor(height * dpr))
      const canvas = appRef.current.canvas as HTMLCanvasElement
      canvas.style.width = '100%'
      canvas.style.height = '100%'

      // Reposition all existing points when canvas resizes
      pointGraphicsRef.current.forEach((graphics, pointId) => {
        const point = points.find((p) => p.id === pointId)
        if (!point) return

        const x = transformX(point.x)
        const y = transformY(point.y)

        // Update hitArea position
        graphics.hitArea = new PIXI.Circle(x, y, Math.max(POINT_RADIUS_HOVER, GLOW_RADIUS_HOVER / 2))

        // Update glow position
        const glowSprite = glowSpritesRef.current.get(pointId)
        if (glowSprite) {
          const isHovered = hoveredId === pointId
          const currentGlowRadius = isHovered ? GLOW_RADIUS_HOVER : GLOW_RADIUS
          glowSprite.x = x
          glowSprite.y = y
          glowSprite.width = currentGlowRadius * 2
          glowSprite.height = currentGlowRadius * 2
        }

        // Redraw point at new position
        const isSelected = selectedIds.has(pointId)
        const isHovered = hoveredId === pointId
        const radius = isHovered ? POINT_RADIUS_HOVER : POINT_RADIUS
        const colorHex = getClusterColor(point.cluster)
        const colorInt = parseInt(colorHex.slice(1), 16)

        graphics.clear()
        if (isSelected) {
          graphics.circle(x, y, radius + 2)
          graphics.fill({ color: 0xffffff, alpha: 1 })
        }
        graphics.circle(x, y, radius)
        graphics.fill({ color: colorInt, alpha: 1 })
      })
    }
  }, [width, height, points, transformX, transformY, hoveredId, selectedIds])

  // Play audio on hover only (conservative - one audio at a time)
  const playAudio = useCallback((point: SamplePoint) => {
    const audioManager = audioManagerRef.current

    // If already playing audio for this point, don't retrigger
    if (audioManager.isPlayingId(point.id)) {
      return
    }

    audioManager.play(point.id, `/api/slices/${point.id}/download`, { volume: 1 })
  }, [])

  // Initialize points on mount or when points array changes
  useEffect(() => {
    const container = pointsContainerRef.current
    const glowsContainer = glowsContainerRef.current
    if (!container || !glowsContainer || !starTextureRef.current) return

    // Clear existing points and glows only on points change
    container.removeChildren()
    glowsContainer.removeChildren()
    pointGraphicsRef.current.clear()
    glowSpritesRef.current.clear()

    // Apply minimum distance spacing to prevent overlapping points
    const spreadPoints = applyMinimumDistance(points, MIN_POINT_DISTANCE)

    // Create graphics objects for each point (only once)
    spreadPoints.forEach((point) => {
      const x = transformX(point.x)
      const y = transformY(point.y)
      const colorHex = getClusterColor(point.cluster)
      const colorInt = parseInt(colorHex.slice(1), 16)

      // Create glow sprite
      const glowSprite = new PIXI.Sprite(starTextureRef.current!)
      glowSprite.anchor.set(0.5, 0.5)
      glowSprite.tint = colorInt
      glowSprite.x = x
      glowSprite.y = y
      glowSprite.width = GLOW_RADIUS * 2
      glowSprite.height = GLOW_RADIUS * 2
      glowSprite.alpha = 0.3
      glowsContainer.addChild(glowSprite)
      glowSpritesRef.current.set(point.id, glowSprite)

      // Create graphics for point
      const graphics = new PIXI.Graphics()
      graphics.eventMode = 'static'
      graphics.cursor = 'pointer'
      graphics.hitArea = new PIXI.Circle(x, y, Math.max(POINT_RADIUS_HOVER, GLOW_RADIUS_HOVER / 2))

      graphics.on('pointerover', () => {
        setHoveredId(point.id)
        onPointHover(point)
        playAudio(point)
      })

      graphics.on('pointerout', () => {
        setHoveredId(null)
        onPointHover(null)
      })

      graphics.on('pointertap', () => {
        audioManagerRef.current.stopAll()
        setHoveredId(null)
        onPointHover(null)
        onPointSelect?.(point)
        onPointClick(point)
        setSelectedIds(new Set([point.id]))
      })

      container.addChild(graphics)
      pointGraphicsRef.current.set(point.id, graphics)
    })
  }, [points, transformX, transformY, onPointHover, onPointClick, onPointSelect, playAudio])

  // Update visual state only when hover/selection changes (efficient!)
  useEffect(() => {
    pointGraphicsRef.current.forEach((graphics, pointId) => {
      const point = points.find((p) => p.id === pointId)
      if (!point) return

      const x = transformX(point.x)
      const y = transformY(point.y)
      const colorHex = getClusterColor(point.cluster)
      const colorInt = parseInt(colorHex.slice(1), 16)
      const isHovered = hoveredId === pointId
      const isSelected = selectedIds.has(pointId)
      const radius = isHovered ? POINT_RADIUS_HOVER : POINT_RADIUS

      // Redraw graphics
      graphics.clear()

      // Outer ring if selected
      if (isSelected) {
        graphics.circle(x, y, radius + 2)
        graphics.fill({ color: 0xffffff, alpha: 1 })
      }

      // Core bright point
      graphics.circle(x, y, radius)
      graphics.fill({ color: colorInt, alpha: 1 })

      // Update glow
      const glowSprite = glowSpritesRef.current.get(pointId)
      if (glowSprite) {
        const currentGlowRadius = isHovered ? GLOW_RADIUS_HOVER : GLOW_RADIUS
        glowSprite.x = x
        glowSprite.y = y
        glowSprite.width = currentGlowRadius * 2
        glowSprite.height = currentGlowRadius * 2
        glowSprite.alpha = isHovered ? 0.6 : 0.3
      }
    })
  }, [hoveredId, selectedIds, points, transformX, transformY])

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.(Array.from(selectedIds))
  }, [selectedIds, onSelectionChange])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      audioManagerRef.current.stopAll()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative rounded-lg overflow-hidden w-full h-full"
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
