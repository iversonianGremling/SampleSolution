/**
 * Audio Analysis Service
 * Uses Python (Essentia + Librosa) for feature extraction and tag generation
 */

import { spawn, execSync, type ChildProcess } from 'child_process'
import { FFPROBE_BIN } from './ffmpeg.js'
import { appendFileSync, mkdirSync } from 'fs'
import { createInterface, type Interface as ReadlineInterface } from 'readline'
import path from 'path'
import { fileURLToPath } from 'url'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { isReducibleDimensionTag } from '../constants/reducibleTags.js'
import { findCongruentTagsInText, resolveTag, getTagMetadataFromRegistry } from '../constants/tagRegistry.js'
import { extractCategorizedTagsFromText, reviewSampleTagsWithOllama } from './ollama.js'
import { reviewTagsLocally } from './tagReview.js'
import { getAudioFileMetadata } from './ffmpeg.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Path to Python script
const PYTHON_SCRIPT = path.join(__dirname, '../python/analyze_audio.py')
// Try to use venv Python if available, otherwise fall back to system python3
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(__dirname, '../../venv/Scripts/python.exe')
  : path.join(__dirname, '../../venv/bin/python')
const PYTHON_EXECUTABLE = process.env.PYTHON_PATH || VENV_PYTHON

/**
 * Analysis level type
 */
export type AnalysisLevel = 'advanced'
export type TagCategory = 'instrument' | 'filename'
type CanonicalSemanticTagCategory = 'instrument'

export interface ParsedFilenameTag {
  tag: string
  confidence: number
  source: 'filename' | 'folder'
  category: TagCategory
}

const GENERIC_PERCUSSION_TAGS = new Set([
  'percussion',
  'perc',
  'drum',
  'drums',
])

const SPECIFIC_PERCUSSION_TAGS = new Set([
  'kick',
  '808',
  '909',
  'bd',
  'bassdrum',
  'snare',
  'sd',
  'snr',
  'clap',
  'clp',
  'rim',
  'rimshot',
  'hihat',
  'hh',
  'hat',
  'ride',
  'crash',
  'cymbal',
  'tom',
  'shaker',
  'tambourine',
  'cowbell',
  'conga',
  'bongo',
  'woodblock',
  'timbales',
  'maraca',
  'maracas',
])

const INVALID_AI_TAGS = new Set([
  'tron',
])

// AI_TAG_ALIAS_MAP is now consolidated in tagRegistry.ts.
// normalizeAiTagName() uses resolveTag() from the registry instead.

function canonicalizeSemanticCategory(category: string | null | undefined): CanonicalSemanticTagCategory {
  return 'instrument'
}

type InferredSampleType = 'oneshot' | 'loop'

const SAMPLE_TYPE_ONESHOT_PATTERN =
  /\bone\s*[-_ ]?\s*shot(s)?\b|\boneshot(s)?\b|\b1\s*[-_ ]?\s*shot(s)?\b|\bone\s*[-_ ]?\s*hit(s)?\b|\bonehit(s)?\b|\bsingle\s*[-_ ]?\s*shot(s)?\b/
const SAMPLE_TYPE_LOOP_PATTERN = /\bloop(s|ed|ing)?\b/
const PATH_HINT_SAMPLE_TYPE_CONFIDENCE_FLOOR = 0.995

const INSTRUMENT_TYPE_BY_CANONICAL_TAG: Record<string, string> = {
  kick: 'kick',
  snare: 'snare',
  rimshot: 'snare',
  hihat: 'hihat',
  clap: 'clap',
  shaker: 'shaker',
  cymbal: 'cymbal',
  tom: 'tom',
  bass: 'bass',
  synth: 'pad',
  pad: 'pad',
  lead: 'lead',
  pluck: 'lead',
  keys: 'keys',
  guitar: 'guitar',
  strings: 'strings',
  vocal: 'vocal',
  fx: 'fx',
  foley: 'fx',
  ambience: 'fx',
  percussion: 'percussion',
  chord: 'keys',
  arp: 'lead',
  bell: 'keys',
  marimba: 'keys',
  cowbell: 'percussion',
  conga: 'percussion',
  woodblock: 'percussion',
  brass: 'other',
  flute: 'other',
}

function normalizePathHintPart(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = trimmed
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
  return normalized || null
}

function splitPathHintSegments(pathHint: string | null | undefined): string[] {
  const normalized = normalizePathHintPart(pathHint)
  if (!normalized) return []

  return normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function inferSampleTypeFromPathSegment(segment: string): InferredSampleType | null {
  const normalized = segment.trim().toLowerCase()
  if (!normalized) return null

  const compact = normalized.replace(/[^a-z0-9]+/g, '')
  const hasOneShotCue =
    SAMPLE_TYPE_ONESHOT_PATTERN.test(normalized) ||
    compact.includes('oneshot') ||
    compact.includes('oneshots') ||
    compact.includes('1shot') ||
    compact.includes('onehit') ||
    compact.includes('onehits') ||
    compact.includes('singleshot')
  if (hasOneShotCue) return 'oneshot'

  const hasLoopCue =
    SAMPLE_TYPE_LOOP_PATTERN.test(normalized) ||
    compact.includes('loop') ||
    compact.includes('loops')
  if (hasLoopCue) return 'loop'

  return null
}

function inferInstrumentTypeFromPathHint(pathHint: string | null | undefined): string | null {
  const segments = splitPathHintSegments(pathHint)
  if (segments.length === 0) return null

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (!segment) continue
    if (inferSampleTypeFromPathSegment(segment)) continue

    const tokens = segment
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[^a-zA-Z0-9]+/)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 1)

    for (const token of tokens) {
      const resolved = resolveTag(token)
      if (!resolved.isKnown) continue
      const mappedType = INSTRUMENT_TYPE_BY_CANONICAL_TAG[resolved.canonical]
      if (mappedType) return mappedType
    }

    for (const match of findCongruentTagsInText(segment)) {
      const mappedType = INSTRUMENT_TYPE_BY_CANONICAL_TAG[match.canonical]
      if (mappedType) return mappedType
    }
  }

  return null
}

export function inferSampleTypeFromPathHint(pathHint: string | null | undefined): InferredSampleType | null {
  const segments = splitPathHintSegments(pathHint)
  if (segments.length === 0) return null

  let inferred: InferredSampleType | null = null
  for (const segment of segments) {
    const segmentType = inferSampleTypeFromPathSegment(segment)
    if (segmentType) {
      // Keep the closest cue to the file by allowing deeper segments to overwrite.
      inferred = segmentType
    }
  }

  return inferred
}

export function buildSamplePathHint(options: {
  folderPath?: string | null
  relativePath?: string | null
  filename?: string | null
}): string | null {
  const folderPath = normalizePathHintPart(options.folderPath ?? null)
  let relativePath = normalizePathHintPart(options.relativePath ?? null)
  const filename = normalizePathHintPart(options.filename ?? null)

  if (relativePath) {
    relativePath = relativePath.replace(/^\.\/+/, '').replace(/^\/+/, '')
  }

  let combined = folderPath ?? ''
  if (relativePath) {
    combined = combined ? `${combined}/${relativePath}` : relativePath
  }

  if (filename) {
    const currentBase = combined ? path.basename(combined).toLowerCase() : ''
    if (currentBase !== filename.toLowerCase()) {
      combined = combined ? `${combined}/${filename}` : filename
    }
  }

  return normalizePathHintPart(combined)
}

function isSampleTypeLikeTagName(tag: string): boolean {
  const normalized = tag
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')

  return normalized === 'oneshot' || normalized === 'one-shot' || normalized === 'loop' || normalized === 'loops'
}

function normalizeAiTagName(rawTag: string): string | null {
  let normalized = rawTag
    .trim()
    .toLowerCase()
    .replace(/[^\w\s\-\/]/g, '')
    .replace(/\s+/g, ' ')

  if (!normalized) return null

  // Split trailing numeric variants like "vinyl02" -> "vinyl", but keep drum machine names.
  const suffixMatch = normalized.match(/^([a-z][a-z-]{2,})\d{1,3}$/)
  if (suffixMatch && !['808', '909'].includes(normalized)) {
    normalized = suffixMatch[1]
  }

  const resolved = resolveTag(normalized)
  if (resolved.isKnown) {
    normalized = resolved.canonical
  }

  // Reject raw compound filename chunks that are not semantic tags.
  if (/^perc[-_][a-z0-9]+$/.test(normalized)) return null
  if (/^vinyl[-_][a-z0-9]+$/.test(normalized)) return null

  if (INVALID_AI_TAGS.has(normalized)) return null
  if (isSampleTypeLikeTagName(normalized)) return null
  if (isReducibleDimensionTag(normalized)) return null
  if (normalized.length < 2 || normalized.length >= 30) return null
  if (normalized.includes('/m/')) return null

  return normalized
}

function removeRedundantPercussionFamilyTags(tags: ParsedFilenameTag[]): ParsedFilenameTag[] {
  const hasSpecificPercussionTag = tags.some((entry) => SPECIFIC_PERCUSSION_TAGS.has(entry.tag))
  if (!hasSpecificPercussionTag) return tags

  return tags.filter((entry) => !GENERIC_PERCUSSION_TAGS.has(entry.tag))
}

/**
 * Audio features extracted from analysis
 */
export interface AudioFeatures {
  // Basic properties
  duration: number
  sampleRate: number
  channels?: number
  fileFormat?: string
  sourceMtime?: string
  sourceCtime?: string
  isOneShot: boolean
  isLoop: boolean

  // Tempo/Rhythm
  bpm?: number
  beatsCount?: number
  onsetCount: number

  // Spectral features
  spectralCentroid: number
  spectralRolloff: number
  spectralBandwidth: number
  spectralContrast: number
  spectralFlux?: number
  spectralFlatness?: number

  // Timbral features
  zeroCrossingRate: number
  mfccMean: number[]
  kurtosis?: number

  // Energy/Dynamics
  rmsEnergy: number
  loudness: number
  dynamicRange: number

  // Key detection (optional)
  keyEstimate?: string
  scale?: string
  keyStrength?: number

  // Instrument classification
  instrumentPredictions: Array<{
    name: string
    confidence: number
  }>

  // Phase 1: Advanced Timbral Features
  dissonance?: number
  inharmonicity?: number
  tristimulus?: number[]
  spectralComplexity?: number
  spectralCrest?: number

  // Phase 1: Perceptual Features (0-1 normalized)
  brightness?: number
  warmth?: number
  hardness?: number
  noisiness?: number
  roughness?: number
  sharpness?: number

  // Phase 1: Advanced Spectral
  melBandsMean?: number[]
  melBandsStd?: number[]

  // Phase 2: Stereo Analysis
  stereoWidth?: number
  panningCenter?: number
  stereoImbalance?: number

  // Phase 2: Harmonic/Percussive Separation
  harmonicPercussiveRatio?: number
  harmonicEnergy?: number
  percussiveEnergy?: number
  harmonicCentroid?: number
  percussiveCentroid?: number

  // Phase 3: Advanced Rhythm Features
  onsetRate?: number
  beatStrength?: number
  rhythmicRegularity?: number
  danceability?: number

  // Phase 5: Sound Event Features
  eventCount?: number
  eventDensity?: number

  // Phase 3: ADSR Envelope Features
  attackTime?: number
  decayTime?: number
  sustainLevel?: number
  releaseTime?: number
  envelopeType?: string

