import { useRef, useEffect, useState, useCallback } from 'react'
import 'pixi.js/unsafe-eval'
import * as PIXI from 'pixi.js'
import { RefreshCw } from 'lucide-react'
import type { SamplePoint } from '../types'
import { getClusterColor } from '../hooks/useClustering'
import AudioManager from '../services/AudioManager'

interface WebGLScatterProps {
  points: SamplePoint[]
  onPointHover: (point: SamplePoint | null) => void
  onPointClick: (point: SamplePoint) => void
  getPointPlaybackRate?: (point: SamplePoint) => number
  preparePointPlayback?: (point: SamplePoint) => Promise<{ url: string; playbackRate: number }>
  onSelectionChange?: (selectedIds: number[]) => void
  onPointSelect?: (point: SamplePoint | null) => void
  selectedId?: number | null
  width: number
  height: number
}

const POINT_RADIUS = 1.5
const POINT_RADIUS_HOVER = 5
const PADDING = 64 // 4rem padding from edges
const MIN_POINT_DISTANCE = 25

// Animation constants
const ANIMATION_DURATION = 500
const ENTER_ANIMATION_DURATION = 400

// Easing function
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// Create plain solid color circle texture with 2x resolution for anti-aliasing
function createCircleTexture(radius: number, color: number): PIXI.Texture {
  const size = radius * 2
  const canvas = document.createElement('canvas')
  const scale = 2
  canvas.width = size * scale
  canvas.height = size * scale
  const ctx = canvas.getContext('2d', { alpha: true })!

  ctx.scale(scale, scale)
  ctx.clearRect(0, 0, size, size)

  // Convert color int to RGB
  const r = (color >> 16) & 0xff
  const g = (color >> 8) & 0xff
  const b = color & 0xff

  // Plain solid color circle - no gradients, no highlights
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
  ctx.beginPath()
  ctx.arc(radius, radius, radius, 0, Math.PI * 2)
  ctx.fill()

  return PIXI.Texture.from(canvas)
}

// Check if points array has actually changed (not just new reference)
function pointsChanged(oldPoints: SamplePoint[], newPoints: SamplePoint[]): boolean {
  if (oldPoints.length !== newPoints.length) return true
  const oldIds = new Set(oldPoints.map((p) => p.id))
  const newIds = new Set(newPoints.map((p) => p.id))
  if (oldIds.size !== newIds.size) return true

  for (const id of oldIds) {
    if (!newIds.has(id)) return true
  }

  for (const newPoint of newPoints) {
    const oldPoint = oldPoints.find((p) => p.id === newPoint.id)
    if (!oldPoint || oldPoint.x !== newPoint.x || oldPoint.y !== newPoint.y || oldPoint.cluster !== newPoint.cluster) {
      return true
    }
  }

  return false
}

