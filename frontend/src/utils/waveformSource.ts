export interface WaveformSourceCheckResult {
  ok: boolean
  reason?: string
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function getWaveformSourceLabel(sourceUrl: string, fallbackName?: string): string {
  if (fallbackName && fallbackName.trim()) return fallbackName.trim()

  try {
    const parsed = new URL(sourceUrl)
    const parts = parsed.pathname.split('/').filter(Boolean)
    const fileName = parts.length > 0 ? decodeSafe(parts[parts.length - 1]) : ''
    if (fileName) return fileName
  } catch {
    const normalized = sourceUrl.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    const fileName = parts.length > 0 ? decodeSafe(parts[parts.length - 1]) : ''
    if (fileName) return fileName
  }

  return sourceUrl
}

function mapMediaError(error: MediaError | null): string {
  if (!error) return 'unknown media error'
  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'load aborted'
    case MediaError.MEDIA_ERR_NETWORK:
      return 'network error while loading audio'
    case MediaError.MEDIA_ERR_DECODE:
      return 'audio decode error (unsupported or corrupted file)'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'audio source not supported or missing'
    default:
      return error.message || 'unknown media error'
  }
}

export function buildWaveformAccessMessage(fileLabel: string, reason: string): string {
  return `File "${fileLabel}" couldn't be loaded for waveform preview (${reason}).`
}

export async function checkWaveformSourceAccessible(
  sourceUrl: string,
  timeoutMs = 8000
): Promise<WaveformSourceCheckResult> {
  return new Promise((resolve) => {
    const audio = new Audio()
    let done = false

    const finish = (result: WaveformSourceCheckResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audio.removeEventListener('loadedmetadata', onReady)
      audio.removeEventListener('canplay', onReady)
      audio.removeEventListener('error', onError)
      resolve(result)
    }

    const onReady = () => finish({ ok: true })
    const onError = () => finish({ ok: false, reason: mapMediaError(audio.error) })

    const timer = window.setTimeout(() => {
      finish({ ok: false, reason: 'timed out while checking audio source' })
    }, timeoutMs)

    audio.preload = 'metadata'
    audio.addEventListener('loadedmetadata', onReady, { once: true })
    audio.addEventListener('canplay', onReady, { once: true })
    audio.addEventListener('error', onError, { once: true })
    audio.src = sourceUrl
    audio.load()
  })
}

/** Maximum number of bars rendered per canvas, regardless of canvas width or zoom level. */
export const MAX_BARS = 800

/**
 * Fraction of the viewport width pre-rendered on each side as an overscan buffer.
 * e.g. 0.2 means 20% extra bars are computed and stored beyond each canvas edge so
 * that panning reveals pre-faded bars rather than popping them in.
 */
export const OVERSCAN_FACTOR = 0.2

/**
 * Draw waveform bars for a specific viewport window of a longer peaks array.
 *
 * Renders exactly MAX_BARS bars across the visible viewport, downsampling when zoomed
 * out and interpolating when zoomed in. Overscan extends the peak lookup range by
 * overscanFactor on each side so barOpacities are pre-warmed for adjacent bars —
 * those overscan bars are tracked in the opacities array but never drawn.
 *
 * The canvas element should have its width/height set in physical pixels (devicePixelRatio)
 * before calling this function.
 */