  // Phase 4: ML-Based Classification
  instrumentClasses?: Array<{
    class: string
    confidence: number
  }>
  genreClasses?: Array<{
    genre: string
    confidence: number
  }>
  genrePrimary?: string
  yamnetEmbeddings?: number[] // 1024-dim array for similarity
  mlEmbeddings?: number[] // Model embeddings (e.g. 2048-dim PANNs CNN14)
  mlEmbeddingModel?: string // e.g. "panns_cnn14" or "yamnet"
  moodClasses?: Array<{
    mood: string
    confidence: number
  }>

  // Phase 6: Audio Fingerprinting & Similarity Detection
  chromaprintFingerprint?: string
  similarityHash?: string

  // New analysis features
  temporalCentroid?: number
  crestFactor?: number
  transientSpectralCentroid?: number
  transientSpectralFlatness?: number
  sampleTypeConfidence?: number

  // Fundamental frequency (one-shots only, excluding chords)
  fundamentalFrequency?: number
  polyphony?: number

  // Metadata
  analysisLevel?: AnalysisLevel
  analysisDurationMs: number

  // Generated tags
  suggestedTags?: string[]
}

/**
 * Analysis error response
 */
export interface AnalysisError {
  error: string
  details?: string
}

export const AUDIO_ANALYSIS_CANCELLED_ERROR = 'Audio analysis canceled'

export interface AnalyzeAudioOptions {
  signal?: AbortSignal
  filename?: string
}

type AnalysisAttemptMode = 'standard' | 'safe'

const RETRYABLE_PROCESS_FAILURE_PATTERNS = [
  'process received signal',
  'process was killed (likely out of memory)',
  'process timed out or was terminated',
]
const SAFE_MODE_RETRY_DISABLED = process.env.AUDIO_ANALYSIS_SAFE_RETRY === '0'
const EMERGENCY_FALLBACK_ENABLED = process.env.AUDIO_ANALYSIS_EMERGENCY_FALLBACK !== '0'
const EMERGENCY_FALLBACK_COOLDOWN_MS = parsePositiveInteger(
  process.env.AUDIO_ANALYSIS_EMERGENCY_FALLBACK_COOLDOWN_MS,
  10 * 60 * 1000
)
const FATAL_NATIVE_SIGNALS = new Set<NodeJS.Signals>([
  'SIGSEGV',
  'SIGBUS',
  'SIGABRT',
  'SIGILL',
  'SIGFPE',
])
const FORCE_SAFE_MODE = process.env.AUDIO_ANALYSIS_FORCE_SAFE_MODE === '1'
const SAFE_MODE_COOLDOWN_MS = parsePositiveInteger(
  process.env.AUDIO_ANALYSIS_SAFE_COOLDOWN_MS,
  10 * 60 * 1000
)
const AUDIO_ANALYSIS_MAX_CONCURRENT = parsePositiveInteger(
  process.env.AUDIO_ANALYSIS_MAX_CONCURRENT,
  1
)
const DEFAULT_NATIVE_THREAD_LIMIT = String(
  parsePositiveInteger(process.env.AUDIO_ANALYSIS_NATIVE_THREAD_LIMIT, 1)
)
const AUDIO_ANALYSIS_DEBUG_LOG_FILE = process.env.AUDIO_ANALYSIS_DEBUG_LOG_FILE
  || path.resolve(process.cwd(), 'data', 'audio-analysis-debug.log')
const AUDIO_ANALYSIS_DEBUG_FILE_ENABLED = process.env.AUDIO_ANALYSIS_DEBUG_LOG_ENABLED !== '0'
const AUDIO_ANALYSIS_PYTHON_STEP_DEBUG = process.env.AUDIO_ANALYSIS_PYTHON_STEP_DEBUG
  ?? (AUDIO_ANALYSIS_DEBUG_FILE_ENABLED ? '1' : '0')

let audioAnalysisDebugLogReady = false
let audioAnalysisAttemptCounter = 0
let safeModeCooldownUntil = 0
let emergencyFallbackUntil = 0
let activeAudioAnalysisRequests = 0
const audioAnalysisQueue: Array<() => void> = []

// ── Persistent Worker Mode ──
const AUDIO_ANALYSIS_WORKER_MODE = process.env.AUDIO_ANALYSIS_WORKER_MODE !== '0'
const WORKER_READY_TIMEOUT_MS = parsePositiveInteger(
  process.env.AUDIO_ANALYSIS_WORKER_READY_TIMEOUT_MS,
  120000
)
const WORKER_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.AUDIO_ANALYSIS_WORKER_REQUEST_TIMEOUT_MS,
  300000
)

interface WorkerState {
  process: ChildProcess
  readline: ReadlineInterface
  mode: AnalysisAttemptMode
  pendingRequests: Map<string, {
    resolve: (result: Record<string, any>) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>
  requestCounter: number
  ready: boolean
}

let workerState: WorkerState | null = null

/**
 * Forcefully terminate a child process. On Windows, SIGTERM/SIGKILL are
 * no-ops so we use `taskkill /F /T` (force + kill child tree) instead.
 */
function forceKillProcess(proc: ChildProcess): void {
  if (proc.killed || proc.pid == null) return
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' })
    } catch {}
  } else {
    try { proc.kill('SIGKILL') } catch {}
  }
}

function gracefulKillProcess(proc: ChildProcess, forceAfterMs = 3000): void {
  if (proc.killed || proc.pid == null) return
  if (process.platform === 'win32') {
    // Windows has no graceful signal — go straight to force kill
    forceKillProcess(proc)
  } else {
    proc.kill('SIGTERM')
    const killTimer = setTimeout(() => forceKillProcess(proc), forceAfterMs)
    killTimer.unref?.()
  }
}

function destroyWorker(reason: string): void {
  if (!workerState) return
  const state = workerState
  workerState = null

  writeAudioAnalysisDebugLog(`[worker] destroying reason=${reason}`)

  // Reject all pending requests
  for (const [id, pending] of state.pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error(`Worker destroyed: ${reason}`))
  }
  state.pendingRequests.clear()

  try {
    state.readline.close()
  } catch {}

  if (!state.process.killed) {
    gracefulKillProcess(state.process)
  }
}

function getOrCreateWorker(mode: AnalysisAttemptMode): Promise<WorkerState> {
  // If existing worker matches mode and is ready, return it
  if (workerState && workerState.mode === mode && workerState.ready) {
    return Promise.resolve(workerState)
  }

  // If existing worker is different mode, destroy it
  if (workerState && workerState.mode !== mode) {
    destroyWorker(`mode change from ${workerState.mode} to ${mode}`)
  }

  // If existing worker is still starting, wait for it
  if (workerState && !workerState.ready) {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (!workerState) {
          clearInterval(checkInterval)
          reject(new Error('Worker destroyed while waiting for ready'))
          return
        }
        if (workerState.ready) {
          clearInterval(checkInterval)
          resolve(workerState)
        }
      }, 100)
    })
  }

  return new Promise((resolve, reject) => {
    const env = buildPythonEnv(mode)
    const args = [PYTHON_SCRIPT, '--worker']

    writeAudioAnalysisDebugLog(`[worker] spawning mode=${mode} python=${PYTHON_EXECUTABLE}`)

    const proc = spawn(PYTHON_EXECUTABLE, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })

    const rl = createInterface({ input: proc.stdout! })

    const state: WorkerState = {
      process: proc,
      readline: rl,
      mode,
      pendingRequests: new Map(),
      requestCounter: 0,
      ready: false,
    }

    workerState = state

    // Timeout for ready signal
    const readyTimer = setTimeout(() => {
      destroyWorker('ready timeout')
      reject(new Error('Worker failed to become ready within timeout'))
    }, WORKER_READY_TIMEOUT_MS)

    rl.on('line', (line) => {
      let parsed: any
      try {
        parsed = JSON.parse(line)
      } catch {
        writeAudioAnalysisDebugLog(`[worker] unparseable stdout: ${clipLogValue(line)}`)
        return
      }

      // Ready signal
      if (parsed.status === 'ready') {
        clearTimeout(readyTimer)
        state.ready = true
        writeAudioAnalysisDebugLog('[worker] ready')
        resolve(state)
        return
      }

      // Response to a request
      const id = parsed.id
      if (id && state.pendingRequests.has(id)) {
        const pending = state.pendingRequests.get(id)!
        state.pendingRequests.delete(id)
        clearTimeout(pending.timer)

        if (parsed.error) {
          pending.reject(new Error(`Analysis error: ${parsed.error}`))
        } else if (parsed.result) {
          pending.resolve(parsed.result)
        } else {
          pending.reject(new Error('Worker returned response without result or error'))
        }
      }
    })

    proc.stderr?.on('data', (data) => {
      const chunk = data.toString()
      for (const line of chunk.split('\n')) {
        if (line.trim() &&
          !line.includes('tensorflow') &&
          !line.includes('libcudart') &&
          !line.includes('libcuda.so') &&
          !line.includes('oneDNN') &&
          !line.includes('cpu_feature_guard')
        ) {
          writeAudioAnalysisDebugLog(`[worker] stderr: ${clipLogValue(line.trim())}`)
        }
      }
    })

    proc.on('close', (code, signal) => {
      writeAudioAnalysisDebugLog(`[worker] closed code=${code} signal=${signal}`)
      if (workerState === state) {
        destroyWorker(`process exited code=${code} signal=${signal}`)
      }
    })

    proc.on('error', (err) => {
      writeAudioAnalysisDebugLog(`[worker] process error: ${err.message}`)
      clearTimeout(readyTimer)
      if (workerState === state) {
        destroyWorker(`process error: ${err.message}`)
      }
      reject(new Error(`Failed to spawn worker: ${err.message}`))
    })
  })
}

