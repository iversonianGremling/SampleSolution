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

/** @deprecated No longer used for bar rendering; kept for any external references. */
export const MAX_BARS = 800

/** @deprecated No longer used for bar rendering; kept for any external references. */
export const OVERSCAN_FACTOR = 0.2

// ─── Shared drawing helpers ───────────────────────────────────────────────────

/**
 * Build a smooth closed Path2D representing the waveform shape.
 * topYs and botYs are y-coordinates for the top and bottom envelope.
 * Uses midpoint quadratic bezier for smooth curves without overshoot.
 */
function buildWaveformPath(
  topYs: Float32Array | number[],
  botYs: Float32Array | number[],
  xs: Float32Array | number[],
): Path2D {
  const n = topYs.length
  const path = new Path2D()
  if (n === 0) return path

  if (n === 1) {
    path.moveTo(xs[0], topYs[0])
    path.lineTo(xs[0], botYs[0])
    return path
  }

  // Top edge: left → right
  path.moveTo(xs[0], topYs[0])
  for (let i = 0; i < n - 1; i++) {
    const mx = (xs[i] + xs[i + 1]) / 2
    const my = (topYs[i] + topYs[i + 1]) / 2
    path.quadraticCurveTo(xs[i], topYs[i], mx, my)
  }
  path.lineTo(xs[n - 1], topYs[n - 1])

  // Bottom edge: right → left
  path.lineTo(xs[n - 1], botYs[n - 1])
  for (let i = n - 1; i > 0; i--) {
    const mx = (xs[i] + xs[i - 1]) / 2
    const my = (botYs[i] + botYs[i - 1]) / 2
    path.quadraticCurveTo(xs[i], botYs[i], mx, my)
  }
  path.lineTo(xs[0], botYs[0])
  path.closePath()

  return path
}

/**
 * Fill a waveform path using canvas clipping for a smooth progress split.
 * Progress color fills the played region; wave color fills the unplayed region.
 * The playhead cursor is drawn as a crisp 1.5px line.
 */
function fillPathProgress(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  w: number,
  h: number,
  progressX: number,
  waveColor: string,
  progressColor: string,
  cursorColor: string,
): void {
  // Played region (left of playhead)
  if (progressX > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, Math.min(progressX, w), h)
    ctx.clip()
    ctx.fillStyle = progressColor
    ctx.fill(path)
    ctx.restore()
  }

  // Unplayed region (right of playhead)
  if (progressX < w) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(Math.max(0, progressX), 0, w, h)
    ctx.clip()
    ctx.fillStyle = waveColor
    ctx.fill(path)
    ctx.restore()
  }

  // Cursor line
  if (progressX > 0 && progressX < w) {
    ctx.fillStyle = cursorColor
    ctx.fillRect(Math.round(progressX) - 0.5, 0, 1.5, h)
  }
}

// ─── Public drawing functions ─────────────────────────────────────────────────

/**
 * Draw a smooth continuous waveform onto a Canvas element.
 * Uses a filled polygon with bezier smoothing and clip-based progress coloring
 * for a perfectly smooth playhead indicator with no per-bar stepping.
 *
 * barWidth and barGap are accepted for API compatibility but ignored.
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
    maxBars?: number
  } = {}
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const {
    waveColor = '#4f46e5',
    progressColor = '#818cf8',
    cursorColor = '#f59e0b',
  } = opts

  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  if (!peaks.length || !w || !h) return

  const progressX = duration > 0 ? (currentTime / duration) * w : 0
  const centerY = h / 2

  // One sample point every ~2 physical pixels, capped at peaks length
  const numPts = Math.max(2, Math.min(peaks.length, Math.ceil(w / 2)))

  const topYs = new Float32Array(numPts)
  const botYs = new Float32Array(numPts)
  const xs    = new Float32Array(numPts)

  for (let i = 0; i < numPts; i++) {
    const t = (i / (numPts - 1)) * (peaks.length - 1)
    const lo = Math.floor(t)
    const hi = Math.min(lo + 1, peaks.length - 1)
    const amp = Math.max(0.02, peaks[lo] + (peaks[hi] - peaks[lo]) * (t - lo))
    xs[i]    = (i / (numPts - 1)) * w
    topYs[i] = centerY - amp * centerY * 0.9
    botYs[i] = centerY + amp * centerY * 0.9
  }

  const path = buildWaveformPath(topYs, botYs, xs)
  fillPathProgress(ctx, path, w, h, progressX, waveColor, progressColor, cursorColor)
}

/**
 * Draw a smooth continuous waveform for a specific viewport window of a longer peaks array.
 *
 * Renders the visible portion of the waveform using bezier smoothing and clip-based
 * progress coloring. The canvas element should have its width/height set in physical
 * pixels (devicePixelRatio) before calling this function.
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
  } = opts

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  if (!w || !h) return

  const viewportDuration = viewportEnd - viewportStart
  const progressX = ((currentTime - viewportStart) / viewportDuration) * w
  const centerY = h / 2

  // One sample point every ~2 physical pixels
  const numPts = Math.max(2, Math.ceil(w / 2))

  const topYs = new Float32Array(numPts)
  const botYs = new Float32Array(numPts)
  const xs    = new Float32Array(numPts)

  for (let i = 0; i < numPts; i++) {
    const frac    = i / (numPts - 1)
    const barTime = viewportStart + frac * viewportDuration
    if (barTime < 0 || barTime > totalDuration) {
      // Outside audio: flat center line
      xs[i]    = frac * w
      topYs[i] = centerY
      botYs[i] = centerY
      continue
    }

    const peakT = (barTime / totalDuration) * (allPeaks.length - 1)
    const lo    = Math.floor(peakT)
    const hi    = Math.min(lo + 1, allPeaks.length - 1)
    const amp   = Math.max(0.02, allPeaks[lo] + (allPeaks[hi] - allPeaks[lo]) * (peakT - lo))

    xs[i]    = frac * w
    topYs[i] = centerY - amp * centerY * 0.9
    botYs[i] = centerY + amp * centerY * 0.9
  }

  const path = buildWaveformPath(topYs, botYs, xs)
  fillPathProgress(ctx, path, w, h, progressX, waveColor, progressColor, cursorColor)
}