export function drawViewportWaveform(
  canvas: HTMLCanvasElement,
  allPeaks: number[],
  totalDuration: number,
  viewportStart: number,
  viewportEnd: number,
  currentTime: number,
  opts: {
    waveColor?: string
    progressColor?: string
    cursorColor?: string
    barWidth?: number
    barGap?: number
    overscanFactor?: number
  } = {}
): void {
  if (!allPeaks.length || totalDuration <= 0 || viewportEnd <= viewportStart) return

  const {
    waveColor = '#4f46e5',
    progressColor = '#818cf8',
    cursorColor = '#f59e0b',
    barWidth = 2,
    barGap = 1,
    overscanFactor = OVERSCAN_FACTOR,
  } = opts

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  const stride = barWidth + barGap
  // Bars that fit in the visible canvas, capped at MAX_BARS
  const visibleBarCount = Math.min(Math.floor(w / stride), MAX_BARS)
  if (visibleBarCount <= 0) return

  const viewportDuration = viewportEnd - viewportStart
  const secsPerBar = viewportDuration / visibleBarCount

  // Overscan: extra bars beyond each edge, tracked in barOpacities but not drawn
  const overscanBars = Math.ceil(visibleBarCount * overscanFactor)
  // Total slots needed: overscan-left + visible + overscan-right
  const totalSlots = overscanBars + visibleBarCount + overscanBars

  const progressX = (currentTime - viewportStart) / viewportDuration * w

  for (let i = 0; i < totalSlots; i++) {
    const barOffset = i - overscanBars  // negative = left of viewport
    const barTime = viewportStart + (barOffset + 0.5) * secsPerBar
    if (barTime < 0 || barTime > totalDuration) continue

    const isVisible = barOffset >= 0 && barOffset < visibleBarCount
    if (!isVisible) continue

    // Sample peak at barTime via linear interpolation into allPeaks
    const peakT = (barTime / totalDuration) * (allPeaks.length - 1)
    const lo = Math.floor(peakT)
    const hi = Math.min(lo + 1, allPeaks.length - 1)
    const amp = allPeaks[lo] + (allPeaks[hi] - allPeaks[lo]) * (peakT - lo)
    const barHeight = Math.max(2, amp * h * 0.9)

    const x = barOffset * stride
    const y = (h - barHeight) / 2

    ctx.fillStyle = x < progressX ? progressColor : waveColor
    ctx.fillRect(x, y, barWidth, barHeight)
  }

  ctx.globalAlpha = 1

  // Playhead cursor
  if (progressX > 0 && progressX < w) {
    ctx.fillStyle = cursorColor
    ctx.fillRect(Math.floor(progressX), 0, 2, h)
  }
}

/**
 * Draw waveform bars onto a Canvas element.
 * Used by SliceWaveform, WaveformMinimap, and useCompactWaveform.
 * Bar count is capped at MAX_BARS. No overscan — use drawViewportWaveform for that.
 *
 * The canvas element should have its width/height set in physical pixels (devicePixelRatio)
 * before calling this function.
 */
export function drawWaveformBars(
  canvas: HTMLCanvasElement,
  peaks: number[],
  currentTime: number,
  duration: number,
  opts: {
    waveColor?: string
    progressColor?: string
    cursorColor?: string
    barWidth?: number
    barGap?: number
    /** Max bars to render. Defaults to MAX_BARS. */
    maxBars?: number
  } = {}
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const {
    waveColor = '#4f46e5',
    progressColor = '#818cf8',
    cursorColor = '#f59e0b',
    barWidth = 2,
    barGap = 1,
    maxBars = MAX_BARS,
  } = opts

  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  const stride = barWidth + barGap
  const barCount = Math.min(Math.floor(w / stride), maxBars)
  if (barCount <= 0) return

  const progressX = duration > 0 ? (currentTime / duration) * w : 0

  for (let i = 0; i < barCount; i++) {
    const t = (i / Math.max(barCount - 1, 1)) * (peaks.length - 1)
    const lo = Math.floor(t)
    const hi = Math.min(lo + 1, peaks.length - 1)
    const amp = peaks[lo] + (peaks[hi] - peaks[lo]) * (t - lo)
    const barHeight = Math.max(2, amp * h * 0.9)
    const x = i * stride
    const y = (h - barHeight) / 2

    ctx.fillStyle = x < progressX ? progressColor : waveColor
    ctx.fillRect(x, y, barWidth, barHeight)
  }

  // Playhead cursor
  if (duration > 0 && progressX > 0 && progressX < w) {
    ctx.fillStyle = cursorColor
    ctx.fillRect(Math.floor(progressX), 0, 2, h)
  }
}