function sendWorkerRequest(
  worker: WorkerState,
  audioPath: string,
  analysisLevel: AnalysisLevel,
  filename: string,
  timeoutMs: number = WORKER_REQUEST_TIMEOUT_MS
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    worker.requestCounter += 1
    const id = `req-${worker.requestCounter}`

    const timer = setTimeout(() => {
      worker.pendingRequests.delete(id)
      reject(new Error(`Worker request timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    worker.pendingRequests.set(id, { resolve, reject, timer })

    const request = JSON.stringify({
      id,
      cmd: 'analyze',
      audio_path: audioPath,
      level: analysisLevel,
      filename,
    })

    writeAudioAnalysisDebugLog(`[worker] sending request id=${id} audioPath=${audioPath}`)

    try {
      worker.process.stdin!.write(request + '\n')
    } catch (err) {
      worker.pendingRequests.delete(id)
      clearTimeout(timer)
      reject(new Error(`Failed to write to worker stdin: ${err instanceof Error ? err.message : String(err)}`))
    }
  })
}

async function runWorkerAnalysisAttempt(
  audioPath: string,
  analysisLevel: AnalysisLevel,
  mode: AnalysisAttemptMode,
  options: AnalyzeAudioOptions
): Promise<AudioFeatures> {
  const { signal } = options
  if (signal?.aborted) {
    throw new Error(AUDIO_ANALYSIS_CANCELLED_ERROR)
  }

  audioAnalysisAttemptCounter += 1
  const attemptId = audioAnalysisAttemptCounter
  const attemptStartedAt = Date.now()
  const basename =
    typeof options.filename === 'string' && options.filename.trim().length > 0
      ? options.filename.trim()
      : path.basename(audioPath)

  writeAudioAnalysisDebugLog(
    `[attempt:${attemptId}] worker-start mode=${mode} audioPath=${audioPath}`
  )

  const worker = await getOrCreateWorker(mode)

  if (signal?.aborted) {
    throw new Error(AUDIO_ANALYSIS_CANCELLED_ERROR)
  }

  try {
    const result = await sendWorkerRequest(worker, audioPath, analysisLevel, basename)

    if (result.error) {
      writeAudioAnalysisDebugLog(
        `[attempt:${attemptId}] worker-result-error ${clipLogValue(String(result.error))}`
      )
      throw new Error(`Analysis error: ${result.error}`)
    }

    writeAudioAnalysisDebugLog(
      `[attempt:${attemptId}] worker-resolve afterMs=${Date.now() - attemptStartedAt}`
    )
    return mapPythonResultToAudioFeatures(result)
  } catch (error) {
    writeAudioAnalysisDebugLog(
      `[attempt:${attemptId}] worker-reject afterMs=${Date.now() - attemptStartedAt} error=${clipLogValue(error instanceof Error ? error.message : String(error))}`
    )
    throw error
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseNonNegativeFloat(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value.trim())
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

function removePendingAudioAnalysisWaiter(waiter: () => void): void {
  const index = audioAnalysisQueue.indexOf(waiter)
  if (index >= 0) {
    audioAnalysisQueue.splice(index, 1)
  }
}

async function acquireAudioAnalysisSlot(options: AnalyzeAudioOptions): Promise<void> {
  const { signal } = options
  if (signal?.aborted) {
    throw new Error(AUDIO_ANALYSIS_CANCELLED_ERROR)
  }

  if (activeAudioAnalysisRequests < AUDIO_ANALYSIS_MAX_CONCURRENT) {
    activeAudioAnalysisRequests += 1
    writeAudioAnalysisDebugLog(
      `[slot] acquire-immediate active=${activeAudioAnalysisRequests} queue=${audioAnalysisQueue.length}`
    )
    return
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false

    const waiter = () => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }

    const onAbort = () => {
      if (settled) return
      settled = true
      removePendingAudioAnalysisWaiter(waiter)
      reject(new Error(AUDIO_ANALYSIS_CANCELLED_ERROR))
    }

    audioAnalysisQueue.push(waiter)
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
    writeAudioAnalysisDebugLog(
      `[slot] queued active=${activeAudioAnalysisRequests} queue=${audioAnalysisQueue.length}`
    )
  })

  if (signal?.aborted) {
    throw new Error(AUDIO_ANALYSIS_CANCELLED_ERROR)
  }

  writeAudioAnalysisDebugLog(
    `[slot] acquire-queued active=${activeAudioAnalysisRequests} queue=${audioAnalysisQueue.length}`
  )
}

function releaseAudioAnalysisSlot(): void {
  const next = audioAnalysisQueue.shift()
  if (next) {
    next()
    writeAudioAnalysisDebugLog(
      `[slot] handoff active=${activeAudioAnalysisRequests} queue=${audioAnalysisQueue.length}`
    )
    return
  }
  activeAudioAnalysisRequests = Math.max(0, activeAudioAnalysisRequests - 1)
  writeAudioAnalysisDebugLog(
    `[slot] release active=${activeAudioAnalysisRequests} queue=${audioAnalysisQueue.length}`
  )
}

function buildPythonEnv(mode: AnalysisAttemptMode): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONUNBUFFERED: process.env.PYTHONUNBUFFERED || '1',
    OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || DEFAULT_NATIVE_THREAD_LIMIT,
    OPENBLAS_NUM_THREADS: process.env.OPENBLAS_NUM_THREADS || DEFAULT_NATIVE_THREAD_LIMIT,
    MKL_NUM_THREADS: process.env.MKL_NUM_THREADS || DEFAULT_NATIVE_THREAD_LIMIT,
    NUMEXPR_NUM_THREADS: process.env.NUMEXPR_NUM_THREADS || DEFAULT_NATIVE_THREAD_LIMIT,
    VECLIB_MAXIMUM_THREADS: process.env.VECLIB_MAXIMUM_THREADS || DEFAULT_NATIVE_THREAD_LIMIT,
    BLIS_NUM_THREADS: process.env.BLIS_NUM_THREADS || DEFAULT_NATIVE_THREAD_LIMIT,
    NUMBA_NUM_THREADS: process.env.NUMBA_NUM_THREADS || DEFAULT_NATIVE_THREAD_LIMIT,
    TF_NUM_INTRAOP_THREADS: process.env.TF_NUM_INTRAOP_THREADS || DEFAULT_NATIVE_THREAD_LIMIT,
    TF_NUM_INTEROP_THREADS: process.env.TF_NUM_INTEROP_THREADS || DEFAULT_NATIVE_THREAD_LIMIT,
  }

  if (AUDIO_ANALYSIS_PYTHON_STEP_DEBUG === '1') {
    env.DEBUG_ANALYSIS = process.env.DEBUG_ANALYSIS || '1'
  }

  if (mode === 'safe') {
    env.AUDIO_ANALYSIS_SAFE_MODE = '1'
    env.AUDIO_ANALYSIS_DISABLE_ESSENTIA = '1'
    env.AUDIO_ANALYSIS_DISABLE_TENSORFLOW = '1'
    env.AUDIO_ANALYSIS_DISABLE_FINGERPRINT = '1'
    env.NUMBA_DISABLE_JIT = process.env.NUMBA_DISABLE_JIT || '1'
  }

  return env
}

function ensureAudioAnalysisDebugLogReady(): void {
  if (!AUDIO_ANALYSIS_DEBUG_FILE_ENABLED || audioAnalysisDebugLogReady) return

  try {
    const dir = path.dirname(AUDIO_ANALYSIS_DEBUG_LOG_FILE)
    mkdirSync(dir, { recursive: true })
    audioAnalysisDebugLogReady = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[audio-analysis] Failed to initialize debug log file ${AUDIO_ANALYSIS_DEBUG_LOG_FILE}: ${message}`)
    audioAnalysisDebugLogReady = true
  }
}

function writeAudioAnalysisDebugLog(message: string): void {
  if (!AUDIO_ANALYSIS_DEBUG_FILE_ENABLED) return
  ensureAudioAnalysisDebugLogReady()
  try {
    appendFileSync(
      AUDIO_ANALYSIS_DEBUG_LOG_FILE,
      `${new Date().toISOString()} ${message}\n`,
      { encoding: 'utf8' }
    )
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error)
    console.error(`[audio-analysis] Failed to write debug log: ${err}`)
  }
}

function clipLogValue(value: string, maxLength = 4000): string {
  if (value.length <= maxLength) return value
  return `${value.substring(0, maxLength)} ... [truncated ${value.length - maxLength} chars]`
}

function shouldStartInSafeMode(): boolean {
  if (FORCE_SAFE_MODE) return true
  return Date.now() < safeModeCooldownUntil
}

function shouldUseEmergencyFallback(): boolean {
  if (!EMERGENCY_FALLBACK_ENABLED) return false
  return Date.now() < emergencyFallbackUntil
}

function activateSafeModeCooldown(signal: NodeJS.Signals | null, audioPath: string, timedOut = false): void {
  if (!timedOut && (!signal || !FATAL_NATIVE_SIGNALS.has(signal))) return
  if (SAFE_MODE_COOLDOWN_MS <= 0) return

  safeModeCooldownUntil = Date.now() + SAFE_MODE_COOLDOWN_MS
  const cooldownSeconds = Math.ceil(SAFE_MODE_COOLDOWN_MS / 1000)
  writeAudioAnalysisDebugLog(
    `[cooldown] signal=${signal} audioPath=${audioPath} cooldownSeconds=${cooldownSeconds}`
  )
  console.warn(
    `Audio analysis native crash (${signal}) for ${audioPath}. ` +
      `Temporarily forcing safe mode for ${cooldownSeconds}s.`
  )
}

function activateEmergencyFallbackCooldown(audioPath: string, reason: string): void {
  if (!EMERGENCY_FALLBACK_ENABLED) return
  if (EMERGENCY_FALLBACK_COOLDOWN_MS <= 0) return

  emergencyFallbackUntil = Date.now() + EMERGENCY_FALLBACK_COOLDOWN_MS
  const cooldownSeconds = Math.ceil(EMERGENCY_FALLBACK_COOLDOWN_MS / 1000)
  writeAudioAnalysisDebugLog(
    `[fallback-cooldown] audioPath=${audioPath} reason=${clipLogValue(reason)} cooldownSeconds=${cooldownSeconds}`
  )
  console.warn(
    `Audio analysis emergency fallback enabled for ${cooldownSeconds}s after crash on ${audioPath}.`
  )
}

async function probeAudioDurationSeconds(audioPath: string): Promise<number | null> {
  return await new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ]

    const proc = spawn(FFPROBE_BIN, args)
    let stdout = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.on('error', () => {
      resolve(null)
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve(null)
        return
      }
      resolve(parseNonNegativeFloat(stdout))
    })
  })
}

const LOOP_HINT_TAGS = [
  'loop',
  'beat',
  'groove',
  'pattern',
  'fill',
  'break',
  'top',
] as const

const LOOP_HINT_TAG_SET = new Set<string>(LOOP_HINT_TAGS)

const ONESHOT_HINT_TAGS = [
  'one-shot',
  'oneshot',
  'one_shot',
  'shot',
  'hit',
  'single',
] as const

const ONESHOT_HINT_TAG_SET = new Set<string>(ONESHOT_HINT_TAGS)

function getSampleTypeFromFilenameTags(filenameTags: string[]): {
  hasLoopHint: boolean
  hasOneShotHint: boolean
  isLoop: boolean
  isOneShot: boolean
} {
  const hasLoopHint = filenameTags.some((tag) => LOOP_HINT_TAG_SET.has(tag))
  const hasOneShotHint = filenameTags.some((tag) => ONESHOT_HINT_TAG_SET.has(tag))
  const isLoop = hasLoopHint && !hasOneShotHint
  const isOneShot = !isLoop

  return { hasLoopHint, hasOneShotHint, isLoop, isOneShot }
}

function isMp3MetadataBpmBypassEligible(metadata: {
  format?: string | null
  tagBpm?: number | null
} | null): metadata is { format: string; tagBpm: number } {
  if (!metadata?.format || metadata.tagBpm === null || metadata.tagBpm === undefined) return false
  if (!Number.isFinite(metadata.tagBpm) || metadata.tagBpm <= 0) return false

  const normalizedFormat = metadata.format.trim().toLowerCase()
  return normalizedFormat === 'mp3' || normalizedFormat.split(',').includes('mp3')
}

