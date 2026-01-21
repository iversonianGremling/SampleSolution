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

const POINT_RADIUS = 4
const POINT_RADIUS_HOVER = 8
const GLOW_RADIUS = 20
const GLOW_RADIUS_HOVER = 32
const PADDING = 40

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
  width,
  height,
}: WebGLScatterProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const pointsContainerRef = useRef<PIXI.Container | null>(null)
  const glowsContainerRef = useRef<PIXI.Container | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const audioRef = useRef<HTMLAudioElement | null>(null)
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

    const app = new PIXI.Application()

    const initApp = async () => {
      await app.init({
        width,
        height,
        backgroundColor: 0x0f1419, // Very dark navy/black
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      })

      if (containerRef.current && !appRef.current) {
        containerRef.current.appendChild(app.canvas as HTMLCanvasElement)
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
  }, []) // Only run once on mount

  // Update canvas size
  useEffect(() => {
    if (appRef.current && width > 0 && height > 0) {
      appRef.current.renderer.resize(width, height)
    }
  }, [width, height])

  // Play audio on hover
  const playAudio = useCallback((point: SamplePoint) => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    const audio = new Audio(`/api/slices/${point.id}/download`)
    audio.volume = 0.5
    audio.play().catch(() => {
      // Silently fail if audio can't play
    })
    audioRef.current = audio
  }, [])

  // Render points with glows
  useEffect(() => {
    const container = pointsContainerRef.current
    const glowsContainer = glowsContainerRef.current
    if (!container || !glowsContainer || !starTextureRef.current) return

    // Clear existing points and glows
    container.removeChildren()
    glowsContainer.removeChildren()

    // Draw each point
    points.forEach((point) => {
      const x = transformX(point.x)
      const y = transformY(point.y)
      const colorHex = getClusterColor(point.cluster)
      const colorInt = parseInt(colorHex.slice(1), 16)
      const isHovered = hoveredId === point.id
      const isSelected = selectedIds.has(point.id)

      // Draw glow layer (sprite with radial gradient)
      const glowSprite = new PIXI.Sprite(starTextureRef.current!)
      glowSprite.x = x - GLOW_RADIUS
      glowSprite.y = y - GLOW_RADIUS
      glowSprite.width = isHovered ? GLOW_RADIUS_HOVER * 2 : GLOW_RADIUS * 2
      glowSprite.height = isHovered ? GLOW_RADIUS_HOVER * 2 : GLOW_RADIUS * 2
      glowSprite.tint = colorInt
      glowSprite.alpha = isHovered ? 0.6 : 0.3
      glowsContainer.addChild(glowSprite)

      // Draw bright center point
      const graphics = new PIXI.Graphics()
      const radius = isHovered ? POINT_RADIUS_HOVER : POINT_RADIUS

      // Outer ring if selected
      if (isSelected) {
        graphics.circle(x, y, radius + 2)
        graphics.fill({ color: 0xffffff, alpha: 1 })
      }

      // Core bright point
      graphics.circle(x, y, radius)
      graphics.fill({ color: colorInt, alpha: 1 })

      // Make interactive
      graphics.eventMode = 'static'
      graphics.cursor = 'pointer'
      graphics.hitArea = new PIXI.Circle(x, y, Math.max(POINT_RADIUS_HOVER, GLOW_RADIUS_HOVER / 2))

      graphics.on('pointerover', () => {
        setHoveredId(point.id)
        onPointHover(point)
        // Play audio on hover
        playAudio(point)
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
  }, [points, hoveredId, selectedIds, transformX, transformY, onPointHover, onPointClick, playAudio])

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.(Array.from(selectedIds))
  }, [selectedIds, onSelectionChange])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative rounded-lg overflow-hidden"
      style={{ width, height }}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