// Apply minimum distance spreading to prevent point clustering
// Note: minDistance should be in normalized coordinates (0-2 range, since coords are -1 to 1)
function applyMinimumDistance(points: SamplePoint[], minDistance: number): SamplePoint[] {
  if (points.length === 0) return points

  const positionMap = new Map<string, SamplePoint[]>()

  points.forEach((point) => {
    const key = `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`
    if (!positionMap.has(key)) {
      positionMap.set(key, [])
    }
    positionMap.get(key)!.push(point)
  })

  const spreadPoints: SamplePoint[] = []

  positionMap.forEach((group) => {
    if (group.length === 1) {
      spreadPoints.push(group[0])
      return
    }

    const meanX = group.reduce((sum, p) => sum + p.x, 0) / group.length
    const meanY = group.reduce((sum, p) => sum + p.y, 0) / group.length
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

// Helper to check if two Sets are equal
function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) {
    if (!b.has(item)) return false
  }
  return true
}

// Interface for sprite data tracking
interface PointSpriteData {
  sprite: PIXI.Sprite
  point: SamplePoint
  screenX: number
  screenY: number
  currentRadius: number
  selectionRing: PIXI.Graphics | null
  textures: { normal: PIXI.Texture; hover: PIXI.Texture } // Store textures to prevent recoloring
}

// Interface for animation state
interface PointAnimationState {
  pointId: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  fromScale: number
  toScale: number
  fromAlpha: number
  toAlpha: number
  point: SamplePoint | null // null for exit animations
  duration: number
}

// Global texture cache
const textureCache = new Map<
  string,
  {
    normal: PIXI.Texture | null
    hover: PIXI.Texture | null
  }
>()

// Fallback white textures in case creation fails
let fallbackTextures: { normal: PIXI.Texture; hover: PIXI.Texture } | null = null

function getFallbackTextures(): { normal: PIXI.Texture; hover: PIXI.Texture } {
  if (!fallbackTextures) {
    try {
      fallbackTextures = {
        normal: createCircleTexture(POINT_RADIUS, 0xffffff),
        hover: createCircleTexture(POINT_RADIUS_HOVER, 0xffffff),
      }
    } catch (e) {
      // If even fallback fails, create minimal white texture
      console.error('Failed to create fallback textures:', e)
      fallbackTextures = {
        normal: PIXI.Texture.WHITE,
        hover: PIXI.Texture.WHITE,
      }
    }
  }
  return fallbackTextures
}

function getOrCreateTextures(colorHex: string): { normal: PIXI.Texture; hover: PIXI.Texture } {
  if (!textureCache.has(colorHex)) {
    const colorInt = parseInt(colorHex.slice(1), 16)
    try {
      const normalTexture = createCircleTexture(POINT_RADIUS, colorInt)
      const hoverTexture = createCircleTexture(POINT_RADIUS_HOVER, colorInt)

      // If textures are null, use fallback
      if (!normalTexture || !hoverTexture) {
        const fallback = getFallbackTextures()
        textureCache.set(colorHex, {
          normal: normalTexture || fallback.normal,
          hover: hoverTexture || fallback.hover,
        })
      } else {
        textureCache.set(colorHex, {
          normal: normalTexture,
          hover: hoverTexture,
        })
      }
    } catch (e) {
      console.error(`Failed to create textures for color ${colorHex}:`, e)
      const fallback = getFallbackTextures()
      textureCache.set(colorHex, {
        normal: fallback.normal,
        hover: fallback.hover,
      })
    }
  }
  const cached = textureCache.get(colorHex)
  if (!cached || !cached.normal || !cached.hover) {
    return getFallbackTextures()
  }
  return cached as { normal: PIXI.Texture; hover: PIXI.Texture }
}

export function WebGLScatter({
  points,
  onPointHover,
  onPointClick,
  getPointPlaybackRate,
  preparePointPlayback,
  onSelectionChange,
  onPointSelect,
  selectedId,
  width,
  height,
}: WebGLScatterProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const pointsContainerRef = useRef<PIXI.Container | null>(null)
  const pointSpritesRef = useRef<Map<number, PointSpriteData>>(new Map())
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [resizeCounter, setResizeCounter] = useState(0)
  const [actualContainerSize, setActualContainerSize] = useState({ width, height })
  const [appReadyVersion, setAppReadyVersion] = useState(0)
  const [refreshCounter, setRefreshCounter] = useState(0)
  const audioManagerRef = useRef<AudioManager>(AudioManager.getInstance())
  const hoverPlaybackRequestRef = useRef(0)

  // Animation refs
  const animationStateRef = useRef<Map<number, PointAnimationState>>(new Map())
  const animationStartTimeRef = useRef<number>(0)
  const animationRef = useRef<number | null>(null)
  const previousPointsRef = useRef<SamplePoint[]>([])
  const lastMouseEventRef = useRef<MouseEvent | null>(null)
  const previousResizeCountRef = useRef<number>(0)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialWidthRef = useRef(width)
  const initialHeightRef = useRef(height)

  // Dirty tracking for optimization - never overdraw
  const previousHoverRef = useRef<number | null>(null)
  const previousSelectionRef = useRef<Set<number>>(new Set())

  // Transform coordinates from -1..1 to screen space using full available panel area.
  // Keep edge padding so points never touch container borders.
  const transformX = useCallback(
    (x: number) => {
      const contentWidth = Math.max(1, actualContainerSize.width - PADDING * 2)
      return PADDING + ((x + 1) / 2) * contentWidth
    },
    [actualContainerSize]
  )
  const transformY = useCallback(
    (y: number) => {
      const contentHeight = Math.max(1, actualContainerSize.height - PADDING * 2)
      return PADDING + ((1 - y) / 2) * contentHeight
    },
    [actualContainerSize]
  )

  const resizeRenderer = useCallback((targetWidth: number, targetHeight: number) => {
    const app = appRef.current
    if (!app) return

    const safeWidth = Math.max(1, Math.round(targetWidth))
    const safeHeight = Math.max(1, Math.round(targetHeight))
    const rendererWidth = Math.round(app.renderer.width)
    const rendererHeight = Math.round(app.renderer.height)

    if (rendererWidth === safeWidth && rendererHeight === safeHeight) return

    setActualContainerSize((prev) =>
      prev.width === safeWidth && prev.height === safeHeight ? prev : { width: safeWidth, height: safeHeight }
    )
    app.renderer.resize(safeWidth, safeHeight)
    setResizeCounter((prev) => prev + 1)
    app.render()
  }, [])

  // Initialize PIXI application
  useEffect(() => {
    if (!containerRef.current) return
    let isDisposed = false

    const initApp = async () => {
      try {
        // Get actual container dimensions
        const rect = containerRef.current!.getBoundingClientRect()
        const containerWidth = Math.max(1, Math.round(rect.width) || initialWidthRef.current || 1)
        const containerHeight = Math.max(1, Math.round(rect.height) || initialHeightRef.current || 1)

        // Debug: test raw WebGL context creation
        const testCanvas = document.createElement('canvas')
        const testGl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl')
        console.log('[WebGLScatter] Raw WebGL context test:', testGl ? 'OK' : 'FAILED')
        if (testGl) {
          const dbg = testGl.getExtension('WEBGL_debug_renderer_info')
          console.log('[WebGLScatter] Renderer:', dbg ? testGl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : testGl.getParameter(testGl.RENDERER))
        }
        console.log('[WebGLScatter] Container size:', containerWidth, 'x', containerHeight)

        const app = new PIXI.Application()
        const dpr = Math.min(window.devicePixelRatio || 1, 2) // Cap at 2x for performance

        await app.init({
          preference: 'webgl', // Force WebGL (WebGPU fallback is broken in some Electron/Linux setups)
          width: containerWidth,
          height: containerHeight,
          backgroundColor: 0x0a0b0e, // Match surface-base
          antialias: true,
          resolution: dpr, // Set ONCE, never change
          autoDensity: true,
          roundPixels: true, // NEW: Snap to pixel boundaries
          powerPreference: 'high-performance', // NEW: GPU preference
        })
        console.log('[WebGLScatter] PixiJS init SUCCESS, renderer type:', app.renderer.type)

        if (isDisposed) {
          app.destroy(true, { children: true })
          return
        }

        if (containerRef.current && !appRef.current) {
          const canvas = app.canvas as HTMLCanvasElement
          canvas.style.display = 'block'
          canvas.style.width = '100%'
          canvas.style.height = '100%'
          canvas.style.imageRendering = 'crisp-edges'
          containerRef.current.appendChild(canvas)
          appRef.current = app

          // Create container for points
          const pointsContainer = new PIXI.Container()
          app.stage.addChild(pointsContainer)
          pointsContainerRef.current = pointsContainer
          setAppReadyVersion((prev) => prev + 1)
          setActualContainerSize({ width: containerWidth, height: containerHeight })
          setResizeCounter((prev) => prev + 1)
        }
      } catch (error) {
        console.error('Failed to initialize PixiJS:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (containerRef.current) {
          containerRef.current.innerHTML =
            `<div style="padding: 20px; color: #ef4444; text-align: center;">
              <div style="font-weight: bold; margin-bottom: 8px;">WebGL initialization failed</div>
              <div style="font-size: 12px; opacity: 0.8;">${errorMessage}</div>
              <div style="font-size: 11px; opacity: 0.6; margin-top: 8px;">Check the console for details</div>
            </div>`
        }
      }
    }

    initApp()

    return () => {
      isDisposed = true
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      animationStateRef.current.clear()
      pointSpritesRef.current.clear()
      previousPointsRef.current = []
      previousResizeCountRef.current = 0
      if (appRef.current) {
        appRef.current.destroy(true, { children: true })
        appRef.current = null
        pointsContainerRef.current = null
      }
    }
  }, [])

  // Update canvas size when dimensions change (with debounce)
  useEffect(() => {
    if (width <= 0 || height <= 0) return

    const timer = setTimeout(() => {
      resizeRenderer(width, height)
    }, 100) // Debounce resize updates

    return () => clearTimeout(timer)
  }, [appReadyVersion, width, height, resizeRenderer])

  // Observe container size changes and trigger PIXI rerender on grace period
  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver(() => {
      // Clear existing timer
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current)
      }

      // Set new timer with 300ms grace period
      resizeTimerRef.current = setTimeout(() => {
        const app = appRef.current
        if (!app || !containerRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        const newWidth = Math.round(rect.width)
        const newHeight = Math.round(rect.height)

        if (newWidth > 0 && newHeight > 0) {
          resizeRenderer(newWidth, newHeight)
        }

        resizeTimerRef.current = null
      }, 300)
    })

    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current)
      }
    }
  }, [resizeRenderer])

  // Check if cursor is over a menu element
  const isOverMenu = useCallback((): boolean => {
    const mouseEvent = lastMouseEventRef.current
    if (!mouseEvent) return false

    // Check if any panel surface is being hovered
    const menuElements = document.querySelectorAll('.panel-surface')
    for (const element of menuElements) {
      const rect = element.getBoundingClientRect()
      if (
        mouseEvent.clientX >= rect.left &&
        mouseEvent.clientX <= rect.right &&
        mouseEvent.clientY >= rect.top &&
        mouseEvent.clientY <= rect.bottom
      ) {
        return true
      }
    }
    return false
  }, [])

  // Play audio on hover
  const playAudio = useCallback(
    (point: SamplePoint) => {
      const audioManager = audioManagerRef.current
      if (audioManager.isPlayingId(point.id)) {
        return
      }
      // Only play if cursor is not over a menu element
      if (!isOverMenu()) {
        if (preparePointPlayback) {
          const requestId = ++hoverPlaybackRequestRef.current
          void (async () => {
            try {
              const { url, playbackRate } = await preparePointPlayback(point)
              if (requestId !== hoverPlaybackRequestRef.current) return
              audioManager.play(point.id, url, { volume: 1, playbackRate })
            } catch (error) {
              console.error('Failed to prepare hover preview playback:', error)
            }
          })()
          return
        }
        const playbackRate = getPointPlaybackRate?.(point)
        audioManager.play(point.id, `/api/slices/${point.id}/download`, { volume: 1, playbackRate })
      }
    },
    [getPointPlaybackRate, isOverMenu, preparePointPlayback]
  )

  // Track mouse position for menu detection
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      lastMouseEventRef.current = event
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  // Helper to update sprite visuals
  const updateSpriteVisual = useCallback(
    (
      spriteData: PointSpriteData,
      x: number,
      y: number,
      scale: number,
      alpha: number,
      point: SamplePoint,
      isHovered: boolean,
      isSelected: boolean
    ) => {
      // Early exit if sprite is invalid
      if (!spriteData.sprite || !spriteData.sprite.position) {
        return
      }

      // Update point reference (in case data changed)
      spriteData.point = point

      // Use the stored textures to prevent recoloring
      const textures = spriteData.textures

      // Only update texture if textures are valid
      if (textures && textures.hover && textures.normal) {
        spriteData.sprite.texture = isHovered ? textures.hover : textures.normal
      }

      spriteData.sprite.position.set(x, y)
      spriteData.sprite.scale.set(scale)
      spriteData.sprite.alpha = alpha
      spriteData.sprite.anchor.set(0.5, 0.5)

      // Update tracking data
      spriteData.screenX = x
      spriteData.screenY = y
      spriteData.currentRadius = isHovered ? POINT_RADIUS_HOVER : POINT_RADIUS

      // Selection ring (only redraw when selection state changes)
      if (isSelected && !spriteData.selectionRing) {
        const ring = new PIXI.Graphics()
        spriteData.sprite.addChild(ring)
        spriteData.selectionRing = ring
      }

      if (spriteData.selectionRing) {
        spriteData.selectionRing.clear()
        if (isSelected) {
          spriteData.selectionRing.circle(0, 0, spriteData.currentRadius + 3)
          spriteData.selectionRing.stroke({ color: 0xffffff, width: 2, alpha: 0.9 })
        }
      }
    },
    []
  )

  // Unified animation loop
  const animationLoop = useCallback(
    (currentTime: number) => {
      const elapsed = currentTime - animationStartTimeRef.current
      let allComplete = true

      animationStateRef.current.forEach((anim, pointId) => {
        const progress = Math.min(elapsed / anim.duration, 1)
        const eased = easeOutCubic(progress)

        if (progress < 1) allComplete = false

        const x = anim.fromX + (anim.toX - anim.fromX) * eased
        const y = anim.fromY + (anim.toY - anim.fromY) * eased
        const scale = anim.fromScale + (anim.toScale - anim.fromScale) * eased
        const alpha = anim.fromAlpha + (anim.toAlpha - anim.fromAlpha) * eased

        const spriteData = pointSpritesRef.current.get(pointId)

        if (spriteData && anim.point) {
          const isHovered = hoveredId === pointId
          const isSelected = selectedIds.has(pointId)
          updateSpriteVisual(spriteData, x, y, scale, alpha, anim.point, isHovered, isSelected)
        } else if (!anim.point && spriteData) {
          // Exit animation
          spriteData.sprite.position.set(x, y)
          spriteData.sprite.scale.set(scale)
          spriteData.sprite.alpha = alpha
        }
      })

      if (!allComplete) {
        animationRef.current = requestAnimationFrame(animationLoop)
      } else {
        // Animation complete - cleanup
        animationStateRef.current.forEach((anim, pointId) => {
          if (!anim.point) {
            // Was an exit animation - destroy sprite
            const spriteData = pointSpritesRef.current.get(pointId)
            if (spriteData) {
              pointsContainerRef.current?.removeChild(spriteData.sprite)
              spriteData.sprite.destroy({ children: true })
              pointSpritesRef.current.delete(pointId)
            }
          }
        })
        animationStateRef.current.clear()
        animationRef.current = null
      }
    },
    [hoveredId, selectedIds, updateSpriteVisual]
  )

  // Start animations
  const startAnimations = useCallback(
    (animations: PointAnimationState[]) => {
      // Cancel existing animation
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }

      // Clear old state and set new
      animationStateRef.current.clear()
      animations.forEach((anim) => {
        animationStateRef.current.set(anim.pointId, anim)
      })

      animationStartTimeRef.current = performance.now()
      animationRef.current = requestAnimationFrame(animationLoop)
    },
    [animationLoop]
  )

  // Main points management and animation effect
  useEffect(() => {
    const container = pointsContainerRef.current
    if (!container) return

    // Re-process points if canvas resized OR points changed
    const hasPointsChanged = pointsChanged(previousPointsRef.current, points)
    const hasResized = resizeCounter !== previousResizeCountRef.current

    if (!hasPointsChanged && !hasResized) {
      // Skip only if both points AND canvas haven't changed
      return
    }

    previousPointsRef.current = points
    previousResizeCountRef.current = resizeCounter

    // Cancel any existing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    // Apply minimum distance spacing (convert pixels to normalized coordinates).
    // Use the smaller drawable axis so spacing stays consistent when the panel is wide.
    const drawableMinAxis = Math.max(
      1,
      Math.min(actualContainerSize.width, actualContainerSize.height) - PADDING * 2,
    )
    const minDistanceNormalized = (MIN_POINT_DISTANCE / drawableMinAxis) * 2
    const spreadPoints = applyMinimumDistance(points, minDistanceNormalized)

    const currentIds = new Set(spreadPoints.map((p) => p.id))
    const previousIds = new Set(pointSpritesRef.current.keys())

    const animations: PointAnimationState[] = []
    const centerX = transformX(0)
    const centerY = transformY(0)

    // Process existing and new points
    spreadPoints.forEach((point) => {
      const existing = pointSpritesRef.current.get(point.id)
      const toX = transformX(point.x)
      const toY = transformY(point.y)

      if (existing) {
        // Check if cluster changed
        const clusterChanged = existing.point.cluster !== point.cluster

        // If cluster changed, update textures (color change during animation only)
        if (clusterChanged) {
          const colorHex = getClusterColor(point.cluster)
          existing.textures = getOrCreateTextures(colorHex)
        }

        // Move animation (if position changed)
        const dx = Math.abs(toX - existing.screenX)
        const dy = Math.abs(toY - existing.screenY)

        if (dx > 2 || dy > 2) {
          animations.push({
            pointId: point.id,
            fromX: existing.screenX,
            fromY: existing.screenY,
            toX,
            toY,
            fromScale: 1,
            toScale: 1,
            fromAlpha: 1,
            toAlpha: 1,
            point,
            duration: ANIMATION_DURATION,
          })
        } else {
          // No animation needed - update directly (but still update point data)
          existing.point = point
          const isHovered = hoveredId === point.id
          const isSelected = selectedIds.has(point.id)
          updateSpriteVisual(existing, toX, toY, 1, 1, point, isHovered, isSelected)
        }
      } else {
        // Enter animation (from center)
        // Get the initial texture for this point and store it
        const colorHex = getClusterColor(point.cluster)
        const textures = getOrCreateTextures(colorHex)

        const sprite = new PIXI.Sprite(textures.normal)
        sprite.anchor.set(0.5, 0.5)
        sprite.position.set(centerX, centerY)
        sprite.scale.set(0)
        sprite.alpha = 0
        container.addChild(sprite)

        const spriteData: PointSpriteData = {
          sprite,
          point,
          screenX: centerX,
          screenY: centerY,
          currentRadius: POINT_RADIUS,
          selectionRing: null,
          textures, // Store textures to prevent recoloring
        }
        pointSpritesRef.current.set(point.id, spriteData)

        animations.push({
          pointId: point.id,
          fromX: centerX,
          toX: toX,
          fromY: centerY,
          toY: toY,
          fromScale: 0,
          toScale: 1,
          fromAlpha: 0,
          toAlpha: 1,
          point,
          duration: ENTER_ANIMATION_DURATION,
        })
      }
    })

    // Process removed points (exit)
    previousIds.forEach((id) => {
      if (!currentIds.has(id)) {
        const existing = pointSpritesRef.current.get(id)
        if (existing) {
          animations.push({
            pointId: id,
            fromX: existing.screenX,
            toX: centerX,
            fromY: existing.screenY,
            toY: centerY,
            fromScale: 1,
            toScale: 0,
            fromAlpha: 1,
            toAlpha: 0,
            point: null, // Mark as exit
            duration: ANIMATION_DURATION,
          })
        }
      }
    })

    // Start all animations together (single animation state)
    if (animations.length > 0) {
      startAnimations(animations)
    }
  }, [points, transformX, transformY, hoveredId, selectedIds, updateSpriteVisual, startAnimations, resizeCounter, refreshCounter])

  // Container-level event handling for pixel-perfect hit detection
  useEffect(() => {
    const container = pointsContainerRef.current
    if (!container) return

    container.eventMode = 'static'
    container.hitArea = new PIXI.Rectangle(0, 0, actualContainerSize.width, actualContainerSize.height)

    let currentHoveredId: number | null = null

    const handlePointerMove = (event: PIXI.FederatedPointerEvent) => {
      // Ignore scatter hover interactions while cursor is over UI overlays.
      if (isOverMenu()) {
        if (currentHoveredId !== null) {
          hoverPlaybackRequestRef.current += 1
          currentHoveredId = null
          setHoveredId(null)
          onPointHover(null)
        }
        return
      }

      // Get mouse position in canvas space (already accounts for DPR)
      const mouseX = event.global.x
      const mouseY = event.global.y

      let closestPointId: number | null = null
      let closestDistance = Infinity

      // Find closest point within radius
      pointSpritesRef.current.forEach((data, id) => {
        const dx = mouseX - data.screenX
        const dy = mouseY - data.screenY
        const distance = Math.sqrt(dx * dx + dy * dy)

        const hitRadius = data.currentRadius + 3 // 3px tolerance for easier targeting

        if (distance <= hitRadius && distance < closestDistance) {
          closestPointId = id
          closestDistance = distance
        }
      })

      // Update hover state
      if (closestPointId !== null && closestPointId !== currentHoveredId) {
        currentHoveredId = closestPointId
        const data = pointSpritesRef.current.get(closestPointId)
        if (data) {
          setHoveredId(closestPointId)
          onPointHover(data.point)
          playAudio(data.point)
        }
      } else if (closestPointId === null && currentHoveredId !== null) {
        hoverPlaybackRequestRef.current += 1
        currentHoveredId = null
        setHoveredId(null)
        onPointHover(null)
      }
    }

    const handlePointerTap = () => {
      if (currentHoveredId !== null) {
        hoverPlaybackRequestRef.current += 1
        const data = pointSpritesRef.current.get(currentHoveredId)
        if (data) {
          audioManagerRef.current.stopAll()
          setHoveredId(null)
          onPointHover(null)
          onPointSelect?.(data.point)
          onPointClick(data.point)
          setSelectedIds(new Set([data.point.id]))
        }
      }
    }

    container.on('pointermove', handlePointerMove)
    container.on('pointertap', handlePointerTap)

    return () => {
      container.off('pointermove', handlePointerMove)
      container.off('pointertap', handlePointerTap)
    }
  }, [actualContainerSize, isOverMenu, onPointHover, onPointClick, onPointSelect, playAudio, selectedIds])

  // Update visuals when hover/selection changes (dirty tracking - never overdraw)
  useEffect(() => {
    // Skip if nothing changed
    if (hoveredId === previousHoverRef.current && setsEqual(selectedIds, previousSelectionRef.current)) {
      return
    }

    // Only update affected sprites
    const affectedIds = new Set(
      [hoveredId, previousHoverRef.current, ...Array.from(selectedIds), ...Array.from(previousSelectionRef.current)].filter(
        (id) => id !== null
      ) as number[]
    )

    affectedIds.forEach((id) => {
      const spriteData = pointSpritesRef.current.get(id)
      if (spriteData) {
        const isHovered = hoveredId === id
        const isSelected = selectedIds.has(id)
        updateSpriteVisual(
          spriteData,
          spriteData.screenX,
          spriteData.screenY,
          1,
          1,
          spriteData.point,
          isHovered,
          isSelected
        )
      }
    })

    previousHoverRef.current = hoveredId
    previousSelectionRef.current = new Set(selectedIds)
  }, [hoveredId, selectedIds, updateSpriteVisual])

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.(Array.from(selectedIds))
  }, [selectedIds, onSelectionChange])

  // Sync selection with external selectedId prop
  useEffect(() => {
    if (selectedId === undefined) return

    if (selectedId === null) {
      setSelectedIds(new Set())
    } else if (!selectedIds.has(selectedId)) {
      setSelectedIds(new Set([selectedId]))
    }
  }, [selectedId])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      hoverPlaybackRequestRef.current += 1
      audioManagerRef.current.stopAll()
    }
  }, [])

  // Force complete refresh - clear everything and redraw
  const handleRefresh = useCallback(() => {
    // Cancel any ongoing animations
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    // Clear animation state
    animationStateRef.current.clear()

    // Clear all sprites
    pointSpritesRef.current.forEach((spriteData) => {
      pointsContainerRef.current?.removeChild(spriteData.sprite)
      spriteData.sprite.destroy({ children: true })
    })
    pointSpritesRef.current.clear()

    // Reset previous points so everything is treated as new
    previousPointsRef.current = []

    // Trigger re-render
    setRefreshCounter((prev) => prev + 1)
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative rounded-lg overflow-hidden w-full h-full"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        onClick={handleRefresh}
        className="absolute top-2 left-2 p-1 text-white/60 hover:text-white transition-colors z-10"
        title="Refresh"
      >
        <RefreshCw size={16} />
      </button>
    </div>
  )
}