async function buildMetadataBpmBypassFeatures(
  audioPath: string,
  analysisLevel: AnalysisLevel,
  metadata: {
    sampleRate: number | null
    channels: number | null
    format: string | null
    modifiedAt: string | null
    createdAt: string | null
    tagBpm: number | null
  },
  filenameHint?: string
): Promise<AudioFeatures> {
  const startedAt = Date.now()
  const duration = await probeAudioDurationSeconds(audioPath)
  const basename = typeof filenameHint === 'string' && filenameHint.trim().length > 0
    ? filenameHint.trim()
    : path.basename(audioPath)
  const filenameTags = parseFilenameTags(basename, null).map((entry) => entry.tag)
  const sampleType = getSampleTypeFromFilenameTags(filenameTags)
  const suggestedTags = Array.from(new Set<string>([
    sampleType.isLoop ? 'loop' : 'one-shot',
    ...filenameTags,
  ]))

  const durationValue = typeof duration === 'number' ? duration : 0
  const sampleRate = metadata.sampleRate ?? 44100
  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100
  const bpm = metadata.tagBpm ?? undefined
  const analysisDurationMs = Math.max(1, Date.now() - startedAt)

  writeAudioAnalysisDebugLog(
    `[metadata-bypass] audioPath=${audioPath} bpm=${String(bpm)} format=${metadata.format || 'unknown'} filename=${clipLogValue(basename)}`
  )
  console.log(
    `[audio-analysis] Metadata BPM bypass used for ${audioPath} (format=${metadata.format || 'unknown'}, bpm=${String(bpm)})`
  )

  return {
    duration: durationValue,
    sampleRate: safeSampleRate,
    channels: metadata.channels ?? undefined,
    fileFormat: metadata.format ?? undefined,
    sourceMtime: metadata.modifiedAt ?? undefined,
    sourceCtime: metadata.createdAt ?? undefined,
    isOneShot: sampleType.isOneShot,
    isLoop: sampleType.isLoop,
    bpm,
    beatsCount: undefined,
    onsetCount: 0,
    spectralCentroid: 0,
    spectralRolloff: 0,
    spectralBandwidth: 0,
    spectralContrast: 0,
    spectralFlux: undefined,
    spectralFlatness: undefined,
    zeroCrossingRate: 0,
    mfccMean: [],
    kurtosis: undefined,
    rmsEnergy: 0,
    loudness: 0,
    dynamicRange: 0,
    keyEstimate: undefined,
    scale: undefined,
    keyStrength: undefined,
    instrumentPredictions: [],
    sampleTypeConfidence: sampleType.hasLoopHint || sampleType.hasOneShotHint ? 0.9 : 0.6,
    analysisLevel,
    analysisDurationMs,
    suggestedTags,
  }
}

async function buildEmergencyFallbackFeatures(
  audioPath: string,
  analysisLevel: AnalysisLevel,
  reason: string,
  sourceError?: string
): Promise<AudioFeatures> {
  const startedAt = Date.now()
  const metadata = await getAudioFileMetadata(audioPath).catch(() => null)
  const duration = await probeAudioDurationSeconds(audioPath)
  const basename = path.basename(audioPath)
  const filenameTags = parseFilenameTags(basename, null).map((entry) => entry.tag)

  const sampleType = getSampleTypeFromFilenameTags(filenameTags)
  const suggestedTags = Array.from(
    new Set<string>([
      sampleType.isLoop ? 'loop' : 'one-shot',
      ...filenameTags,
    ])
  )

  const analysisDurationMs = Math.max(1, Date.now() - startedAt)
  const durationValue = typeof duration === 'number' ? duration : 0
  const sampleRate = metadata?.sampleRate ?? 44100
  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100

  writeAudioAnalysisDebugLog(
    `[fallback] audioPath=${audioPath} reason=${clipLogValue(reason)} sourceError=${clipLogValue(sourceError || 'n/a')} duration=${durationValue} sampleRate=${safeSampleRate} suggestedTags=${clipLogValue(JSON.stringify(suggestedTags))}`
  )
  console.warn(
    `Audio analysis fallback used for ${audioPath}: ${reason}` +
      (sourceError ? ` (${sourceError})` : '')
  )

  return {
    duration: durationValue,
    sampleRate: safeSampleRate,
    channels: metadata?.channels ?? undefined,
    fileFormat: metadata?.format ?? undefined,
    sourceMtime: metadata?.modifiedAt ?? undefined,
    sourceCtime: metadata?.createdAt ?? undefined,
    isOneShot: sampleType.isOneShot,
    isLoop: sampleType.isLoop,
    bpm: undefined,
    beatsCount: undefined,
    onsetCount: 0,
    spectralCentroid: 0,
    spectralRolloff: 0,
    spectralBandwidth: 0,
    spectralContrast: 0,
    spectralFlux: undefined,
    spectralFlatness: undefined,
    zeroCrossingRate: 0,
    mfccMean: [],
    kurtosis: undefined,
    rmsEnergy: 0,
    loudness: 0,
    dynamicRange: 0,
    keyEstimate: undefined,
    scale: undefined,
    keyStrength: undefined,
    instrumentPredictions: [],
    sampleTypeConfidence: sampleType.hasLoopHint || sampleType.hasOneShotHint ? 0.75 : 0.5,
    analysisLevel,
    analysisDurationMs,
    suggestedTags,
  }
}

function isRetryableProcessFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return RETRYABLE_PROCESS_FAILURE_PATTERNS.some((pattern) => message.includes(pattern))
}

function mapPythonResultToAudioFeatures(result: Record<string, any>): AudioFeatures {
  // Convert snake_case keys from Python to camelCase for TypeScript
  return {
    duration: result.duration,
    sampleRate: result.sample_rate,
    isOneShot: result.is_one_shot,
    isLoop: result.is_loop,
    bpm: result.bpm,
    beatsCount: result.beats_count,
    onsetCount: result.onset_count,
    spectralCentroid: result.spectral_centroid,
    spectralRolloff: result.spectral_rolloff,
    spectralBandwidth: result.spectral_bandwidth,
    spectralContrast: result.spectral_contrast,
    spectralFlux: result.spectral_flux,
    spectralFlatness: result.spectral_flatness,
    zeroCrossingRate: result.zero_crossing_rate,
    mfccMean: result.mfcc_mean,
    kurtosis: result.kurtosis,
    rmsEnergy: result.rms_energy,
    loudness: result.loudness,
    dynamicRange: result.dynamic_range,
    keyEstimate: result.key_estimate,
    scale: result.scale,
    keyStrength: result.key_strength,
    instrumentPredictions: result.instrument_predictions || [],
    // Phase 1: Timbral features
    dissonance: result.dissonance,
    inharmonicity: result.inharmonicity,
    tristimulus: result.tristimulus,
    spectralComplexity: result.spectral_complexity,
    spectralCrest: result.spectral_crest,
    // Phase 1: Perceptual features
    brightness: result.brightness,
    warmth: result.warmth,
    hardness: result.hardness,
    roughness: result.roughness,
    sharpness: result.sharpness,
    // Phase 1: Advanced spectral
    melBandsMean: result.mel_bands_mean,
    melBandsStd: result.mel_bands_std,
    // Phase 2: Stereo analysis
    stereoWidth: result.stereo_width,
    panningCenter: result.panning_center,
    stereoImbalance: result.stereo_imbalance,
    // Phase 2: Harmonic/Percussive separation
    harmonicPercussiveRatio: result.harmonic_percussive_ratio,
    harmonicEnergy: result.harmonic_energy,
    percussiveEnergy: result.percussive_energy,
    harmonicCentroid: result.harmonic_centroid,
    percussiveCentroid: result.percussive_centroid,
    // Phase 3: Advanced Rhythm features
    onsetRate: result.onset_rate,
    beatStrength: result.beat_strength,
    rhythmicRegularity: result.rhythmic_regularity,
    danceability: result.danceability,
    // Phase 5: Sound Event features
    eventCount: result.event_count,
    eventDensity: result.event_density,
    // Phase 3: ADSR Envelope features
    attackTime: result.attack_time,
    decayTime: result.decay_time,
    sustainLevel: result.sustain_level,
    releaseTime: result.release_time,
    envelopeType: result.envelope_type,
    // Phase 4: ML-Based Classification
    instrumentClasses: result.instrument_classes,
    genreClasses: result.genre_classes,
    genrePrimary: result.genre_primary,
    yamnetEmbeddings: result.yamnet_embeddings,
    mlEmbeddings: result.ml_embeddings,
    mlEmbeddingModel: result.ml_embedding_model,
    moodClasses: result.mood_classes,
    chromaprintFingerprint: result.chromaprint_fingerprint,
    similarityHash: result.similarity_hash,
    // New analysis features
    temporalCentroid: result.temporal_centroid,
    crestFactor: result.crest_factor,
    transientSpectralCentroid: result.transient_spectral_centroid,
    transientSpectralFlatness: result.transient_spectral_flatness,
    sampleTypeConfidence: result.sample_type_confidence,
    fundamentalFrequency: result.fundamental_frequency,
    polyphony: result.polyphony,
    // Metadata
    analysisLevel: 'advanced',
    analysisDurationMs: result.analysis_duration_ms,
    suggestedTags: result.suggested_tags,
  }
}

function runPythonAnalysisAttempt(
  audioPath: string,
  analysisLevel: AnalysisLevel,
  mode: AnalysisAttemptMode,
  options: AnalyzeAudioOptions
): Promise<AudioFeatures> {
  return new Promise((resolve, reject) => {
    audioAnalysisAttemptCounter += 1
    const attemptId = audioAnalysisAttemptCounter
    const attemptStartedAt = Date.now()
    const { signal } = options
    if (signal?.aborted) {
      reject(new Error(AUDIO_ANALYSIS_CANCELLED_ERROR))
      return
    }

    // Advanced mode uses ML models (YAMNet) which require more time.
    // First run needs extra time for model download (~60-90s) + analysis (~60-90s).
    const timeoutMs = 300000
    const args = [PYTHON_SCRIPT, audioPath]
    args.push('--level', analysisLevel)

    // Pass original filename for filename-based detection when available.
    const basename =
      typeof options.filename === 'string' && options.filename.trim().length > 0
        ? options.filename.trim()
        : path.basename(audioPath)
    args.push('--filename', basename)

    const env = buildPythonEnv(mode)

    console.log(`[audio-analysis] Attempt ${attemptId} starting (${mode}) for ${audioPath}`)
    writeAudioAnalysisDebugLog(
      `[attempt:${attemptId}] start mode=${mode} analysisLevel=${analysisLevel} audioPath=${audioPath} timeoutMs=${timeoutMs} python=${PYTHON_EXECUTABLE}`
    )
    writeAudioAnalysisDebugLog(
      `[attempt:${attemptId}] env AUDIO_ANALYSIS_SAFE_MODE=${env.AUDIO_ANALYSIS_SAFE_MODE || '0'} AUDIO_ANALYSIS_DISABLE_ESSENTIA=${env.AUDIO_ANALYSIS_DISABLE_ESSENTIA || '0'} AUDIO_ANALYSIS_DISABLE_TENSORFLOW=${env.AUDIO_ANALYSIS_DISABLE_TENSORFLOW || '0'} AUDIO_ANALYSIS_DISABLE_FINGERPRINT=${env.AUDIO_ANALYSIS_DISABLE_FINGERPRINT || '0'} NUMBA_DISABLE_JIT=${env.NUMBA_DISABLE_JIT || '0'} DEBUG_ANALYSIS=${env.DEBUG_ANALYSIS || '0'}`
    )

    // Do NOT use spawn's `timeout` option — it sends SIGTERM which is a
    // no-op on Windows.  Instead we manage our own timeout below.
    const proc = spawn(PYTHON_EXECUTABLE, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })
    writeAudioAnalysisDebugLog(
      `[attempt:${attemptId}] spawned pid=${proc.pid ?? 'unknown'} args=${JSON.stringify(args)}`
    )

    let didAbort = false
    let didTimeout = false
    let settled = false

    // Manual timeout — works on every platform
    const processTimer = setTimeout(() => {
      if (settled) return
      didTimeout = true
      writeAudioAnalysisDebugLog(`[attempt:${attemptId}] timeout after ${timeoutMs}ms — killing process`)
      forceKillProcess(proc)
    }, timeoutMs)
    processTimer.unref?.()
    let stdout = ''
    let pythonError = ''
    const logPrefix = mode === 'safe' ? '[audio-analysis:safe]' : '[audio-analysis]'

    const cleanupAbortListener = () => {
      clearTimeout(processTimer)
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }

    const finishReject = (error: Error) => {
      if (settled) return
      settled = true
      cleanupAbortListener()
      writeAudioAnalysisDebugLog(
        `[attempt:${attemptId}] reject afterMs=${Date.now() - attemptStartedAt} error=${clipLogValue(error.message)}`
      )
      reject(error)
    }

    const finishResolve = (value: AudioFeatures) => {
      if (settled) return
      settled = true
      cleanupAbortListener()
      writeAudioAnalysisDebugLog(
        `[attempt:${attemptId}] resolve afterMs=${Date.now() - attemptStartedAt} analysisDurationMs=${value.analysisDurationMs}`
      )
      resolve(value)
    }

    const onAbort = () => {
      if (didAbort) return
      didAbort = true
      writeAudioAnalysisDebugLog(`[attempt:${attemptId}] abort signal received`)
      if (!proc.killed) {
        gracefulKillProcess(proc, 2000)
      }
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    proc.stdout.on('data', (data) => {
      const chunk = data.toString()
      stdout += chunk
      for (const line of chunk.split('\n')) {
        if (line.trim()) {
          writeAudioAnalysisDebugLog(`[attempt:${attemptId}] stdout ${clipLogValue(line.trim())}`)
        }
      }
      // Filter out TensorFlow warnings in real-time
      const lines = chunk.split('\n')
      for (const line of lines) {
        if (
          !line.includes('tensorflow') &&
          !line.includes('libcudart') &&
          !line.includes('libcuda.so') &&
          !line.includes('cuInit') &&
          !line.includes('MusicExtractorSVM') &&
          !line.includes('oneDNN') &&
          !line.includes('cpu_feature_guard') &&
          !line.includes('kernel driver')
        ) {
          if (line.trim()) {
            console.log(`${logPrefix} ${line}`)
          }
        }
      }
    })

    proc.stderr.on('data', (data) => {
      const chunk = data.toString()
      for (const line of chunk.split('\n')) {
        if (line.trim()) {
          writeAudioAnalysisDebugLog(`[attempt:${attemptId}] stderr ${clipLogValue(line.trim())}`)
        }
      }
      // Filter TensorFlow warnings from stderr - only capture real errors
      const lines = chunk.split('\n')
      for (const line of lines) {
        // Skip all TensorFlow-related output
        if (
          !line.includes('tensorflow') &&
          !line.includes('libcudart') &&
          !line.includes('libcuda.so') &&
          !line.includes('cuInit') &&
          !line.includes('MusicExtractorSVM') &&
          !line.includes('oneDNN') &&
          !line.includes('cpu_feature_guard') &&
          !line.includes('kernel driver') &&
          !line.includes('dso_loader') &&
          !line.includes('deep neural network') &&
          !line.includes('rebuild TensorFlow') &&
          !line.includes('stream_executor') &&
          !line.includes('cuda')
        ) {
          if (line.trim()) {
            pythonError += line + '\n'
          }
        }
      }
    })

    proc.on('close', (code, closeSignal) => {
      writeAudioAnalysisDebugLog(
        `[attempt:${attemptId}] close code=${String(code)} signal=${String(closeSignal)} didAbort=${String(didAbort)} stdoutLen=${stdout.length} stderrFilteredLen=${pythonError.length} afterMs=${Date.now() - attemptStartedAt}`
      )
      if (didAbort || options.signal?.aborted) {
        finishReject(new Error(AUDIO_ANALYSIS_CANCELLED_ERROR))
        return
      }

      if (code !== 0) {
        // Process killed by signal (OOM, timeout, etc.)
        // On Windows there are no signals — didTimeout tracks our manual timeout.
        if (closeSignal || code === null || didTimeout) {
          const reason = didTimeout ? 'process timed out or was terminated'
            : closeSignal === 'SIGTERM' ? 'process timed out or was terminated'
            : closeSignal === 'SIGKILL' ? 'process was killed (likely out of memory)'
            : `process received signal ${closeSignal || 'unknown'}`

          // Activate safe-mode cooldown for timeouts and fatal signals
          activateSafeModeCooldown(closeSignal, audioPath, didTimeout)

          if (mode === 'safe' && (didTimeout || (closeSignal && FATAL_NATIVE_SIGNALS.has(closeSignal)))) {
            activateEmergencyFallbackCooldown(audioPath, reason)
          }
          console.error(`Audio analysis killed (${mode}) for ${audioPath}: ${reason}`)
          writeAudioAnalysisDebugLog(
            `[attempt:${attemptId}] killed mode=${mode} reason=${reason}`
          )
          finishReject(new Error(`Audio analysis failed: ${reason}`))
          return
        }

        // Try to extract actual error from stdout (JSON error format)
        try {
          // Find JSON object in stdout (might be after warnings)
          const jsonMatch = stdout.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            if (parsed.error) {
              console.error(`Audio analysis failed for ${audioPath}:`, parsed.error)
              writeAudioAnalysisDebugLog(
                `[attempt:${attemptId}] parsed-json-error ${clipLogValue(String(parsed.error))}`
              )
              finishReject(new Error(`Audio analysis failed: ${parsed.error}`))
              return
            }
          }
        } catch {}

        // Fall back to stderr if we have filtered errors
        if (pythonError.trim()) {
          console.error(`Audio analysis failed for ${audioPath}:`, pythonError)
          writeAudioAnalysisDebugLog(
            `[attempt:${attemptId}] stderr-error ${clipLogValue(pythonError.trim())}`
          )
          finishReject(new Error(`Audio analysis failed: ${pythonError.substring(0, 300)}`))
          return
        }

        // Last resort: generic error
        console.error(`Audio analysis failed with code ${code} for ${audioPath}`)
        writeAudioAnalysisDebugLog(
          `[attempt:${attemptId}] unknown-nonzero-exit code=${String(code)}`
        )
        finishReject(new Error(`Audio analysis failed: unknown error (exit code ${code})`))
        return
      }

      try {
        const result = JSON.parse(stdout) as Record<string, any>

        if (result.error) {
          writeAudioAnalysisDebugLog(
            `[attempt:${attemptId}] json-result-error ${clipLogValue(String(result.error))}`
          )
          finishReject(new Error(`Analysis error: ${result.error}`))
          return
        }

        finishResolve(mapPythonResultToAudioFeatures(result))
      } catch (err) {
        console.error('Failed to parse Python output:', stdout.substring(0, 500))
        writeAudioAnalysisDebugLog(
          `[attempt:${attemptId}] parse-failure stdoutPreview=${clipLogValue(stdout.substring(0, 1200))}`
        )
        finishReject(new Error('Failed to parse analysis results'))
      }
    })

    proc.on('error', (err) => {
      writeAudioAnalysisDebugLog(
        `[attempt:${attemptId}] process-error ${clipLogValue(err.message)}`
      )
      if (didAbort || options.signal?.aborted) {
        finishReject(new Error(AUDIO_ANALYSIS_CANCELLED_ERROR))
        return
      }

      finishReject(
        new Error(
          `Failed to spawn Python process: ${err.message}. Make sure Python is installed: python3 --version`
        )
      )
    })
  })
}

/**
 * Analyze audio file using Python script (Essentia + Librosa)
 * Spawns Python process and parses JSON output
 */
export async function analyzeAudioFeatures(
  audioPath: string,
  analysisLevel: AnalysisLevel = 'advanced',
  options: AnalyzeAudioOptions = {}
): Promise<AudioFeatures> {
  if (options.signal?.aborted) {
    throw new Error(AUDIO_ANALYSIS_CANCELLED_ERROR)
  }

  const filenameForHints =
    typeof options.filename === 'string' && options.filename.trim().length > 0
      ? options.filename.trim()
      : path.basename(audioPath)
  const extForBypass = path.extname(filenameForHints || audioPath).toLowerCase()
  if (extForBypass === '.mp3') {
    const metadata = await getAudioFileMetadata(audioPath).catch(() => null)
    if (isMp3MetadataBpmBypassEligible(metadata)) {
      return await buildMetadataBpmBypassFeatures(
        audioPath,
        analysisLevel,
        metadata,
        filenameForHints
      )
    }
  }

  await acquireAudioAnalysisSlot(options)
  try {
    if (shouldUseEmergencyFallback()) {
      const remainingMs = Math.max(0, emergencyFallbackUntil - Date.now())
      return await buildEmergencyFallbackFeatures(
        audioPath,
        analysisLevel,
        `fallback cooldown active (${Math.ceil(remainingMs / 1000)}s remaining)`
      )
    }

    const initialMode: AnalysisAttemptMode = shouldStartInSafeMode() ? 'safe' : 'standard'
    const useWorker = AUDIO_ANALYSIS_WORKER_MODE && initialMode === 'standard'
    writeAudioAnalysisDebugLog(
      `[analyze] start audioPath=${audioPath} analysisLevel=${analysisLevel} initialMode=${initialMode} useWorker=${useWorker} safeCooldownRemainingMs=${Math.max(0, safeModeCooldownUntil - Date.now())}`
    )

    const runAnalysis = useWorker ? runWorkerAnalysisAttempt : runPythonAnalysisAttempt

    try {
      if (initialMode === 'safe' && !FORCE_SAFE_MODE) {
        const remainingMs = Math.max(0, safeModeCooldownUntil - Date.now())
        console.warn(
          `Audio analysis for ${audioPath} starting in safe mode ` +
            `(cooldown ${Math.ceil(remainingMs / 1000)}s remaining).`
        )
      }
      return await runAnalysis(audioPath, analysisLevel, initialMode, options)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      writeAudioAnalysisDebugLog(
        `[analyze] first-attempt-failed audioPath=${audioPath} mode=${initialMode} error=${clipLogValue(errorMessage)}`
      )
      if (error instanceof Error && error.message === AUDIO_ANALYSIS_CANCELLED_ERROR) {
        throw error
      }

      if (initialMode === 'safe') {
        if (EMERGENCY_FALLBACK_ENABLED && isRetryableProcessFailure(error)) {
          activateEmergencyFallbackCooldown(audioPath, errorMessage)
          return await buildEmergencyFallbackFeatures(
            audioPath,
            analysisLevel,
            'safe-mode process failure',
            errorMessage
          )
        }
        throw (error instanceof Error ? error : new Error(String(error)))
      }

      if (SAFE_MODE_RETRY_DISABLED || !isRetryableProcessFailure(error)) {
        throw (error instanceof Error ? error : new Error(String(error)))
      }

      console.warn(
        `Audio analysis crashed for ${audioPath}. Retrying in safe mode without Essentia/TensorFlow.`
      )
      writeAudioAnalysisDebugLog(
        `[analyze] retrying-safe-mode audioPath=${audioPath}`
      )

      try {
        return await runPythonAnalysisAttempt(audioPath, analysisLevel, 'safe', options)
      } catch (safeError) {
        const safeErrorMessage = safeError instanceof Error ? safeError.message : String(safeError)
        writeAudioAnalysisDebugLog(
          `[analyze] safe-retry-failed audioPath=${audioPath} error=${clipLogValue(safeErrorMessage)}`
        )
        if (safeError instanceof Error && safeError.message === AUDIO_ANALYSIS_CANCELLED_ERROR) {
          throw safeError
        }

        const initialMessage = error instanceof Error ? error.message : String(error)
        const safeMessage = safeError instanceof Error ? safeError.message : String(safeError)
        if (
          EMERGENCY_FALLBACK_ENABLED &&
          (
            isRetryableProcessFailure(error) ||
            isRetryableProcessFailure(safeError)
          )
        ) {
          activateEmergencyFallbackCooldown(audioPath, safeMessage)
          return await buildEmergencyFallbackFeatures(
            audioPath,
            analysisLevel,
            'safe-mode retry failed due to process-level failure',
            `${initialMessage} | ${safeMessage}`
          )
        }
        throw new Error(
          `Audio analysis failed after safe-mode retry. Initial error: ${initialMessage}. Safe-mode error: ${safeMessage}`
        )
      }
    }
  } finally {
    releaseAudioAnalysisSlot()
  }
}

/**
 * Derive a canonical instrument type from YAMNet classes and filename hints
 */
export function deriveInstrumentType(
  instrumentClasses: Array<{ class: string; confidence: number }> | undefined,
  filename?: string,
  options?: {
    pathHint?: string | null
    preferPathHint?: boolean
  }
): string | null {
  const pathHintInstrumentType = inferInstrumentTypeFromPathHint(options?.pathHint ?? null)
  if (options?.preferPathHint !== false && pathHintInstrumentType) {
    return pathHintInstrumentType
  }

  const YAMNET_MAP: Record<string, string> = {
    'bass drum': 'kick', 'kick drum': 'kick', 'kick': 'kick',
    'snare drum': 'snare', 'snare': 'snare', 'rimshot': 'snare',
    'hi-hat': 'hihat', 'hihat': 'hihat', 'hi hat': 'hihat',
    'clap': 'clap', 'hand clap': 'clap', 'handclap': 'clap',
    'shaker': 'shaker', 'maraca': 'shaker', 'maracas': 'shaker',
    'cymbal': 'cymbal', 'crash cymbal': 'cymbal', 'ride cymbal': 'cymbal', 'splash cymbal': 'cymbal',
    'tom': 'tom', 'tom-tom drum': 'tom', 'floor tom': 'tom',
    'bass': 'bass', 'bass guitar': 'bass', 'electric bass': 'bass', 'sub bass': 'bass',
    'synthesizer': 'pad', 'pad': 'pad',
    'lead': 'lead', 'synth lead': 'lead',
    'singing': 'vocal', 'voice': 'vocal', 'vocal': 'vocal', 'speech': 'vocal', 'rap': 'vocal',
    'sound effect': 'fx', 'noise': 'fx', 'whoosh': 'fx', 'explosion': 'fx', 'riser': 'fx', 'foley': 'fx',
    'ambient': 'fx', 'ambience': 'fx', 'atmosphere': 'fx', 'atmospheric': 'fx',
    'drum': 'percussion', 'percussion': 'percussion', 'bongo': 'percussion', 'conga': 'percussion',
    'tambourine': 'percussion', 'cowbell': 'percussion', 'woodblock': 'percussion', 'timbales': 'percussion',
    'piano': 'keys', 'keyboard': 'keys', 'organ': 'keys', 'rhodes': 'keys', 'electric piano': 'keys',
    'guitar': 'guitar', 'acoustic guitar': 'guitar', 'electric guitar': 'guitar',
    'violin': 'strings', 'cello': 'strings', 'viola': 'strings', 'string': 'strings', 'orchestra': 'strings',
    'brass': 'other', 'flute': 'other', 'saxophone': 'other', 'trumpet': 'other', 'trombone': 'other',
  }

  // First try from ML classes
  if (instrumentClasses && instrumentClasses.length > 0) {
    for (const cls of instrumentClasses) {
      if (cls.confidence < 0.3) continue
      const lower = cls.class.toLowerCase()
      for (const [pattern, type] of Object.entries(YAMNET_MAP)) {
        if (lower.includes(pattern)) {
          return type
        }
      }
    }
  }

  // Fallback: try filename
  if (filename) {
    const lower = filename.toLowerCase()
    const FILENAME_MAP: Record<string, string> = {
      kick: 'kick', '808': 'kick', bd: 'kick', bassdrum: 'kick',
      snare: 'snare', sd: 'snare', snr: 'snare', rim: 'snare',
      hihat: 'hihat', hh: 'hihat', hat: 'hihat',
      clap: 'clap', clp: 'clap',
      shaker: 'shaker',
      cymbal: 'cymbal', crash: 'cymbal', ride: 'cymbal',
      tom: 'tom',
      bass: 'bass', sub: 'bass',
      pad: 'pad',
      lead: 'lead',
      vocal: 'vocal', vox: 'vocal', voice: 'vocal',
      fx: 'fx', riser: 'fx', sweep: 'fx', impact: 'fx',
      perc: 'percussion',
      piano: 'keys', keys: 'keys', rhodes: 'keys',
      guitar: 'guitar', gtr: 'guitar',
      strings: 'strings', violin: 'strings', cello: 'strings',
    }
    const tokens = lower.replace(/[_\-.\s]/g, ' ').split(' ')
    for (const token of tokens) {
      if (FILENAME_MAP[token]) {
        return FILENAME_MAP[token]
      }
    }
  }

  if (pathHintInstrumentType) {
    return pathHintInstrumentType
  }

  return null
}

function deriveScaleFromKeyEstimate(keyEstimate: string | undefined): string | null {
  if (!keyEstimate) return null

  const normalized = keyEstimate.trim().toLowerCase()
  if (!normalized) return null

  const parts = normalized.split(/\s+/)
  if (parts.length < 2) return null

  const scale = parts.slice(1).join(' ')
  return scale || null
}

/**
 * Store audio features in database
 */
export async function storeAudioFeatures(
  sliceId: number,
  features: AudioFeatures,
  context?: {
    sampleName?: string | null
    pathHint?: string | null
    preferPathHint?: boolean
  }
): Promise<void> {
  const createdAt = new Date().toISOString()

  const asFinite = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  const asFiniteInteger = (value: number | null | undefined): number | null => {
    const finite = asFinite(value)
    if (finite === null) return null
    return Math.max(0, Math.round(finite))
  }

  const pathHint = context?.pathHint ?? null
  const inferredSampleTypeFromPath = inferSampleTypeFromPathHint(pathHint)
  const effectiveIsOneShot =
    inferredSampleTypeFromPath === 'oneshot'
      ? true
      : inferredSampleTypeFromPath === 'loop'
        ? false
        : features.isOneShot
  const effectiveIsLoop =
    inferredSampleTypeFromPath === 'loop'
      ? true
      : inferredSampleTypeFromPath === 'oneshot'
        ? false
        : features.isLoop
  const effectiveSampleTypeConfidence = inferredSampleTypeFromPath
    ? Math.max(PATH_HINT_SAMPLE_TYPE_CONFIDENCE_FLOOR, asFinite(features.sampleTypeConfidence) ?? 0)
    : asFinite(features.sampleTypeConfidence)

  // Derive instrument type from import path hints and/or ML classes.
  const instrumentType = deriveInstrumentType(
    features.instrumentClasses,
    context?.sampleName ?? undefined,
    {
      pathHint,
      preferPathHint: context?.preferPathHint ?? true,
    }
  )
  const scale = features.scale ?? deriveScaleFromKeyEstimate(features.keyEstimate)
  const noisiness = features.noisiness ?? features.roughness ?? null
  const duration = asFinite(features.duration)
  const onsetRate = asFinite(features.onsetRate)
  const explicitEventCount = asFiniteInteger(features.eventCount)
  const explicitEventDensity = asFinite(features.eventDensity)
  const derivedEventDensityFromCount =
    explicitEventCount !== null && duration !== null && duration > 0
      ? explicitEventCount / duration
      : null
  const derivedEventDensity = explicitEventDensity ?? derivedEventDensityFromCount ?? onsetRate
  const derivedEventCount =
    explicitEventCount ??
    (
      derivedEventDensity !== null && duration !== null && duration > 0
        ? Math.max(0, Math.round(derivedEventDensity * duration))
        : null
    )

  const values = {
    sliceId,
    instrumentType: instrumentType ?? null,
    duration: features.duration,
    sampleRate: features.sampleRate,
    channels: features.channels ?? null,
    fileFormat: features.fileFormat?.toLowerCase() ?? null,
    sourceMtime: features.sourceMtime ?? null,
    sourceCtime: features.sourceCtime ?? null,
    isOneShot: effectiveIsOneShot ? 1 : 0,
    isLoop: effectiveIsLoop ? 1 : 0,
    bpm: features.bpm ?? null,
    beatsCount: features.beatsCount ?? null,
    onsetCount: features.onsetCount,
    spectralCentroid: features.spectralCentroid,
    spectralRolloff: features.spectralRolloff,
    spectralBandwidth: features.spectralBandwidth,
    spectralContrast: features.spectralContrast,
    spectralFlux: features.spectralFlux ?? null,
    spectralFlatness: features.spectralFlatness ?? null,
    zeroCrossingRate: features.zeroCrossingRate,
    mfccMean: JSON.stringify(features.mfccMean),
    kurtosis: features.kurtosis ?? null,
    rmsEnergy: features.rmsEnergy,
    loudness: features.loudness,
    dynamicRange: features.dynamicRange,
    keyEstimate: features.keyEstimate ?? null,
    scale,
    keyStrength: features.keyStrength ?? null,
    instrumentPredictions: JSON.stringify(features.instrumentPredictions),
    // Phase 1: Timbral features
    dissonance: features.dissonance ?? null,
    inharmonicity: features.inharmonicity ?? null,
    tristimulus: features.tristimulus ? JSON.stringify(features.tristimulus) : null,
    spectralComplexity: features.spectralComplexity ?? null,
    spectralCrest: features.spectralCrest ?? null,
    // Phase 1: Perceptual features
    brightness: features.brightness ?? null,
    warmth: features.warmth ?? null,
    hardness: features.hardness ?? null,
    noisiness,
    roughness: features.roughness ?? null,
    sharpness: features.sharpness ?? null,
    // Phase 1: Advanced spectral
    melBandsMean: features.melBandsMean ? JSON.stringify(features.melBandsMean) : null,
    melBandsStd: features.melBandsStd ? JSON.stringify(features.melBandsStd) : null,
    // Phase 2: Stereo analysis
    stereoWidth: features.stereoWidth ?? null,
    panningCenter: features.panningCenter ?? null,
    stereoImbalance: features.stereoImbalance ?? null,
    // Phase 2: Harmonic/Percussive separation
    harmonicPercussiveRatio: features.harmonicPercussiveRatio ?? null,
    harmonicEnergy: features.harmonicEnergy ?? null,
    percussiveEnergy: features.percussiveEnergy ?? null,
    harmonicCentroid: features.harmonicCentroid ?? null,
    percussiveCentroid: features.percussiveCentroid ?? null,
    // Phase 3: Advanced Rhythm features
    onsetRate: features.onsetRate ?? null,
    beatStrength: features.beatStrength ?? null,
    rhythmicRegularity: features.rhythmicRegularity ?? null,
    danceability: features.danceability ?? null,
    // Phase 5: Sound Event features
    eventCount: derivedEventCount,
    eventDensity: derivedEventDensity,
    // Phase 3: ADSR Envelope features
    attackTime: features.attackTime ?? null,
    decayTime: features.decayTime ?? null,
    sustainLevel: features.sustainLevel ?? null,
    releaseTime: features.releaseTime ?? null,
    envelopeType: features.envelopeType ?? null,
    // Phase 4: ML-Based Classification
    instrumentClasses: features.instrumentClasses ? JSON.stringify(features.instrumentClasses) : null,
    genreClasses: features.genreClasses ? JSON.stringify(features.genreClasses) : null,
    genrePrimary: features.genrePrimary ?? null,
    yamnetEmbeddings: features.yamnetEmbeddings ? JSON.stringify(features.yamnetEmbeddings) : null,
    mlEmbeddings: features.mlEmbeddings ? JSON.stringify(features.mlEmbeddings) : null,
    mlEmbeddingModel: features.mlEmbeddingModel ?? null,
    moodClasses: features.moodClasses ? JSON.stringify(features.moodClasses) : null,
    // Phase 6: Audio Fingerprinting & Similarity Detection
    chromaprintFingerprint: features.chromaprintFingerprint ?? null,
    similarityHash: features.similarityHash ?? null,
    // New analysis features
    temporalCentroid: features.temporalCentroid ?? null,
    crestFactor: features.crestFactor ?? null,
    transientSpectralCentroid: features.transientSpectralCentroid ?? null,
    transientSpectralFlatness: features.transientSpectralFlatness ?? null,
    sampleTypeConfidence: effectiveSampleTypeConfidence,
    fundamentalFrequency: features.fundamentalFrequency ?? null,
    polyphony: features.polyphony ?? null,
    // Metadata
    analysisLevel: 'advanced' as const,
    analysisVersion: '1.7', // Updated for persisted fingerprint/hash features
    createdAt,
    analysisDurationMs: features.analysisDurationMs,
  }

  // Try to insert, or update if already exists (on unique constraint conflict)
  try {
    await db.insert(schema.audioFeatures).values(values)
  } catch (err: any) {
    // If unique constraint violation, update instead
    if (err.message?.includes('UNIQUE constraint failed')) {
      await db
        .update(schema.audioFeatures)
        .set({
          ...values,
          createdAt: undefined, // Don't update creation time on re-analysis
        } as any)
        .where(eq(schema.audioFeatures.sliceId, sliceId))
    } else {
      throw err
    }
  }

  // Set sampleType on the slice based on isOneShot/isLoop
  const sampleType = effectiveIsOneShot ? 'oneshot' : effectiveIsLoop ? 'loop' : null
  if (sampleType) {
    await db
      .update(schema.slices)
      .set({ sampleType })
      .where(eq(schema.slices.id, sliceId))
  }
}

/**
 * Retrieve audio features for a slice from database
 */
export async function getAudioFeatures(sliceId: number): Promise<AudioFeatures | null> {
  const result = await db
    .select()
    .from(schema.audioFeatures)
    .where(eq(schema.audioFeatures.sliceId, sliceId))
    .limit(1)

  if (result.length === 0) return null

  const row = result[0]

  return {
    duration: row.duration || 0,
    sampleRate: row.sampleRate || 44100,
    channels: row.channels ?? undefined,
    fileFormat: row.fileFormat ?? undefined,
    sourceMtime: row.sourceMtime ?? undefined,
    sourceCtime: row.sourceCtime ?? undefined,
    isOneShot: row.isOneShot === 1,
    isLoop: row.isLoop === 1,
    bpm: row.bpm ?? undefined,
    beatsCount: row.beatsCount ?? undefined,
    onsetCount: row.onsetCount || 0,
    spectralCentroid: row.spectralCentroid || 0,
    spectralRolloff: row.spectralRolloff || 0,
    spectralBandwidth: row.spectralBandwidth || 0,
    spectralContrast: row.spectralContrast || 0,
    spectralFlux: row.spectralFlux ?? undefined,
    spectralFlatness: row.spectralFlatness ?? undefined,
    zeroCrossingRate: row.zeroCrossingRate || 0,
    mfccMean: JSON.parse(row.mfccMean || '[]'),
    kurtosis: row.kurtosis ?? undefined,
    rmsEnergy: row.rmsEnergy || 0,
    loudness: row.loudness || 0,
    dynamicRange: row.dynamicRange || 0,
    keyEstimate: row.keyEstimate ?? undefined,
    scale: row.scale ?? undefined,
    keyStrength: row.keyStrength ?? undefined,
    instrumentPredictions: JSON.parse(row.instrumentPredictions || '[]'),
    // Phase 1: Timbral features
    dissonance: row.dissonance ?? undefined,
    inharmonicity: row.inharmonicity ?? undefined,
    tristimulus: row.tristimulus ? JSON.parse(row.tristimulus) : undefined,
    spectralComplexity: row.spectralComplexity ?? undefined,
    spectralCrest: row.spectralCrest ?? undefined,
    // Phase 1: Perceptual features
    brightness: row.brightness ?? undefined,
    warmth: row.warmth ?? undefined,
    hardness: row.hardness ?? undefined,
    noisiness: row.noisiness ?? undefined,
    roughness: row.roughness ?? undefined,
    sharpness: row.sharpness ?? undefined,
    // Phase 1: Advanced spectral
    melBandsMean: row.melBandsMean ? JSON.parse(row.melBandsMean) : undefined,
    melBandsStd: row.melBandsStd ? JSON.parse(row.melBandsStd) : undefined,
    // Phase 2: Stereo analysis
    stereoWidth: row.stereoWidth ?? undefined,
    panningCenter: row.panningCenter ?? undefined,
    stereoImbalance: row.stereoImbalance ?? undefined,
    // Phase 2: Harmonic/Percussive separation
    harmonicPercussiveRatio: row.harmonicPercussiveRatio ?? undefined,
    harmonicEnergy: row.harmonicEnergy ?? undefined,
    percussiveEnergy: row.percussiveEnergy ?? undefined,
    harmonicCentroid: row.harmonicCentroid ?? undefined,
    percussiveCentroid: row.percussiveCentroid ?? undefined,
    // Phase 3: Advanced Rhythm features
    onsetRate: row.onsetRate ?? undefined,
    beatStrength: row.beatStrength ?? undefined,
    rhythmicRegularity: row.rhythmicRegularity ?? undefined,
    danceability: row.danceability ?? undefined,
    // Phase 5: Sound Event features
    eventCount: row.eventCount ?? undefined,
    eventDensity: row.eventDensity ?? undefined,
    // Phase 3: ADSR Envelope features
    attackTime: row.attackTime ?? undefined,
    decayTime: row.decayTime ?? undefined,
    sustainLevel: row.sustainLevel ?? undefined,
    releaseTime: row.releaseTime ?? undefined,
    envelopeType: row.envelopeType ?? undefined,
    // Phase 4: ML-Based Classification
    instrumentClasses: row.instrumentClasses ? JSON.parse(row.instrumentClasses) : undefined,
    genreClasses: row.genreClasses ? JSON.parse(row.genreClasses) : undefined,
    genrePrimary: row.genrePrimary ?? undefined,
    yamnetEmbeddings: row.yamnetEmbeddings ? JSON.parse(row.yamnetEmbeddings) : undefined,
    mlEmbeddings: row.mlEmbeddings ? JSON.parse(row.mlEmbeddings) : undefined,
    mlEmbeddingModel: row.mlEmbeddingModel ?? undefined,
    moodClasses: row.moodClasses ? JSON.parse(row.moodClasses) : undefined,
    chromaprintFingerprint: row.chromaprintFingerprint ?? undefined,
    similarityHash: row.similarityHash ?? undefined,
    // New analysis features
    temporalCentroid: row.temporalCentroid ?? undefined,
    crestFactor: row.crestFactor ?? undefined,
    transientSpectralCentroid: row.transientSpectralCentroid ?? undefined,
    transientSpectralFlatness: row.transientSpectralFlatness ?? undefined,
    sampleTypeConfidence: row.sampleTypeConfidence ?? undefined,
    fundamentalFrequency: row.fundamentalFrequency ?? undefined,
    polyphony: row.polyphony ?? undefined,
    // Metadata
    analysisLevel: 'advanced',
    analysisDurationMs: row.analysisDurationMs || 0,
  }
}

/**
 * Parse filename and folder path to extract tags
 */
export function parseFilenameTags(
  filename: string,
  folderPath: string | null
): ParsedFilenameTag[] {
  const byTag = new Map<string, ParsedFilenameTag>()

  const KEYWORD_CATEGORIES: Record<string, { keywords: string[]; category: TagCategory }> = {
    percussion: {
      category: 'instrument',
      keywords: [
        'kick', '808', '909', 'bd', 'bassdrum', 'snare', 'sd', 'snr', 'clap', 'clp',
        'rim', 'rimshot', 'hihat', 'hh', 'hat', 'ride', 'crash', 'perc', 'percussion',
        'tom', 'shaker', 'tambourine', 'cowbell', 'conga', 'bongo', 'woodblock',
      ],
    },
    melodic: {
      category: 'instrument',
      keywords: [
        'piano', 'keys', 'rhodes', 'synth', 'synthesizer', 'pad', 'lead', 'pluck',
        'chord', 'chrd', 'stab', 'arp', 'arpeggio', 'bass', 'sub', 'guitar', 'gtr',
        'strings', 'violin', 'cello', 'brass', 'horn', 'flute', 'sax', 'organ',
        'bell', 'marimba', 'vibes',
      ],
    },
    vocal: {
      category: 'instrument',
      keywords: ['vocal', 'vox', 'voice', 'acapella', 'spoken', 'chant', 'choir', 'adlib'],
    },
    fx: {
      category: 'instrument',
      keywords: [
        'fx', 'riser', 'rise', 'sweep', 'impact', 'hit', 'noise', 'texture', 'atmosphere',
        'atmos', 'ambience', 'whoosh', 'boom', 'swell', 'transition',
        'downlifter', 'uplifter',
      ],
    },
  }

  function tokenize(str: string): string[] {
    const tokens = str
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[_\-\s.]+/)
      .map(t => t.toLowerCase())
      .filter(t => t.length > 1)

    return tokens
  }

  function addTag(entry: ParsedFilenameTag): void {
    const normalizedTag = normalizeAiTagName(entry.tag)
    if (!normalizedTag) return
    const normalizedCategory = canonicalizeSemanticCategory(entry.category)

    const existing = byTag.get(normalizedTag)
    if (!existing || entry.confidence > existing.confidence) {
      byTag.set(normalizedTag, {
        ...entry,
        tag: normalizedTag,
        category: normalizedCategory,
      })
    }
  }

  function matchTokens(tokens: string[], source: 'filename' | 'folder') {
    const confidence = source === 'filename' ? 0.90 : 0.85
    const seen = new Set<string>()

    for (const token of tokens) {
      for (const { keywords, category } of Object.values(KEYWORD_CATEGORIES)) {
        if (keywords.includes(token) && !seen.has(token)) {
          seen.add(token)
          addTag({ tag: token, confidence, source, category: canonicalizeSemanticCategory(category) })
        }
      }
    }
  }

  function matchCongruentText(text: string, source: 'filename' | 'folder') {
    const exactConfidence = source === 'filename' ? 0.90 : 0.85
    const partialConfidence = source === 'filename' ? 0.72 : 0.67

    for (const match of findCongruentTagsInText(text)) {
      addTag({
        tag: match.canonical,
        confidence: match.matchType === 'exact' ? exactConfidence : partialConfidence,
        source,
        category: 'instrument',
      })
    }
  }

  const baseName = filename.replace(/\.[^.]+$/, '')
  matchTokens(tokenize(baseName), 'filename')
  matchCongruentText(baseName, 'filename')

  if (folderPath) {
    const folderParts = folderPath.split(/[/\\]/)
    for (const part of folderParts) {
      matchTokens(tokenize(part), 'folder')
      matchCongruentText(part, 'folder')
    }
  }

  return removeRedundantPercussionFamilyTags(Array.from(byTag.values()))
    .sort((a, b) => b.confidence - a.confidence)
}

/**
 * Parse filename tags with Ollama classification first, then fallback to heuristics.
 * Always returns semantic categories (never "filename").
 */
export async function parseFilenameTagsSmart(
  filename: string,
  folderPath: string | null,
  options?: {
    allowAiTagging?: boolean
  }
): Promise<ParsedFilenameTag[]> {
  const heuristicTags = parseFilenameTags(filename, folderPath)
  const allowAiTagging = options?.allowAiTagging !== false

  if (!allowAiTagging) {
    return heuristicTags
  }

  let ollamaTags: Awaited<ReturnType<typeof extractCategorizedTagsFromText>> = []
  try {
    ollamaTags = await extractCategorizedTagsFromText({
      filename,
      folderPath,
      maxTags: 10,
    })
  } catch {
    ollamaTags = []
  }

  if (ollamaTags.length === 0) {
    return heuristicTags
  }

  const merged = new Map<string, ParsedFilenameTag>()
  for (const tag of heuristicTags) {
    merged.set(tag.tag, tag)
  }

  for (const ollamaTag of ollamaTags) {
    const normalizedTag = normalizeAiTagName(ollamaTag.tag)
    if (!normalizedTag) continue

    const candidate: ParsedFilenameTag = {
      tag: normalizedTag,
      confidence: Math.max(0.6, Math.min(1, ollamaTag.confidence)),
      source: 'filename',
      category: canonicalizeSemanticCategory(ollamaTag.category),
    }

    const existing = merged.get(normalizedTag)
    if (!existing || candidate.confidence > existing.confidence) {
      merged.set(normalizedTag, candidate)
    }
  }

  return removeRedundantPercussionFamilyTags(Array.from(merged.values()))
    .sort((a, b) => b.confidence - a.confidence)
}

export interface ReviewedTagResult {
  name: string
  category: CanonicalSemanticTagCategory
}

export interface PostAnalysisTagInput {
  features: AudioFeatures
  sampleName?: string | null
  folderPath?: string | null
  modelTags: string[]
  previousAutoTags?: string[]
  filenameTags?: ParsedFilenameTag[]
  maxTags?: number
  allowAiTagging?: boolean
}

function splitRawTagCandidates(raw: string): string[] {
  return raw
    .split(/[|,\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

function normalizeRawTagCandidates(tags: string[]): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const tag of tags) {
    for (const candidate of splitRawTagCandidates(tag)) {
      const normalized = normalizeAiTagName(candidate)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      deduped.push(normalized)
    }
  }

  return deduped
}

function enforceSingleInstrumentTag(tags: ReviewedTagResult[]): ReviewedTagResult[] {
  const instrumentTags = tags.filter((tag) => tag.category === 'instrument')
  if (instrumentTags.length <= 1) return tags

  const keep = instrumentTags[0]
  return tags.filter((tag) => tag.category !== 'instrument' || tag.name === keep.name)
}

function enforceSemanticCoherence(tags: ReviewedTagResult[], maxTags: number): ReviewedTagResult[] {
  const deduped: ReviewedTagResult[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    if (seen.has(tag.name)) continue
    seen.add(tag.name)
    deduped.push(tag)
  }

  return enforceSingleInstrumentTag(deduped).slice(0, maxTags)
}

function fallbackReviewedTags(input: PostAnalysisTagInput, filenameTags: ParsedFilenameTag[]): ReviewedTagResult[] {
  const maxTags = Math.min(Math.max(input.maxTags ?? 10, 1), 20)
  const normalizedModelTags = normalizeRawTagCandidates(input.modelTags || [])
  const normalizedPreviousTags = normalizeRawTagCandidates(input.previousAutoTags || [])
  const normalizedFilenameTags = filenameTags
    .map((entry) => ({
      ...entry,
      tag: normalizeAiTagName(entry.tag),
      category: canonicalizeSemanticCategory(entry.category),
    }))
    .filter((entry): entry is ParsedFilenameTag & { category: CanonicalSemanticTagCategory; tag: string } => Boolean(entry.tag))

  const strongestModelConfidence = (input.features.instrumentPredictions || [])
    .reduce((best, pred) => {
      if (!pred || typeof pred.confidence !== 'number' || !Number.isFinite(pred.confidence)) return best
      return pred.confidence > best ? pred.confidence : best
    }, 0)
  const preferFilenameEvidence = strongestModelConfidence > 0 && strongestModelConfidence < 0.6
  const candidateOrder = preferFilenameEvidence
    ? [
        ...normalizedFilenameTags.map((entry) => entry.tag),
        ...normalizedModelTags,
        ...normalizedPreviousTags,
      ]
    : [
        ...normalizedModelTags,
        ...normalizedFilenameTags.map((entry) => entry.tag),
        ...normalizedPreviousTags,
      ]

  const reviewed: ReviewedTagResult[] = []
  const seen = new Set<string>()

  for (const rawTag of candidateOrder) {
    const normalizedTag = normalizeAiTagName(rawTag)
    if (!normalizedTag || seen.has(normalizedTag)) continue

    // Only allow known instrument tags
    const resolved = resolveTag(normalizedTag)
    if (!resolved.isKnown) continue

    reviewed.push({
      name: normalizedTag,
      category: 'instrument',
    })
    seen.add(normalizedTag)
    if (reviewed.length >= maxTags) break
  }

  return enforceSemanticCoherence(reviewed, maxTags)
}

export async function postAnalyzeSampleTags(input: PostAnalysisTagInput): Promise<ReviewedTagResult[]> {
  const maxTags = Math.min(Math.max(input.maxTags ?? 10, 1), 20)
  const sampleName = input.sampleName?.trim() || ''
  const folderPath = input.folderPath ?? null
  const pathHintInstrumentType = deriveInstrumentType(undefined, undefined, {
    pathHint: folderPath,
    preferPathHint: true,
  })

  const heuristicFilenameTags = sampleName
    ? parseFilenameTags(sampleName, folderPath)
    : []

  const mergedFilenameTags = [...heuristicFilenameTags, ...(input.filenameTags || [])]
  const filenameTagByName = new Map<string, ParsedFilenameTag>()

  for (const entry of mergedFilenameTags) {
    const normalizedTag = normalizeAiTagName(entry.tag)
    if (!normalizedTag) continue

    const normalizedEntry: ParsedFilenameTag = {
      ...entry,
      tag: normalizedTag,
      category: canonicalizeSemanticCategory(entry.category),
    }

    const existing = filenameTagByName.get(normalizedTag)
    if (!existing || normalizedEntry.confidence > existing.confidence) {
      filenameTagByName.set(normalizedTag, normalizedEntry)
    }
  }

  const filenameTags = Array.from(filenameTagByName.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20)
  const strongestModelConfidence = (input.features.instrumentPredictions || [])
    .reduce((best, pred) => {
      if (!pred || typeof pred.confidence !== 'number' || !Number.isFinite(pred.confidence)) return best
      return pred.confidence > best ? pred.confidence : best
    }, 0)

  // Deterministic path first: model confidence low -> filename evidence wins.
  const localReviewed = reviewTagsLocally({
    sampleName,
    folderPath,
    modelTags: normalizeRawTagCandidates(input.modelTags || []),
    modelConfidence: strongestModelConfidence > 0 ? strongestModelConfidence : null,
    previousAutoTags: normalizeRawTagCandidates(input.previousAutoTags || []),
    filenameTags: filenameTags.map((entry) => ({
      tag: entry.tag,
      confidence: entry.confidence,
      category: canonicalizeSemanticCategory(entry.category),
    })),
    isOneShot: input.features.isOneShot,
    isLoop: input.features.isLoop,
    // Path-derived instrument hints should outweigh uncertain model predictions.
    instrumentType: pathHintInstrumentType,
    genrePrimary: input.features.genrePrimary,
    maxTags,
  })

  if (localReviewed.length > 0) {
    return localReviewed
  }

  const deterministicFallback = enforceSemanticCoherence(fallbackReviewedTags(input, filenameTags), maxTags)
  if (deterministicFallback.length > 0) {
    return deterministicFallback
  }

  // Last resort: Ollama review when deterministic paths have no usable tag.
  if (!sampleName) {
    return []
  }

  const reviewedByOllama = await reviewSampleTagsWithOllama({
    sampleName,
    folderPath,
    modelTags: normalizeRawTagCandidates(input.modelTags || []),
    previousAutoTags: normalizeRawTagCandidates(input.previousAutoTags || []),
    filenameTags: filenameTags.map((entry) => ({
      tag: entry.tag,
      category: canonicalizeSemanticCategory(entry.category),
      confidence: entry.confidence,
    })),
    instrumentType: pathHintInstrumentType,
    genrePrimary: input.features.genrePrimary,
    maxTags,
  })

  if (!reviewedByOllama.length) {
    return []
  }

  const reviewed: ReviewedTagResult[] = []
  const seen = new Set<string>()

  for (const entry of reviewedByOllama) {
    const normalizedTag = normalizeAiTagName(entry.tag)
    if (!normalizedTag || seen.has(normalizedTag)) continue

    // Only allow known instrument tags
    const resolved = resolveTag(normalizedTag)
    if (!resolved.isKnown) continue

    reviewed.push({
      name: normalizedTag,
      category: 'instrument',
    })
    seen.add(normalizedTag)
  }

  return enforceSemanticCoherence(reviewed, maxTags)
}

/**
 * Convert audio features to searchable tags
 * Prefers tags generated by Python, but can generate fallback tags
 */
export function featuresToTags(features: AudioFeatures): string[] {
  // Use suggested tags from Python if available
  if (features.suggestedTags && features.suggestedTags.length > 0) {
    return normalizeRawTagCandidates(features.suggestedTags)
  }

  // Fallback: generate instrument tags in Node (less preferred)
  const tags: string[] = []

  // Instruments only
  features.instrumentPredictions
    .filter((p) => p.confidence > 0.55)
    .forEach((p) => tags.push(p.name))

  // Return unique tags (preserving order)
  return normalizeRawTagCandidates(tags)
}

/**
 * Get tag metadata (color and category based on tag name).
 * Delegates to the canonical tag registry with fallback for unknown tags.
 */
export function getTagMetadata(
  tagName: string,
  preferredCategory?: TagCategory | string
): { color: string; category: TagCategory } {
  const lowerTag = normalizeAiTagName(tagName) ?? tagName.toLowerCase()
  const mapped = (preferredCategory === 'instrument' || preferredCategory === 'filename')
    ? preferredCategory
    : 'instrument' as const
  return getTagMetadataFromRegistry(lowerTag, mapped)
}
