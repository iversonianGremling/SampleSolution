import { Router } from 'express'
import { eq, inArray, and, isNull, isNotNull, like, sql } from 'drizzle-orm'
import fs from 'fs/promises'
import path from 'path'
import archiver from 'archiver'
import multer from 'multer'
import { randomUUID, createHash } from 'crypto'
import { db, schema, getRawDb } from '../db/index.js'
import {
  convertAudioFile,
  extractSlice,
  getAudioFileMetadata,
  type AudioConversionFormat,
  type AudioConversionBitDepth,
} from '../services/ffmpeg.js'
import {
  analyzeAudioFeatures,
  AUDIO_ANALYSIS_CANCELLED_ERROR,
  buildSamplePathHint,
  deriveInstrumentType,
  featuresToTags,
  getTagMetadata,
  parseFilenameTags,
  storeAudioFeatures,
  parseFilenameTagsSmart,
  postAnalyzeSampleTags,
  type ParsedFilenameTag,
  type ReviewedTagResult,
} from '../services/audioAnalysis.js'
import {
  AI_MANAGED_INSTRUMENT_TAG_NAMES,
  findCongruentTagsInText,
  resolveTag,
} from '../constants/tagRegistry.js'
import {
  auditSampleTagsWithOllama,
  reviewSampleTagBatchWithOllama,
  reviewSampleTagsWithOllamaTarget,
  type TagAuditSampleInput,
} from '../services/ollama.js'

const router = Router()
const DATA_DIR = process.env.DATA_DIR || './data'
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')
const SLICES_DIR = path.join(DATA_DIR, 'slices')
const RESOLVED_DATA_DIR = path.resolve(DATA_DIR)

function isManagedDataPath(filePath: string): boolean {
  const resolved = path.resolve(filePath)
  return resolved === RESOLVED_DATA_DIR || resolved.startsWith(`${RESOLVED_DATA_DIR}${path.sep}`)
}

async function unlinkManagedPath(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return
  if (!isManagedDataPath(filePath)) return
  await fs.unlink(filePath).catch(() => {})
}

const renderUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 1,
  },
})

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const ENVELOPE_TYPE_VALUES = ['percussive', 'plucked', 'pad', 'sustained', 'hybrid'] as const
const AI_MANAGED_INSTRUMENT_TAG_NAME_SET = new Set(AI_MANAGED_INSTRUMENT_TAG_NAMES)
const BATCH_REANALYZE_CANCELLED_ERROR = 'Batch re-analysis canceled'
const BATCH_CONVERSION_FORMATS: AudioConversionFormat[] = ['mp3', 'wav', 'flac', 'aiff', 'ogg', 'm4a']
const BATCH_CONVERSION_FORMAT_SET = new Set<AudioConversionFormat>(BATCH_CONVERSION_FORMATS)
const BATCH_CONVERSION_BIT_DEPTHS: AudioConversionBitDepth[] = [16, 24, 32]
const BATCH_CONVERSION_BIT_DEPTH_SET = new Set<AudioConversionBitDepth>(BATCH_CONVERSION_BIT_DEPTHS)
const BATCH_CONVERSION_BIT_DEPTH_FORMATS = new Set<AudioConversionFormat>(['wav', 'flac', 'aiff'])
const BATCH_CONVERSION_MIN_SAMPLE_RATE = 8000
const BATCH_CONVERSION_MAX_SAMPLE_RATE = 384000
const MAX_BATCH_REANALYZE_CONCURRENCY = parsePositiveInteger(
  process.env.BATCH_REANALYZE_MAX_CONCURRENCY,
  10
)
const DEFAULT_BATCH_REANALYZE_CONCURRENCY = Math.min(
  MAX_BATCH_REANALYZE_CONCURRENCY,
  parsePositiveInteger(process.env.BATCH_REANALYZE_DEFAULT_CONCURRENCY, 2)
)
const BATCH_REANALYZE_REVIEW_BATCH_SIZE = Math.max(
  1,
  Math.min(20, parsePositiveInteger(process.env.BATCH_REANALYZE_REVIEW_BATCH_SIZE, 5))
)
const BATCH_REANALYZE_AUDIT_ENABLED = process.env.BATCH_REANALYZE_AUDIT !== '0'
const BATCH_REANALYZE_AUDIT_BATCH_SIZE = Math.max(
  1,
  Math.min(100, parsePositiveInteger(process.env.BATCH_REANALYZE_AUDIT_BATCH_SIZE, 30))
)
const BATCH_REANALYZE_REFEED_TIMEOUT_MS = Math.max(
  1000,
  parsePositiveInteger(process.env.BATCH_REANALYZE_REFEED_TIMEOUT_MS, 90000)
)
const BATCH_REANALYZE_AUDIT_MAX_REPORT_ISSUES = Math.max(
  1,
  Math.min(1000, parsePositiveInteger(process.env.BATCH_REANALYZE_AUDIT_MAX_REPORT_ISSUES, 200))
)
const LOW_CONFIDENCE_FILENAME_TAG_THRESHOLD = 0.72
const LOW_CONFIDENCE_MODEL_TAG_THRESHOLD = 0.6
const GENERIC_SLICE_NAME_PATTERN = /^slice\s*\d+$/i
const GENERIC_SLICE_AMBIENCE_FALLBACK_CONFIDENCE = 0.65
type BatchReanalyzeStage = 'analysis' | 'audit'
type BatchReanalyzeJobStatus =
  | 'idle'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'canceled'
type BatchReanalyzeRequestBody = {
  sliceIds?: number[]
  concurrency?: number
  includeFilenameTags?: boolean
  allowAiTagging?: boolean
}
type BatchReanalyzeResultItem = {
  sliceId: number
  success: boolean
  error?: string
  hadPotentialCustomState?: boolean
  warningMessage?: string
  removedTags?: string[]
  addedTags?: string[]
  auditFlagged?: boolean
  auditApplied?: boolean
  auditReason?: string
  auditSuspiciousTags?: string[]
  auditSuggestedTags?: string[]
  auditError?: string
}
type BatchReanalyzeWarningSummary = {
  totalWithWarnings: number
  sliceIds: number[]
  messages: string[]
}
type BatchReanalyzeResponsePayload = {
  total: number
  analyzed: number
  failed: number
  warnings: BatchReanalyzeWarningSummary
  audit: BatchReanalyzeAuditSummary
  results: BatchReanalyzeResultItem[]
}
type BatchReanalyzeProgressSnapshot = {
  total: number
  analyzed: number
  failed: number
  processed: number
  stage: BatchReanalyzeStage
  warningSliceIds: number[]
  warningMessages: string[]
}
type BatchReanalyzeRunOptions = {
  sliceIds?: number[]
  concurrency?: number
  includeFilenameTags?: boolean
  allowAiTagging?: boolean
  signal?: AbortSignal
  onProgress?: (snapshot: BatchReanalyzeProgressSnapshot) => void
}
type BatchReanalyzeResultSummary = {
  total: number
  analyzed: number
  failed: number
  warnings: BatchReanalyzeWarningSummary
  audit: BatchReanalyzeAuditSummary
}
type BatchReanalyzeAuditIssue = {
  sliceId: number
  sampleName: string
  reason: string | null
  suspiciousTags: string[]
  previousTags: string[]
  suggestedTags: string[]
  applied: boolean
  error?: string
}
type BatchReanalyzeAuditSummary = {
  enabled: boolean
  reviewedSamples: number
  weirdSamples: number
  fixedSamples: number
  failedFixes: number
  messages: string[]
  issues: BatchReanalyzeAuditIssue[]
}
type BatchReanalyzeJobState = {
  jobId: string | null
  status: BatchReanalyzeJobStatus
  stage: BatchReanalyzeStage
  startedAt: string | null
  updatedAt: string | null
  finishedAt: string | null
  total: number
  analyzed: number
  failed: number
  processed: number
  concurrency: number | null
  includeFilenameTags: boolean
  allowAiTagging: boolean
  error: string | null
  warnings: BatchReanalyzeWarningSummary
  audit: BatchReanalyzeAuditSummary
  resultSummary: BatchReanalyzeResultSummary | null
}
type BatchReanalyzeStatusResponse = {
  jobId: string | null
  status: BatchReanalyzeJobStatus
  stage: BatchReanalyzeStage
  isActive: boolean
  isStopping: boolean
  startedAt: string | null
  updatedAt: string | null
  finishedAt: string | null
  total: number
  analyzed: number
  failed: number
  processed: number
  progressPercent: number
  concurrency: number | null
  includeFilenameTags: boolean
  allowAiTagging: boolean
  statusNote: string | null
  error: string | null
  warnings: BatchReanalyzeWarningSummary
  audit: BatchReanalyzeAuditSummary
  resultSummary: BatchReanalyzeResultSummary | null
}

function createEmptyBatchReanalyzeWarnings(): BatchReanalyzeWarningSummary {
  return {
    totalWithWarnings: 0,
    sliceIds: [],
    messages: [],
  }
}

function createEmptyBatchReanalyzeAuditSummary(enabled = BATCH_REANALYZE_AUDIT_ENABLED): BatchReanalyzeAuditSummary {
  return {
    enabled,
    reviewedSamples: 0,
    weirdSamples: 0,
    fixedSamples: 0,
    failedFixes: 0,
    messages: [],
    issues: [],
  }
}

let batchReanalyzeAbortController: AbortController | null = null
let batchReanalyzeJobState: BatchReanalyzeJobState = {
  jobId: null,
  status: 'idle',
  stage: 'analysis',
  startedAt: null,
  updatedAt: null,
  finishedAt: null,
  total: 0,
  analyzed: 0,
  failed: 0,
  processed: 0,
  concurrency: null,
  includeFilenameTags: false,
  allowAiTagging: true,
  error: null,
  warnings: createEmptyBatchReanalyzeWarnings(),
  audit: createEmptyBatchReanalyzeAuditSummary(),
  resultSummary: null,
}
type Range = { min: number | null; max: number | null }
type DimensionKey =
  | 'brightness'
  | 'harmonicity'
  | 'noisiness'
  | 'attack'
  | 'dynamics'
  | 'saturation'
  | 'surface'
  | 'rhythmic'
  | 'density'
  | 'ambience'
  | 'stereoWidth'
  | 'depth'
type DimensionRanges = Record<DimensionKey, Range>
type DimensionFilterRange = Record<DimensionKey, Range>

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function resolveBatchReanalyzeConcurrency(rawConcurrency: number | undefined): number {
  const requestedConcurrency = typeof rawConcurrency === 'number' && Number.isFinite(rawConcurrency)
    ? Math.round(rawConcurrency)
    : DEFAULT_BATCH_REANALYZE_CONCURRENCY
  const resolvedConcurrency = Math.max(
    1,
    Math.min(MAX_BATCH_REANALYZE_CONCURRENCY, requestedConcurrency)
  )
  if (resolvedConcurrency !== requestedConcurrency) {
    console.warn(
      `[reanalyze] Requested concurrency ${requestedConcurrency} was clamped to ${resolvedConcurrency} ` +
        `(max ${MAX_BATCH_REANALYZE_CONCURRENCY}).`
    )
  }
  return resolvedConcurrency
}

function isBatchReanalyzeCancellationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === AUDIO_ANALYSIS_CANCELLED_ERROR || error.message === BATCH_REANALYZE_CANCELLED_ERROR)
  )
}

function getBatchReanalyzeStatusNote(state: BatchReanalyzeJobState): string | null {
  switch (state.status) {
    case 'running':
      if (state.stage === 'audit') {
        return 'Running final AI tag audit and correction pass.'
      }
      return state.allowAiTagging
        ? 'Running advanced feature extraction with AI-assisted tag review.'
        : 'Running advanced feature extraction with fallback tag review.'
    case 'cancelling':
      return 'Stopping analysis and terminating active workers...'
    case 'completed':
      if (!state.audit.enabled) {
        return `Complete: ${state.analyzed} analyzed, ${state.failed} failed (of ${state.total}). Final AI tag audit disabled.`
      }
      return (
        `Complete: ${state.analyzed} analyzed, ${state.failed} failed (of ${state.total}). ` +
        `Audit fixed ${state.audit.fixedSamples}/${state.audit.weirdSamples} weird-tag samples.`
      )
    case 'canceled':
      return 'Re-analysis stopped by user.'
    case 'failed':
      return state.error ? `Re-analysis failed: ${state.error}` : 'Re-analysis failed.'
    case 'idle':
    default:
      return null
  }
}

function getBatchReanalyzeStatusResponse(): BatchReanalyzeStatusResponse {
  const progressPercent = batchReanalyzeJobState.total > 0
    ? Math.min(
        100,
        Math.max(0, Math.round((batchReanalyzeJobState.processed / batchReanalyzeJobState.total) * 100))
      )
    : 0

  return {
    jobId: batchReanalyzeJobState.jobId,
    status: batchReanalyzeJobState.status,
    stage: batchReanalyzeJobState.stage,
    isActive:
      batchReanalyzeJobState.status === 'running' || batchReanalyzeJobState.status === 'cancelling',
    isStopping: batchReanalyzeJobState.status === 'cancelling',
    startedAt: batchReanalyzeJobState.startedAt,
    updatedAt: batchReanalyzeJobState.updatedAt,
    finishedAt: batchReanalyzeJobState.finishedAt,
    total: batchReanalyzeJobState.total,
    analyzed: batchReanalyzeJobState.analyzed,
    failed: batchReanalyzeJobState.failed,
    processed: batchReanalyzeJobState.processed,
    progressPercent,
    concurrency: batchReanalyzeJobState.concurrency,
    includeFilenameTags: batchReanalyzeJobState.includeFilenameTags,
    allowAiTagging: batchReanalyzeJobState.allowAiTagging,
    statusNote: getBatchReanalyzeStatusNote(batchReanalyzeJobState),
    error: batchReanalyzeJobState.error,
    warnings: batchReanalyzeJobState.warnings,
    audit: batchReanalyzeJobState.audit,
    resultSummary: batchReanalyzeJobState.resultSummary,
  }
}

/** Convert a frequency in Hz to the nearest note name (e.g., 440 -> "A"). */
function freqToNoteName(hz: number): string | null {
  if (!hz || hz <= 0) return null
  const midi = Math.round(12 * Math.log2(hz / 440) + 69)
  return NOTE_NAMES[((midi % 12) + 12) % 12]
}

function normalizeFolderPathValue(value: string): string {
  return value
    .replace(/\\+/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
}

function normalizeIdentityPathValue(value: string): string {
  return normalizeFolderPathValue(value).toLowerCase()
}

function parseScaleFromKeyEstimate(keyEstimate: string | null): string | null {
  if (!keyEstimate) return null
  const parts = keyEstimate.trim().split(/\s+/)
  if (parts.length < 2) return null
  return parts.slice(1).join(' ').toLowerCase()
}

type SampleTypeValue = 'oneshot' | 'loop'
type EnvelopeTypeValue = (typeof ENVELOPE_TYPE_VALUES)[number]

function normalizeSampleTypeValue(value: string | null | undefined): SampleTypeValue | null {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'oneshot' || normalized === 'one-shot' || normalized === 'one shot') {
    return 'oneshot'
  }
  if (normalized === 'loop' || normalized === 'loops') {
    return 'loop'
  }
  return null
}

function normalizeEnvelopeTypeValue(value: string | null | undefined): EnvelopeTypeValue | null {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return null
  return ENVELOPE_TYPE_VALUES.includes(normalized as EnvelopeTypeValue)
    ? (normalized as EnvelopeTypeValue)
    : null
}

function normalizeNoteSemitone(value: string): number | null {
  switch (value) {
    case 'C':
    case 'B#':
      return 0
    case 'C#':
    case 'DB':
      return 1
    case 'D':
      return 2
    case 'D#':
    case 'EB':
      return 3
    case 'E':
    case 'FB':
      return 4
    case 'F':
    case 'E#':
      return 5
    case 'F#':
    case 'GB':
      return 6
    case 'G':
      return 7
    case 'G#':
    case 'AB':
      return 8
    case 'A':
      return 9
    case 'A#':
    case 'BB':
      return 10
    case 'B':
    case 'CB':
      return 11
    default:
      return null
  }
}

function getFrequencyOctave(hz: number): number {
  if (!Number.isFinite(hz) || hz <= 0) return 4
  const midi = Math.round(12 * Math.log2(hz / 440) + 69)
  const octave = Math.floor(midi / 12) - 1
  return Number.isFinite(octave) ? octave : 4
}

function noteToFrequency(note: string, fallbackOctave: number): number | null {
  const normalized = note.trim().replace(/♯/g, '#').replace(/♭/g, 'b')
  const match = normalized.match(/^([A-Ga-g])([#b]?)(-?\d+)?$/)
  if (!match) return null

  const noteToken = `${match[1].toUpperCase()}${(match[2] || '').toUpperCase()}`
  const semitone = normalizeNoteSemitone(noteToken)
  if (semitone === null) return null

  const octave = match[3] !== undefined ? Number.parseInt(match[3], 10) : fallbackOctave
  if (!Number.isInteger(octave) || octave < -1 || octave > 9) return null

  const midi = (octave + 1) * 12 + semitone
  if (!Number.isFinite(midi)) return null

  const frequency = 440 * Math.pow(2, (midi - 69) / 12)
  return Number.isFinite(frequency) && frequency > 0 ? frequency : null
}

function isSampleTypeTagCategory(category: string | null | undefined): boolean {
  const normalized = (category ?? '').trim().toLowerCase()
  return (
    normalized === 'sample-type' ||
    normalized === 'sample type' ||
    normalized === 'sample_type' ||
    normalized === 'type'
  )
}

function isSampleTypeTagRecord(tag: Pick<typeof schema.tags.$inferSelect, 'name' | 'category'>): boolean {
  return isSampleTypeTagCategory(tag.category) || normalizeSampleTypeValue(tag.name) !== null
}

function isInstrumentTagRecord(tag: Pick<typeof schema.tags.$inferSelect, 'name' | 'category'>): boolean {
  const normalizedCategory = (tag.category ?? '').trim().toLowerCase()
  if (normalizedCategory === 'instrument') return true

  const resolved = resolveTag(tag.name)
  return resolved.isKnown
}

function isAiManagedInstrumentTagRecord(tag: Pick<typeof schema.tags.$inferSelect, 'name' | 'category'>): boolean {
  const normalizedCategory = (tag.category ?? '').trim().toLowerCase()
  if (normalizedCategory !== 'instrument') return false
  return AI_MANAGED_INSTRUMENT_TAG_NAME_SET.has(tag.name.trim().toLowerCase())
}

function sanitizeSliceTagsAndSampleType(
  rawTags: ReadonlyArray<typeof schema.tags.$inferSelect>,
  sampleType: string | null | undefined
): {
  sampleType: SampleTypeValue | null
  tags: typeof schema.tags.$inferSelect[]
} {
  let fallbackSampleType: SampleTypeValue | null = null
  const filteredTags: typeof schema.tags.$inferSelect[] = []

  for (const tag of rawTags) {
    if (isSampleTypeTagRecord(tag)) {
      if (fallbackSampleType === null) {
        fallbackSampleType = normalizeSampleTypeValue(tag.name)
      }
      continue
    }
    if (!isInstrumentTagRecord(tag)) {
      continue
    }
    filteredTags.push(tag)
  }

  return {
    sampleType: normalizeSampleTypeValue(sampleType) ?? fallbackSampleType,
    tags: filteredTags,
  }
}

function parseDateFilterValue(raw: string | undefined, mode: 'start' | 'end'): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  const value = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T${mode === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`
    : trimmed

  const parsed = new Date(value)
  const timestamp = parsed.getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function isWithinDateRange(
  value: string | null | undefined,
  fromTimestamp: number | null,
  toTimestamp: number | null
): boolean {
  if (fromTimestamp === null && toTimestamp === null) return true
  if (!value) return false

  const parsed = new Date(value).getTime()
  if (!Number.isFinite(parsed)) return false
  if (fromTimestamp !== null && parsed < fromTimestamp) return false
  if (toTimestamp !== null && parsed > toTimestamp) return false
  return true
}

function deriveRelativePathDisplay(
  folderPath: string | null,
  originalPath: string | null,
  relativePath: string | null
): string | null {
  if (relativePath && relativePath.trim()) {
    return normalizeFolderPathValue(relativePath)
  }

  if (!folderPath || !originalPath) return null

  const normalizedOriginal = normalizeFolderPathValue(originalPath)
  const normalizedFolder = normalizeFolderPathValue(folderPath)
  if (!normalizedOriginal || !normalizedFolder) return null
  if (!isPathInFolderScope(normalizedOriginal, normalizedFolder)) return null

  const relative = path.posix.relative(normalizedFolder, normalizedOriginal)
  if (!relative || relative.startsWith('..')) return null
  return normalizeFolderPathValue(relative)
}

function normalizeValue(value: number | null | undefined, range: Range): number | null {
  if (value === null || value === undefined) return null
  if (range.min === null || range.max === null) return null
  if (range.max <= range.min) return 0
  const normalized = (value - range.min) / (range.max - range.min)
  return Math.max(0, Math.min(1, normalized))
}

function parseNormalizedBound(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(1, parsed))
}

function isPathInFolderScope(candidatePath: string | null, scopePath: string): boolean {
  if (!candidatePath) return false
  const normalizedCandidate = normalizeFolderPathValue(candidatePath)
  const normalizedScope = normalizeFolderPathValue(scopePath)
  if (!normalizedCandidate || !normalizedScope) return false
  return (
    normalizedCandidate === normalizedScope ||
    normalizedCandidate.startsWith(`${normalizedScope}/`)
  )
}

function getImportedTrackFolderScopePath(
  folderPath: string | null,
  relativePath: string | null,
  originalPath: string | null
): string | null {
  if (!folderPath || !folderPath.trim()) return null
  const normalizedFolderPath = normalizeFolderPathValue(folderPath)
  if (!normalizedFolderPath) return null

  if (relativePath && relativePath.trim()) {
    const normalizedRelativePath = normalizeFolderPathValue(relativePath)
    if (normalizedRelativePath) {
      const relativeDir = path.posix.dirname(normalizedRelativePath)
      if (!relativeDir || relativeDir === '.') return normalizedFolderPath
      return normalizeFolderPathValue(path.posix.join(normalizedFolderPath, relativeDir))
    }
  }

  // Backward compatibility for rows that only have originalPath.
  if (originalPath && originalPath.trim()) {
    const normalizedOriginal = normalizeFolderPathValue(originalPath)
    if (isPathInFolderScope(normalizedOriginal, normalizedFolderPath)) {
      const relativeToRoot = path.posix.relative(normalizedFolderPath, normalizedOriginal)
      if (relativeToRoot && relativeToRoot !== '.' && !relativeToRoot.startsWith('..')) {
        const relativeDir = path.posix.dirname(relativeToRoot)
        if (relativeDir && relativeDir !== '.') {
          return normalizeFolderPathValue(path.posix.join(normalizedFolderPath, relativeDir))
        }
      }
    }
  }

  return normalizedFolderPath
}

function computeTagDiff(beforeTags: string[], afterTags: string[]) {
  const beforeSet = new Set(beforeTags)
  const afterSet = new Set(afterTags)

  const removedTags = beforeTags.filter((tag) => !afterSet.has(tag))
  const addedTags = afterTags.filter((tag) => !beforeSet.has(tag))

  return { removedTags, addedTags }
}

function sanitizeArchiveEntryBaseName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.length > 0 ? cleaned : 'sample'
}

function createUniqueArchiveEntryName(
  baseName: string,
  extension: string,
  usedNames: Map<string, number>
): string {
  const normalizedExt = extension || '.mp3'
  const canonicalName = `${baseName}${normalizedExt}`
  const key = canonicalName.toLowerCase()
  const seen = usedNames.get(key) ?? 0
  usedNames.set(key, seen + 1)

  if (seen === 0) return canonicalName
  return `${baseName}-${seen + 1}${normalizedExt}`
}

function normalizeConversionFormat(raw: unknown): AudioConversionFormat | null {
  if (typeof raw !== 'string') return null
  const normalized = raw.trim().toLowerCase().replace(/^\./, '')
  const canonical = normalized === 'aif' ? 'aiff' : normalized

  if (!BATCH_CONVERSION_FORMAT_SET.has(canonical as AudioConversionFormat)) {
    return null
  }

  return canonical as AudioConversionFormat
}

function isEmptyOptionalBatchConversionValue(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim().length === 0)
}

function normalizeConversionSampleRate(raw: unknown): number | null {
  if (isEmptyOptionalBatchConversionValue(raw)) return null

  const parsed = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null
  }

  if (parsed < BATCH_CONVERSION_MIN_SAMPLE_RATE || parsed > BATCH_CONVERSION_MAX_SAMPLE_RATE) {
    return null
  }

  return parsed
}

function normalizeConversionBitDepth(raw: unknown): AudioConversionBitDepth | null {
  if (isEmptyOptionalBatchConversionValue(raw)) return null

  const parsed = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(parsed)) return null
  if (!BATCH_CONVERSION_BIT_DEPTH_SET.has(parsed as AudioConversionBitDepth)) return null

  return parsed as AudioConversionBitDepth
}

function inferFormatFromFilePath(filePath: string | null | undefined): AudioConversionFormat | null {
  if (!filePath) return null
  const extension = path.extname(filePath)
  return normalizeConversionFormat(extension)
}

async function getSliceTagNames(sliceId: number): Promise<string[]> {
  const rows = await db
    .select({ name: schema.tags.name })
    .from(schema.sliceTags)
    .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
    .where(eq(schema.sliceTags.sliceId, sliceId))

  return rows.map((row) => row.name)
}

async function getSliceAiManagedTagNames(
  sliceId: number,
  aiManagedTagIds?: ReadonlyArray<number>
): Promise<string[]> {
  const tagIds = aiManagedTagIds
    ? [...aiManagedTagIds]
    : (await getAiManagedInstrumentTagIds())

  if (tagIds.length === 0) return []

  const rows = await db
    .select({
      name: schema.tags.name,
      category: schema.tags.category,
    })
    .from(schema.sliceTags)
    .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
    .where(
      and(
        eq(schema.sliceTags.sliceId, sliceId),
        inArray(schema.sliceTags.tagId, tagIds),
      )
    )

  return rows
    .filter((row) => isAiManagedInstrumentTagRecord(row))
    .map((row) => row.name.toLowerCase())
}

async function getAiManagedInstrumentTagIds(): Promise<number[]> {
  const rows = await db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(
      and(
        eq(schema.tags.category, 'instrument'),
        inArray(schema.tags.name, [...AI_MANAGED_INSTRUMENT_TAG_NAMES]),
      )
    )
  return rows.map((row) => row.id)
}

function normalizeAuditTagName(raw: string): string | null {
  const normalized = raw
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')

  if (normalized.length < 2 || normalized.length >= 30) return null
  return normalized
}

function isGenericSliceNameContext(sampleName: string | null | undefined, folderPath: string | null | undefined): boolean {
  const normalizedSampleName = (sampleName ?? '').trim().toLowerCase()
  if (!GENERIC_SLICE_NAME_PATTERN.test(normalizedSampleName)) return false

  const normalizedFolderPath = (folderPath ?? '').trim().toLowerCase()
  if (!normalizedFolderPath) return true

  return (
    normalizedFolderPath === normalizedSampleName ||
    GENERIC_SLICE_NAME_PATTERN.test(normalizedFolderPath)
  )
}

function normalizeAuditTagNameToCanonical(raw: string): string | null {
  const normalized = normalizeAuditTagName(raw)
  if (!normalized) return null

  const resolved = resolveTag(normalized)
  if (resolved.isKnown) return resolved.canonical
  return normalized
}

function normalizeReviewedInstrumentTagName(raw: string): string | null {
  const canonical = normalizeAuditTagNameToCanonical(raw)
  if (!canonical) return null

  const resolved = resolveTag(canonical)
  if (!resolved.isKnown) return null
  return resolved.canonical
}

function getCongruentTagNamesForSampleText(sampleName: string, folderPath: string | null | undefined): string[] {
  const text = `${sampleName} ${folderPath ?? ''}`.trim()
  if (!text) return []

  const names: string[] = []
  const seen = new Set<string>()
  for (const match of findCongruentTagsInText(text)) {
    const canonical = normalizeAuditTagNameToCanonical(match.canonical)
    if (!canonical || seen.has(canonical)) continue
    seen.add(canonical)
    names.push(canonical)
  }

  return names
}

function normalizeReviewedCategory(_raw: string | null | undefined): ReviewedTagResult['category'] {
  return 'instrument'
}

export function normalizeReviewedTagsForWrite(
  tags: ReadonlyArray<{ name: string; category?: string | null }>,
  options: { maxTags?: number; isOneShot?: boolean; isLoop?: boolean } = {}
): ReviewedTagResult[] {
  const maxTags = Math.min(Math.max(options.maxTags ?? 10, 1), 20)
  const deduped: ReviewedTagResult[] = []
  const seen = new Set<string>()

  for (const tag of tags) {
    const normalizedName = normalizeReviewedInstrumentTagName(tag.name)
    if (!normalizedName || seen.has(normalizedName)) continue
    seen.add(normalizedName)
    deduped.push({
      name: normalizedName,
      category: normalizeReviewedCategory(tag.category),
    })
  }

  const firstInstrument = deduped.find((tag) => tag.category === 'instrument')?.name ?? null
  const singleInstrument = firstInstrument
    ? deduped.filter((tag) => tag.category !== 'instrument' || tag.name === firstInstrument)
    : deduped

  return singleInstrument.slice(0, maxTags)
}

function normalizeTagNameList(tags: ReadonlyArray<string>): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    const candidate = normalizeAuditTagName(tag)
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    normalized.push(candidate)
  }
  return normalized
}

function inferReviewedCategoryFromTag(_tagName: string): ReviewedTagResult['category'] {
  return 'instrument'
}

function buildFallbackReviewedTags(input: {
  sampleName?: string | null
  folderPath?: string | null
  modelTags: string[]
  modelConfidence?: number | null
  filenameTags: ParsedFilenameTag[]
  previousAutoTags: string[]
  isOneShot: boolean
  isLoop: boolean
  maxTags?: number
}): ReviewedTagResult[] {
  const maxTags = Math.min(Math.max(input.maxTags ?? 10, 1), 20)
  const normalizedSampleName = (input.sampleName ?? '').trim().toLowerCase()
  const normalizedFolderPath = (input.folderPath ?? '').trim().toLowerCase()
  const isGenericSliceName = GENERIC_SLICE_NAME_PATTERN.test(normalizedSampleName)
  const hasInformativePath =
    normalizedFolderPath.length > 0 &&
    normalizedFolderPath !== normalizedSampleName &&
    !GENERIC_SLICE_NAME_PATTERN.test(normalizedFolderPath)
  const congruentNameTags = new Set(
    findCongruentTagsInText(
      `${input.sampleName ?? ''} ${input.folderPath ?? ''}`.trim()
    ).map((match) => match.canonical)
  )
  const normalizedPreviousAutoTags = input.previousAutoTags
    .map((tag) => normalizeAuditTagNameToCanonical(tag))
    .filter((tag): tag is string => Boolean(tag))
  const congruentPreviousAutoTags = normalizedPreviousAutoTags
    .filter((tag) => congruentNameTags.has(tag))
  const normalizedFilenameTags = input.filenameTags
    .filter((entry) => {
      if (typeof entry.confidence !== 'number') return true
      if (entry.confidence >= LOW_CONFIDENCE_FILENAME_TAG_THRESHOLD) return true
      const normalizedName = normalizeReviewedInstrumentTagName(entry.tag)
      return Boolean(normalizedName && congruentNameTags.has(normalizedName))
    })
    .map((entry) => ({
      name: normalizeReviewedInstrumentTagName(entry.tag),
      category: normalizeReviewedCategory(entry.category),
    }))
    .filter(
      (entry): entry is { name: string; category: ReviewedTagResult['category'] } =>
        Boolean(entry.name)
    )

  const filenameCategoryByTag = new Map<string, ReviewedTagResult['category']>()
  for (const entry of normalizedFilenameTags) {
    filenameCategoryByTag.set(entry.name, entry.category)
  }

  const hasFilenameEvidence = normalizedFilenameTags.length > 0
  const modelConfidence =
    typeof input.modelConfidence === 'number' && Number.isFinite(input.modelConfidence)
      ? input.modelConfidence
      : null
  if (
    isGenericSliceName &&
    !hasInformativePath &&
    !hasFilenameEvidence &&
    (modelConfidence === null || modelConfidence <= GENERIC_SLICE_AMBIENCE_FALLBACK_CONFIDENCE)
  ) {
    return normalizeReviewedTagsForWrite(
      [{ name: 'ambience', category: 'instrument' }],
      {
        maxTags,
        isOneShot: input.isOneShot,
        isLoop: input.isLoop,
      }
    )
  }

  const preferFilenameEvidence =
    typeof input.modelConfidence === 'number' &&
    Number.isFinite(input.modelConfidence) &&
    input.modelConfidence < LOW_CONFIDENCE_MODEL_TAG_THRESHOLD
  const candidateOrder = preferFilenameEvidence
    ? [
        ...congruentPreviousAutoTags,
        ...normalizedFilenameTags.map((entry) => entry.name),
        ...input.modelTags,
        ...normalizedPreviousAutoTags,
      ]
    : [
        ...congruentPreviousAutoTags,
        ...input.modelTags,
        ...normalizedFilenameTags.map((entry) => entry.name),
        ...normalizedPreviousAutoTags,
      ]

  const fallbackCandidates = candidateOrder.map((name) => {
    const normalizedName = normalizeReviewedInstrumentTagName(name)
    if (!normalizedName) return null
    return {
      name: normalizedName,
      category: filenameCategoryByTag.get(normalizedName) ?? inferReviewedCategoryFromTag(normalizedName),
    }
  })

  if (fallbackCandidates.filter(Boolean).length === 0 && congruentNameTags.size > 0) {
    for (const name of congruentNameTags) {
      fallbackCandidates.push({
        name,
        category: inferReviewedCategoryFromTag(name),
      })
    }
  }

  return normalizeReviewedTagsForWrite(
    fallbackCandidates.filter(
      (entry): entry is { name: string; category: ReviewedTagResult['category'] } => Boolean(entry)
    ),
    {
      maxTags,
      isOneShot: input.isOneShot,
      isLoop: input.isLoop,
    }
  )
}

function areTagNameSetsEqual(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false
  const setA = new Set(a)
  if (setA.size !== b.length) return false
  for (const entry of b) {
    if (!setA.has(entry)) return false
  }
  return true
}

function chunkBySize<T>(items: ReadonlyArray<T>, chunkSize: number): T[][] {
  if (items.length === 0) return []
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize))
  }
  return chunks
}

function deriveInstrumentHintForAudit(
  predictions: Array<{ name: string; confidence: number }> | undefined
): string | null {
  if (!predictions || predictions.length === 0) return null
  const best = predictions.reduce<{ name: string; confidence: number } | null>((bestMatch, candidate) => {
    if (!candidate || typeof candidate.name !== 'string' || typeof candidate.confidence !== 'number') {
      return bestMatch
    }
    if (!bestMatch || candidate.confidence > bestMatch.confidence) return candidate
    return bestMatch
  }, null)
  if (!best) return null
  return normalizeAuditTagName(best.name)
}

async function replaceAutoReanalysisTagsForSlice(
  sliceId: number,
  reviewedTags: ReadonlyArray<ReviewedTagResult>,
  aiManagedTagIds?: ReadonlyArray<number>
): Promise<void> {
  const tagIds = aiManagedTagIds
    ? [...aiManagedTagIds]
    : (await getAiManagedInstrumentTagIds())
  if (tagIds.length > 0) {
    await db
      .delete(schema.sliceTags)
      .where(
        and(
          eq(schema.sliceTags.sliceId, sliceId),
          inArray(schema.sliceTags.tagId, tagIds),
        )
      )
  }

  const sanitizedReviewedTags = normalizeReviewedTagsForWrite(reviewedTags, { maxTags: 20 })
  if (sanitizedReviewedTags.length === 0) return

  const tags = await Promise.all(sanitizedReviewedTags.map(async ({ name: tagName, category: tagCategory }) => {
    const metadata = getTagMetadata(tagName, tagCategory)
    const existingTag = await db
      .select()
      .from(schema.tags)
      .where(eq(schema.tags.name, tagName))
      .get()

    if (existingTag) {
      if (existingTag.category === 'filename' && metadata.category !== 'filename') {
        await db
          .update(schema.tags)
          .set({
            color: metadata.color,
            category: metadata.category,
          })
          .where(eq(schema.tags.id, existingTag.id))
      }
      return existingTag
    }

    const created = await db
      .insert(schema.tags)
      .values({
        name: tagName,
        color: metadata.color,
        category: metadata.category,
      })
      .returning()

    return created[0]
  }))

  for (const tag of tags) {
    await db
      .insert(schema.sliceTags)
      .values({
        sliceId,
        tagId: tag.id,
      })
      .onConflictDoNothing()
  }
}

type BatchAuditSampleContext = TagAuditSampleInput & {
  previousAutoTags: string[]
  filenameTags: Array<{ tag: string; category?: string; confidence?: number }>
  instrumentType?: string | null
}

function toReviewInputFromAuditSample(sample: BatchAuditSampleContext) {
  return {
    sampleName: sample.sampleName,
    folderPath: sample.folderPath ?? null,
    modelTags: sample.modelTags ?? [],
    previousAutoTags: sample.currentTags
      .map((entry) => normalizeAuditTagNameToCanonical(entry.tag))
      .filter((entry): entry is string => Boolean(entry)),
    filenameTags: sample.filenameTags,
    instrumentType: sample.instrumentType ?? sample.instrumentHint ?? null,
    genrePrimary: sample.genrePrimary ?? null,
    maxTags: 10,
  }
}

async function runDualModelRefeedForSample(
  sample: BatchAuditSampleContext,
  auditObservation: string | null
): Promise<ReviewedTagResult[]> {
  const additionalInstructions = auditObservation?.trim() || undefined
  const reviewInput = toReviewInputFromAuditSample(sample)
  const analyzerReview = await reviewSampleTagsWithOllamaTarget(reviewInput, 'analyzer', {
    additionalInstructions,
    contextSuffix: 'bulk-reaudit-analyzer',
    timeoutMs: BATCH_REANALYZE_REFEED_TIMEOUT_MS,
  })
  const primaryReview = await reviewSampleTagsWithOllamaTarget(reviewInput, 'primary', {
    additionalInstructions,
    contextSuffix: 'bulk-reaudit-primary',
    timeoutMs: BATCH_REANALYZE_REFEED_TIMEOUT_MS,
  })

  const normalizeFromCategorized = (
    tags: Array<{ tag: string; category?: string | null }>
  ): ReviewedTagResult[] => {
    if (tags.length === 0) return []
    return normalizeReviewedTagsForWrite(
      tags.map((entry) => ({ name: entry.tag, category: entry.category })),
      {
        maxTags: 10,
        isOneShot: sample.isOneShot,
        isLoop: sample.isLoop,
      }
    )
  }

  const primaryTags = normalizeFromCategorized(primaryReview)
  const analyzerTags = normalizeFromCategorized(analyzerReview)

  if (analyzerTags.length > 0 && primaryTags.length > 0) {
    const primarySet = new Set(primaryTags.map((entry) => entry.name))
    const overlap = analyzerTags.filter((entry) => primarySet.has(entry.name))
    if (overlap.length > 0) return overlap
    return analyzerTags
  }
  if (analyzerTags.length > 0) return analyzerTags
  if (primaryTags.length > 0) return primaryTags
  return []
}

type TextFirstAuditDecision =
  | { status: 'coherent' }
  | { status: 'suggested'; reason: string; suggestedTags: ReviewedTagResult[] }
  | { status: 'unresolved' }

function evaluateSampleTagsTextFirst(sample: BatchAuditSampleContext): TextFirstAuditDecision {
  const congruentTagNames = getCongruentTagNamesForSampleText(sample.sampleName, sample.folderPath)
  if (congruentTagNames.length === 0) {
    return { status: 'unresolved' }
  }

  const congruentSet = new Set(congruentTagNames)
  const currentTagNames = sample.currentTags
    .map((entry) => normalizeAuditTagNameToCanonical(entry.tag))
    .filter((entry): entry is string => Boolean(entry))
  const hasCurrentCongruentTag = currentTagNames.some((tag) => congruentSet.has(tag))
  if (hasCurrentCongruentTag) {
    return { status: 'coherent' }
  }

  const suggestedTags = normalizeReviewedTagsForWrite(
    congruentTagNames.map((name) => ({
      name,
      category: 'instrument',
    })),
    {
      maxTags: 10,
      isOneShot: sample.isOneShot,
      isLoop: sample.isLoop,
    }
  )

  if (suggestedTags.length === 0) {
    return { status: 'unresolved' }
  }

  return {
    status: 'suggested',
    reason: 'Current tags are not congruent with sample-name text cues.',
    suggestedTags,
  }
}

async function runBatchReanalyzeAudit(input: {
  samples: BatchAuditSampleContext[]
  resultBySliceId: Map<number, BatchReanalyzeResultItem>
  ensureNotCanceled: () => void
}): Promise<BatchReanalyzeAuditSummary> {
  if (!BATCH_REANALYZE_AUDIT_ENABLED) {
    const disabled = createEmptyBatchReanalyzeAuditSummary(false)
    disabled.messages.push('Final AI tag audit is disabled (BATCH_REANALYZE_AUDIT=0).')
    return disabled
  }

  const summary = createEmptyBatchReanalyzeAuditSummary(true)
  summary.reviewedSamples = input.samples.length

  if (input.samples.length === 0) {
    summary.messages.push('No analyzed samples were available for the final AI tag audit.')
    return summary
  }

  const chunkSize = BATCH_REANALYZE_AUDIT_BATCH_SIZE
  const chunks = chunkBySize(input.samples, chunkSize)
  const sampleBySliceId = new Map<number, BatchAuditSampleContext>()
  for (const sample of input.samples) {
    sampleBySliceId.set(sample.sliceId, sample)
  }

  const flaggedSliceIds = new Set<number>()
  let refeedAttempts = 0
  let refeedSuccesses = 0

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    input.ensureNotCanceled()
    const chunk = chunks[chunkIndex]
    const issues: Awaited<ReturnType<typeof auditSampleTagsWithOllama>> = []
    const unresolvedForAi: BatchAuditSampleContext[] = []
    const textFirstIssueSliceIds = new Set<number>()

    for (const sample of chunk) {
      if (isGenericSliceNameContext(sample.sampleName, sample.folderPath)) {
        continue
      }

      const decision = evaluateSampleTagsTextFirst(sample)
      if (decision.status === 'coherent') continue
      if (decision.status === 'unresolved') {
        unresolvedForAi.push(sample)
        continue
      }

      textFirstIssueSliceIds.add(sample.sliceId)
      issues.push({
        sliceId: sample.sliceId,
        reason: decision.reason,
        suspiciousTags: sample.currentTags
          .map((entry) => normalizeAuditTagNameToCanonical(entry.tag))
          .filter((entry): entry is string => Boolean(entry)),
        suggestedTags: decision.suggestedTags.map((tag) => ({
          tag: tag.name,
          category: tag.category,
          confidence: 0.92,
        })),
      })
    }

    if (unresolvedForAi.length > 0) {
      try {
        const aiIssues = await auditSampleTagsWithOllama({
          samples: unresolvedForAi.map((sample) => ({
            sliceId: sample.sliceId,
            sampleName: sample.sampleName,
            folderPath: sample.folderPath ?? null,
            currentTags: sample.currentTags,
            modelTags: sample.modelTags,
            isOneShot: sample.isOneShot,
            isLoop: sample.isLoop,
            instrumentHint: sample.instrumentHint ?? null,
            genrePrimary: sample.genrePrimary ?? null,
          })),
          maxTags: 10,
        })
        issues.push(...aiIssues)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        summary.messages.push(
          `Audit chunk ${chunkIndex + 1}/${chunks.length} AI fallback failed: ${message}.`
        )
      }
    }

    for (const issue of issues) {
      const sample = sampleBySliceId.get(issue.sliceId)
      if (!sample) continue

      const previousTagNames = normalizeTagNameList(sample.currentTags.map((tag) => tag.tag))
      const suggestedReviewedTags = normalizeReviewedTagsForWrite(
        issue.suggestedTags.map((tag) => ({
          name: tag.tag,
          category: tag.category,
        })),
        {
          maxTags: 10,
          isOneShot: sample.isOneShot,
          isLoop: sample.isLoop,
        }
      )
      const suggestedTagNames = suggestedReviewedTags.map((tag) => tag.name)

      const observationText = [
        issue.reason ? `Bulk audit finding: ${issue.reason}` : '',
        issue.suspiciousTags.length > 0
          ? `Bulk audit suspicious tags: ${issue.suspiciousTags.join(', ')}`
          : '',
        suggestedTagNames.length > 0
          ? `Bulk audit baseline suggestions: ${suggestedTagNames.join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')

      if (!flaggedSliceIds.has(issue.sliceId)) {
        flaggedSliceIds.add(issue.sliceId)
        summary.weirdSamples += 1
      }

      const reportIssue: BatchReanalyzeAuditIssue = {
        sliceId: issue.sliceId,
        sampleName: sample.sampleName,
        reason: issue.reason,
        suspiciousTags: [...issue.suspiciousTags],
        previousTags: [...previousTagNames],
        suggestedTags: [...suggestedTagNames],
        applied: false,
      }

      let finalReviewedTags = suggestedReviewedTags
      if (observationText && !textFirstIssueSliceIds.has(issue.sliceId)) {
        try {
          refeedAttempts += 1
          const refeedTags = await runDualModelRefeedForSample(sample, observationText)
          if (refeedTags.length > 0) {
            finalReviewedTags = refeedTags
            refeedSuccesses += 1
          }
        } catch (error) {
          reportIssue.error = `Dual-model refeed failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
      const sanitizedFinalReviewedTags = normalizeReviewedTagsForWrite(finalReviewedTags, {
        maxTags: 10,
        isOneShot: sample.isOneShot,
        isLoop: sample.isLoop,
      })
      const finalTagNames = sanitizedFinalReviewedTags.map((tag) => tag.name)
      reportIssue.suggestedTags = [...finalTagNames]

      const resultItem = input.resultBySliceId.get(issue.sliceId)
      if (resultItem && resultItem.success) {
        resultItem.auditFlagged = true
        resultItem.auditReason = issue.reason ?? undefined
        resultItem.auditSuspiciousTags = [...issue.suspiciousTags]
        resultItem.auditSuggestedTags = [...finalTagNames]
      }

      if (sanitizedFinalReviewedTags.length === 0) {
        if (!reportIssue.error) {
          reportIssue.error = 'Audit response did not include usable suggested tags.'
        }
        summary.failedFixes += 1
        if (resultItem && resultItem.success) {
          resultItem.auditApplied = false
          resultItem.auditError = reportIssue.error
        }
      } else if (areTagNameSetsEqual(previousTagNames, finalTagNames)) {
        if (resultItem && resultItem.success) {
          resultItem.auditApplied = false
        }
      } else {
        try {
          await replaceAutoReanalysisTagsForSlice(issue.sliceId, sanitizedFinalReviewedTags)
          sample.currentTags = sanitizedFinalReviewedTags.map((tag) => ({
            tag: tag.name,
            category: tag.category,
            confidence: 0.9,
          }))
          reportIssue.applied = true
          summary.fixedSamples += 1
          if (resultItem && resultItem.success) {
            resultItem.auditApplied = true
            resultItem.auditError = undefined
          }
        } catch (error) {
          reportIssue.error = error instanceof Error ? error.message : 'Failed to apply audit suggestions'
          summary.failedFixes += 1
          if (resultItem && resultItem.success) {
            resultItem.auditApplied = false
            resultItem.auditError = reportIssue.error
          }
        }
      }

      if (summary.issues.length < BATCH_REANALYZE_AUDIT_MAX_REPORT_ISSUES) {
        summary.issues.push(reportIssue)
      }
    }
  }

  summary.messages.unshift(
    `Final tag audit (text-first, AI fallback) reviewed ${summary.reviewedSamples} sample(s) in ${chunks.length} batch(es).`
  )
  if (summary.weirdSamples === 0) {
    summary.messages.push('No weird tags were flagged by the final text/AI audit.')
  } else {
    summary.messages.push(
      `Audit flagged ${summary.weirdSamples} sample(s) and applied ${summary.fixedSamples} correction(s).`
    )
  }
  if (refeedAttempts > 0) {
    summary.messages.push(
      `Dual-model refeed attempted for ${refeedAttempts} flagged sample(s); ${refeedSuccesses} returned usable tags.`
    )
  }
  if (summary.failedFixes > 0) {
    summary.messages.push(`Audit failed to apply ${summary.failedFixes} correction(s).`)
  }
  if (summary.weirdSamples > summary.issues.length) {
    summary.messages.push(
      `Audit issue list truncated to ${summary.issues.length} entries (limit ${BATCH_REANALYZE_AUDIT_MAX_REPORT_ISSUES}).`
    )
  }

  return summary
}

async function ensureCoreDataDirs() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true })
  await fs.mkdir(SLICES_DIR, { recursive: true })
}

async function copyFileSafe(src: string, dest: string) {
  if (src === dest) return
  await fs.copyFile(src, dest)
}

function toFiniteDuration(value: unknown, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

// Persist rendered lab audio either as copy or overwrite
router.post('/slices/:id/render', renderUpload.single('audio'), async (req, res) => {
  const sliceId = Number.parseInt(req.params.id, 10)

  if (!Number.isInteger(sliceId) || sliceId <= 0) {
    return res.status(400).json({ error: 'Invalid slice id' })
  }

  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    return res.status(400).json({ error: 'Audio file is required' })
  }

  const rawMode = String(req.body?.mode ?? '').trim().toLowerCase()
  const mode: 'copy' | 'overwrite' | null =
    rawMode === 'copy' || rawMode === 'overwrite' ? rawMode : null

  if (!mode) {
    return res.status(400).json({ error: 'mode must be either copy or overwrite' })
  }

  const requestedFileName = String(req.body?.fileName ?? '').trim()
  const hqPitchRequested = parseBooleanFlag(req.body?.hqPitchRequested)

  try {
    await ensureCoreDataDirs()

    const sliceRows = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, sliceId))
      .limit(1)

    if (sliceRows.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    const sourceSlice = sliceRows[0]

    const trackRows = await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, sourceSlice.trackId))
      .limit(1)

    if (trackRows.length === 0) {
      return res.status(404).json({ error: 'Parent track not found' })
    }

    const sourceTrack = trackRows[0]

    const fallbackDuration = Math.max(0.01, sourceSlice.endTime - sourceSlice.startTime)
    const renderedDuration = toFiniteDuration(req.body?.duration, fallbackDuration)
    const safeName = sanitizeArchiveEntryBaseName(
      requestedFileName || `${sourceSlice.name || `slice-${sourceSlice.id}`}-lab`
    )

    const uniqueStem = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const renderedFilePath = path.join(SLICES_DIR, `${uniqueStem}.wav`)
    await fs.writeFile(renderedFilePath, req.file.buffer)

    const now = new Date().toISOString()

    if (mode === 'overwrite') {
      if (sourceSlice.filePath) {
        await copyFileSafe(renderedFilePath, sourceSlice.filePath)
        await fs.unlink(renderedFilePath).catch(() => {})
      }

      const finalFilePath = sourceSlice.filePath || renderedFilePath
      const [updatedSlice] = await db
        .update(schema.slices)
        .set({
          filePath: finalFilePath,
          startTime: 0,
          endTime: renderedDuration,
          sampleModified: 1,
          sampleModifiedAt: now,
        })
        .where(eq(schema.slices.id, sourceSlice.id))
        .returning()

      return res.json({
        mode,
        sourceSliceId: sourceSlice.id,
        slice: updatedSlice,
        hqPitchRequested,
      })
    }

    // mode === 'copy'
    const originalTrackTitle = sourceTrack.title || `Sample ${sourceSlice.id}`
    const newTrackTitle = `${originalTrackTitle} (Lab)`
    const newTrackYoutubeId = `lab:${randomUUID()}`
    const trackDescription = `Lab render copy from slice ${sourceSlice.id}`

    const sourceAudioPathForCopy = sourceSlice.filePath || sourceTrack.audioPath || renderedFilePath
    const copiedTrackAudioPath = path.join(UPLOADS_DIR, `${newTrackYoutubeId.replace(':', '_')}.wav`)
    await copyFileSafe(sourceAudioPathForCopy, copiedTrackAudioPath)

    const [createdTrack] = await db
      .insert(schema.tracks)
      .values({
        youtubeId: newTrackYoutubeId,
        title: newTrackTitle,
        description: trackDescription,
        thumbnailUrl: sourceTrack.thumbnailUrl || '',
        duration: renderedDuration,
        audioPath: copiedTrackAudioPath,
        peaksPath: null,
        status: 'ready',
        artist: sourceTrack.artist,
        album: sourceTrack.album,
        year: sourceTrack.year,
        albumArtist: sourceTrack.albumArtist,
        genre: sourceTrack.genre,
        composer: sourceTrack.composer,
        trackNumber: sourceTrack.trackNumber,
        discNumber: sourceTrack.discNumber,
        trackComment: sourceTrack.trackComment,
        musicalKey: sourceTrack.musicalKey,
        tagBpm: sourceTrack.tagBpm,
        isrc: sourceTrack.isrc,
        metadataRaw: sourceTrack.metadataRaw,
        source: 'local',
        originalPath: sourceTrack.originalPath || sourceSlice.filePath || null,
        folderPath: sourceTrack.folderPath || null,
        relativePath: sourceTrack.relativePath || null,
        fullPathHint: sourceTrack.fullPathHint || sourceTrack.originalPath || sourceSlice.filePath || null,
        createdAt: now,
      })
      .returning()

    const [createdSlice] = await db
      .insert(schema.slices)
      .values({
        trackId: createdTrack.id,
        name: safeName,
        startTime: 0,
        endTime: renderedDuration,
        filePath: renderedFilePath,
        favorite: 0,
        sampleModified: 1,
        sampleModifiedAt: now,
        createdAt: now,
      })
      .returning()

    const sourceTagLinks = await db
      .select({ tagId: schema.sliceTags.tagId })
      .from(schema.sliceTags)
      .where(eq(schema.sliceTags.sliceId, sourceSlice.id))

    if (sourceTagLinks.length > 0) {
      await db
        .insert(schema.sliceTags)
        .values(sourceTagLinks.map((link) => ({ sliceId: createdSlice.id, tagId: link.tagId })))
        .onConflictDoNothing()
    }

    return res.json({
      mode,
      sourceSliceId: sourceSlice.id,
      slice: createdSlice,
      createdTrack,
      hqPitchRequested,
    })
  } catch (error) {
    console.error('Error persisting lab render:', error)
    return res.status(500).json({ error: 'Failed to persist rendered sample' })
  }
})

// GET /api/sources/samples - Returns samples filtered by scope
// Query params:
//   scope: 'youtube' | 'youtube:{trackId}' | 'local' | 'soundcloud' | 'soundcloud:{trackId}' | 'spotify' | 'spotify:{trackId}' | 'bandcamp' | 'bandcamp:{trackId}' | 'folder:{path}' | 'my-folder:{id}' | 'folder:{id}' | 'all'
//   search: search term (optional)
//   favorites: 'true' to show only favorites (optional)
//   tags: comma-separated tag IDs (optional, AND semantics)
//   sortBy: 'artist' | 'album' | 'year' | 'albumArtist' | 'genre' | 'composer' | 'trackNumber' | 'discNumber' | 'tagBpm' | 'musicalKey' | 'isrc' | 'bpm' | 'key' | 'note' | 'name' | 'duration' | 'createdAt' | 'similarity' (optional)
//   sortOrder: 'asc' | 'desc' (optional, default: 'asc', or 'desc' if similarTo is provided)
//   minBpm: minimum BPM (optional)
//   maxBpm: maximum BPM (optional)
//   keys: comma-separated key names (optional, e.g., 'C major,D minor')
//   notes: comma-separated note names for fundamental frequency filter (optional, e.g., 'C,D,E')
//   dateAddedFrom/dateAddedTo: added-date range filter in YYYY-MM-DD (optional)
//   dateCreatedFrom/dateCreatedTo: source-file creation-date range filter in YYYY-MM-DD (optional)
//   dateUpdatedFrom/dateUpdatedTo: source-file modified-date range filter in YYYY-MM-DD (optional)
//   similarTo: slice ID to find similar samples (optional)
//   minSimilarity: minimum similarity threshold 0-1 (optional, default: 0.5)
//   <dimension>Min/<dimension>Max: normalized dimension ranges, each 0-1
//   dimensions: brightness, harmonicity, noisiness, attack, dynamics, saturation, surface, rhythmic, density, ambience, stereoWidth, depth
router.get('/sources/samples', async (req, res) => {
  try {
    const {
      scope = 'all',
      tags,
      search,
      favorites,
      sortBy,
      sortOrder = 'asc',
      minBpm,
      maxBpm,
      keys,
      notes,
      dateAddedFrom,
      dateAddedTo,
      dateCreatedFrom,
      dateCreatedTo,
      dateUpdatedFrom,
      dateUpdatedTo,
      similarTo,
      minSimilarity,
      brightnessMin,
      brightnessMax,
      harmonicityMin,
      harmonicityMax,
      noisinessMin,
      noisinessMax,
      attackMin,
      attackMax,
      dynamicsMin,
      dynamicsMax,
      saturationMin,
      saturationMax,
      surfaceMin,
      surfaceMax,
      rhythmicMin,
      rhythmicMax,
      densityMin,
      densityMax,
      ambienceMin,
      ambienceMax,
      stereoWidthMin,
      stereoWidthMax,
      depthMin,
      depthMax,
    } = req.query as {
      scope?: string
      tags?: string
      search?: string
      favorites?: string
      sortBy?: string
      sortOrder?: string
      minBpm?: string
      maxBpm?: string
      keys?: string
      notes?: string
      dateAddedFrom?: string
      dateAddedTo?: string
      dateCreatedFrom?: string
      dateCreatedTo?: string
      dateUpdatedFrom?: string
      dateUpdatedTo?: string
      similarTo?: string
      minSimilarity?: string
      brightnessMin?: string
      brightnessMax?: string
      harmonicityMin?: string
      harmonicityMax?: string
      noisinessMin?: string
      noisinessMax?: string
      attackMin?: string
      attackMax?: string
      dynamicsMin?: string
      dynamicsMax?: string
      saturationMin?: string
      saturationMax?: string
      surfaceMin?: string
      surfaceMax?: string
      rhythmicMin?: string
      rhythmicMax?: string
      densityMin?: string
      densityMax?: string
      ambienceMin?: string
      ambienceMax?: string
      stereoWidthMin?: string
      stereoWidthMax?: string
      depthMin?: string
      depthMax?: string
    }

    const dimensionFilters: DimensionFilterRange = {
      brightness: { min: parseNormalizedBound(brightnessMin), max: parseNormalizedBound(brightnessMax) },
      harmonicity: { min: parseNormalizedBound(harmonicityMin), max: parseNormalizedBound(harmonicityMax) },
      noisiness: { min: parseNormalizedBound(noisinessMin), max: parseNormalizedBound(noisinessMax) },
      attack: { min: parseNormalizedBound(attackMin), max: parseNormalizedBound(attackMax) },
      dynamics: { min: parseNormalizedBound(dynamicsMin), max: parseNormalizedBound(dynamicsMax) },
      saturation: { min: parseNormalizedBound(saturationMin), max: parseNormalizedBound(saturationMax) },
      surface: { min: parseNormalizedBound(surfaceMin), max: parseNormalizedBound(surfaceMax) },
      rhythmic: { min: parseNormalizedBound(rhythmicMin), max: parseNormalizedBound(rhythmicMax) },
      density: { min: parseNormalizedBound(densityMin), max: parseNormalizedBound(densityMax) },
      ambience: { min: parseNormalizedBound(ambienceMin), max: parseNormalizedBound(ambienceMax) },
      stereoWidth: { min: parseNormalizedBound(stereoWidthMin), max: parseNormalizedBound(stereoWidthMax) },
      depth: { min: parseNormalizedBound(depthMin), max: parseNormalizedBound(depthMax) },
    }
    for (const range of Object.values(dimensionFilters)) {
      if (range.min !== null && range.max !== null && range.min > range.max) {
        const tmp = range.min
        range.min = range.max
        range.max = tmp
      }
    }

    const dateAddedFromTs = parseDateFilterValue(dateAddedFrom, 'start')
    const dateAddedToTs = parseDateFilterValue(dateAddedTo, 'end')
    const dateCreatedFromTs = parseDateFilterValue(dateCreatedFrom, 'start')
    const dateCreatedToTs = parseDateFilterValue(dateCreatedTo, 'end')
    const dateUpdatedFromTs = parseDateFilterValue(dateUpdatedFrom, 'start')
    const dateUpdatedToTs = parseDateFilterValue(dateUpdatedTo, 'end')
    const selectedTagIds = tags
      ? Array.from(
          new Set(
            tags
              .split(',')
              .map((id) => Number.parseInt(id.trim(), 10))
              .filter((id) => Number.isInteger(id) && id > 0)
          )
        )
      : []

    // Build base query conditions
    const conditions: any[] = []
    const sqlite = getRawDb()
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    const hasModernFolders = tables.some((t) => t.name === 'folders')
    const hasModernFolderSlices = tables.some((t) => t.name === 'folder_slices')
    const hasLegacyCollections = tables.some((t) => t.name === 'collections')
    const hasLegacyCollectionSlices = tables.some((t) => t.name === 'collection_slices')

    let hasLegacyPerspectiveId = false
    if (hasLegacyCollections) {
      const collectionColumns = sqlite.prepare('PRAGMA table_info(collections)').all() as Array<{ name: string }>
      hasLegacyPerspectiveId = collectionColumns.some((col) => col.name === 'perspective_id')
    }
    const useLegacyHierarchy = hasLegacyCollections && hasLegacyPerspectiveId && hasLegacyCollectionSlices

    // Resolve folder membership links in a schema-agnostic way.
    // Some deployments can carry legacy and modern tables at the same time.
    // We intentionally merge both sources and de-duplicate.
    const getFolderSliceIds = async (folderIds: number[]): Promise<number[]> => {
      if (folderIds.length === 0) return []

      const found = new Set<number>()

      if (hasLegacyCollectionSlices) {
        const placeholders = folderIds.map(() => '?').join(',')
        const legacyRows = sqlite
          .prepare(`SELECT slice_id as sliceId FROM collection_slices WHERE collection_id IN (${placeholders})`)
          .all(...folderIds) as Array<{ sliceId: number }>

        for (const row of legacyRows) {
          found.add(row.sliceId)
        }
      }

      if (hasModernFolderSlices) {
        const modernRows = await db
          .select({ sliceId: schema.folderSlices.sliceId })
          .from(schema.folderSlices)
          .where(inArray(schema.folderSlices.folderId, folderIds))

        for (const row of modernRows) {
          found.add(row.sliceId)
        }
      }

      return Array.from(found)
    }

    const getFolderIdsForCollection = async (collectionId: number): Promise<number[]> => {
      const ids = new Set<number>()

      // Legacy rename model: collections table stores folders and links to perspectives via perspective_id.
      if (useLegacyHierarchy) {
        const legacyFolders = sqlite
          .prepare('SELECT id FROM collections WHERE perspective_id = ?')
          .all(collectionId) as Array<{ id: number }>
        for (const row of legacyFolders) ids.add(row.id)
      }

      if (hasModernFolders) {
        const modernFolders = await db
          .select({ id: schema.folders.id })
          .from(schema.folders)
          .where(eq(schema.folders.collectionId, collectionId))
        for (const row of modernFolders) ids.add(row.id)
      }

      return Array.from(ids)
    }

    const getFolderLinksForSliceIds = async (sliceIdsToResolve: number[]): Promise<Array<{ sliceId: number; folderId: number }>> => {
      if (sliceIdsToResolve.length === 0) return []

      const links: Array<{ sliceId: number; folderId: number }> = []
      const dedupe = new Set<string>()

      if (hasLegacyCollectionSlices) {
        const placeholders = sliceIdsToResolve.map(() => '?').join(',')
        const legacyLinks = sqlite
          .prepare(`SELECT slice_id as sliceId, collection_id as folderId FROM collection_slices WHERE slice_id IN (${placeholders})`)
          .all(...sliceIdsToResolve) as Array<{ sliceId: number; folderId: number }>

        for (const row of legacyLinks) {
          const key = `${row.sliceId}:${row.folderId}`
          if (!dedupe.has(key)) {
            dedupe.add(key)
            links.push(row)
          }
        }
      }

      if (hasModernFolderSlices) {
        const modernRows = await db
          .select()
          .from(schema.folderSlices)
          .where(inArray(schema.folderSlices.sliceId, sliceIdsToResolve))

        for (const row of modernRows) {
          const link = { sliceId: row.sliceId, folderId: row.folderId }
          const key = `${link.sliceId}:${link.folderId}`
          if (!dedupe.has(key)) {
            dedupe.add(key)
            links.push(link)
          }
        }
      }

      return links
    }

    // Parse scope
    if (scope === 'youtube') {
      // All YouTube slices
      conditions.push(eq(schema.tracks.source, 'youtube'))
    } else if (scope.startsWith('youtube:')) {
      // Specific YouTube video
      const trackId = parseInt(scope.split(':')[1])
      conditions.push(eq(schema.slices.trackId, trackId))
    } else if (scope === 'local') {
      // Individual local samples (no folderPath)
      conditions.push(
        and(
          eq(schema.tracks.source, 'local'),
          isNull(schema.tracks.folderPath)
        )
      )
    } else if (scope.startsWith('soundcloud:')) {
      const scopedTrackId = scope.slice('soundcloud:'.length).trim()
      const trackId = Number.parseInt(scopedTrackId, 10)
      if (!Number.isInteger(trackId) || String(trackId) !== scopedTrackId) {
        return res.status(400).json({ error: 'Invalid soundcloud scope' })
      }
      conditions.push(
        and(
          eq(schema.slices.trackId, trackId),
          sql`${schema.tracks.youtubeId} GLOB 'sc_*'`
        )
      )
    } else if (scope === 'soundcloud') {
      conditions.push(
        and(
          eq(schema.tracks.source, 'local'),
          isNull(schema.tracks.folderPath),
          sql`${schema.tracks.youtubeId} GLOB 'sc_*'`
        )
      )
    } else if (scope.startsWith('spotify:')) {
      const scopedTrackId = scope.slice('spotify:'.length).trim()
      const trackId = Number.parseInt(scopedTrackId, 10)
      if (!Number.isInteger(trackId) || String(trackId) !== scopedTrackId) {
        return res.status(400).json({ error: 'Invalid spotify scope' })
      }
      conditions.push(
        and(
          eq(schema.slices.trackId, trackId),
          sql`${schema.tracks.youtubeId} GLOB 'spotify_*'`
        )
      )
    } else if (scope === 'spotify') {
      conditions.push(
        and(
          eq(schema.tracks.source, 'local'),
          isNull(schema.tracks.folderPath),
          sql`${schema.tracks.youtubeId} GLOB 'spotify_*'`
        )
      )
    } else if (scope.startsWith('bandcamp:')) {
      const scopedTrackId = scope.slice('bandcamp:'.length).trim()
      const trackId = Number.parseInt(scopedTrackId, 10)
      if (!Number.isInteger(trackId) || String(trackId) !== scopedTrackId) {
        return res.status(400).json({ error: 'Invalid bandcamp scope' })
      }
      conditions.push(
        and(
          eq(schema.slices.trackId, trackId),
          sql`(${schema.tracks.youtubeId} GLOB 'bandcamp_*' OR ${schema.tracks.youtubeId} GLOB 'bc_*')`
        )
      )
    } else if (scope === 'bandcamp') {
      conditions.push(
        and(
          eq(schema.tracks.source, 'local'),
          isNull(schema.tracks.folderPath),
          sql`(${schema.tracks.youtubeId} GLOB 'bandcamp_*' OR ${schema.tracks.youtubeId} GLOB 'bc_*')`
        )
      )
    } else if (scope.startsWith('folder:') || scope.startsWith('my-folder:')) {
      // Two folder scope variants share the same prefix:
      // - folder:{path}  => imported local folder path (string)
      // - my-folder:{id} => app "My Folder" membership (numeric id)
      // - folder:{id}    => backward-compatible app "My Folder" membership
      // Only apply path-based track filtering for imported-folder scopes.
      const isMyFolderScope = scope.startsWith('my-folder:')
      const folderScopeValue = isMyFolderScope ? scope.slice('my-folder:'.length) : scope.slice('folder:'.length)
      const folderId = Number.parseInt(folderScopeValue, 10)
      const isFolderIdScope =
        isMyFolderScope || (!Number.isNaN(folderId) && String(folderId) === folderScopeValue)

      if (!isFolderIdScope) {
        conditions.push(
          and(
            eq(schema.tracks.source, 'local'),
            isNotNull(schema.tracks.folderPath)
          )
        )
      }
    } else if (scope.startsWith('collection:')) {
      // Samples across all folders in a collection - handled separately below
    }
    // 'all' has no additional conditions

    // Favorites filter
    if (favorites === 'true') {
      conditions.push(eq(schema.slices.favorite, 1))
    }

    // Search filter (case-insensitive using SQL)
    if (search && search.trim()) {
      const searchTerm = `%${search.trim().toLowerCase()}%`
      conditions.push(
        sql`(lower(${schema.slices.name}) LIKE ${searchTerm} OR lower(${schema.tracks.title}) LIKE ${searchTerm})`
      )
    }

    // Build query
    let slicesQuery = db
      .select({
        id: schema.slices.id,
        trackId: schema.slices.trackId,
        name: schema.slices.name,
        startTime: schema.slices.startTime,
        endTime: schema.slices.endTime,
        filePath: schema.slices.filePath,
        favorite: schema.slices.favorite,
        sampleType: schema.slices.sampleType,
        sampleModified: schema.slices.sampleModified,
        sampleModifiedAt: schema.slices.sampleModifiedAt,
        createdAt: schema.slices.createdAt,
        trackTitle: schema.tracks.title,
        trackYoutubeId: schema.tracks.youtubeId,
        trackSource: schema.tracks.source,
        trackFolderPath: schema.tracks.folderPath,
        trackOriginalPath: schema.tracks.originalPath,
        trackRelativePath: schema.tracks.relativePath,
        trackFullPathHint: schema.tracks.fullPathHint,
        trackUri: schema.tracks.uri,
        trackArtist: schema.tracks.artist,
        trackAlbum: schema.tracks.album,
        trackYear: schema.tracks.year,
        trackAlbumArtist: schema.tracks.albumArtist,
        trackGenre: schema.tracks.genre,
        trackComposer: schema.tracks.composer,
        trackTrackNumber: schema.tracks.trackNumber,
        trackDiscNumber: schema.tracks.discNumber,
        trackComment: schema.tracks.trackComment,
        trackMusicalKey: schema.tracks.musicalKey,
        trackTagBpm: schema.tracks.tagBpm,
        trackIsrc: schema.tracks.isrc,
        // Audio features
        sampleRate: schema.audioFeatures.sampleRate,
        channels: schema.audioFeatures.channels,
        fileFormat: schema.audioFeatures.fileFormat,
        sourceMtime: schema.audioFeatures.sourceMtime,
        sourceCtime: schema.audioFeatures.sourceCtime,
        bpm: schema.audioFeatures.bpm,
        keyEstimate: schema.audioFeatures.keyEstimate,
        scale: schema.audioFeatures.scale,
        fundamentalFrequency: schema.audioFeatures.fundamentalFrequency,
        polyphony: schema.audioFeatures.polyphony,
        envelopeType: schema.audioFeatures.envelopeType,
        genrePrimary: schema.audioFeatures.genrePrimary,
        instrumentType: schema.audioFeatures.instrumentType,
        brightness: schema.audioFeatures.brightness,
        warmth: schema.audioFeatures.warmth,
        hardness: schema.audioFeatures.hardness,
        sharpness: schema.audioFeatures.sharpness,
        noisiness: schema.audioFeatures.noisiness,
        loudness: schema.audioFeatures.loudness,
        roughness: schema.audioFeatures.roughness,
        dynamicRange: schema.audioFeatures.dynamicRange,
        attackTime: schema.audioFeatures.attackTime,
        onsetRate: schema.audioFeatures.onsetRate,
        harmonicPercussiveRatio: schema.audioFeatures.harmonicPercussiveRatio,
        rhythmicRegularity: schema.audioFeatures.rhythmicRegularity,
        stereoWidth: schema.audioFeatures.stereoWidth,
        eventCount: schema.audioFeatures.eventCount,
        eventDensity: schema.audioFeatures.eventDensity,
        releaseTime: schema.audioFeatures.releaseTime,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .leftJoin(schema.audioFeatures, eq(schema.slices.id, schema.audioFeatures.sliceId))

    // Apply conditions
    if (conditions.length > 0) {
      slicesQuery = slicesQuery.where(and(...conditions)) as typeof slicesQuery
    }

    let slices = await slicesQuery

    // Defensive dedupe for mixed-schema deployments where join paths can duplicate rows.
    slices = Array.from(new Map(slices.map((slice) => [slice.id, slice])).values())

    // Handle folder scope (post-filter since it requires join)
    if (scope.startsWith('folder:') || scope.startsWith('my-folder:')) {
      const folderScopeValue = scope.startsWith('my-folder:')
        ? scope.slice('my-folder:'.length)
        : scope.slice('folder:'.length)
      const folderId = Number.parseInt(folderScopeValue, 10)
      const isFolderIdScope =
        scope.startsWith('my-folder:') || (!Number.isNaN(folderId) && String(folderId) === folderScopeValue)

      if (isFolderIdScope) {
        const folderSliceIds = await getFolderSliceIds([folderId])
        const sliceIdSet = new Set(folderSliceIds)
        slices = slices.filter(s => sliceIdSet.has(s.id))
      } else {
        slices = slices.filter((slice) => {
          const trackFolderScopePath = getImportedTrackFolderScopePath(
            slice.trackFolderPath,
            slice.trackRelativePath,
            slice.trackOriginalPath
          )
          return isPathInFolderScope(trackFolderScopePath, folderScopeValue)
        })
      }
    }

    // Handle collection scope (all samples across all folders in the collection)
    if (scope.startsWith('collection:')) {
      const collectionId = parseInt(scope.split(':')[1])

      const folderIds = await getFolderIdsForCollection(collectionId)

      if (folderIds.length > 0) {
        const collectionSliceIds = await getFolderSliceIds(folderIds)
        const sliceIdSet = new Set(collectionSliceIds)
        slices = slices.filter(s => sliceIdSet.has(s.id))
      } else {
        slices = []
      }
    }

    const tagsBySlice = new Map<number, typeof schema.tags.$inferSelect[]>()
    let filteredSlices = slices

    if (selectedTagIds.length > 0) {
      const candidateSliceIds = filteredSlices.map((slice) => slice.id)
      if (candidateSliceIds.length === 0) {
        filteredSlices = []
      } else {
        const selectedTagSet = new Set(selectedTagIds)
        const rows = await db
          .select({
            sliceId: schema.sliceTags.sliceId,
            tagId: schema.sliceTags.tagId,
          })
          .from(schema.sliceTags)
          .where(
            and(
              inArray(schema.sliceTags.sliceId, candidateSliceIds),
              inArray(schema.sliceTags.tagId, selectedTagIds),
            )
          )

        const tagIdsBySlice = new Map<number, Set<number>>()
        for (const row of rows) {
          if (!tagIdsBySlice.has(row.sliceId)) {
            tagIdsBySlice.set(row.sliceId, new Set<number>())
          }
          tagIdsBySlice.get(row.sliceId)!.add(row.tagId)
        }

        filteredSlices = filteredSlices.filter((slice) => {
          const found = tagIdsBySlice.get(slice.id)
          if (!found || found.size < selectedTagSet.size) return false
          for (const tagId of selectedTagSet) {
            if (!found.has(tagId)) return false
          }
          return true
        })
      }
    }

    // BPM filter
    if (minBpm || maxBpm) {
      const minBpmNum = minBpm ? parseFloat(minBpm) : 0
      const maxBpmNum = maxBpm ? parseFloat(maxBpm) : Infinity
      filteredSlices = filteredSlices.filter(slice => {
        if (slice.bpm === null || slice.bpm === undefined) return false
        return slice.bpm >= minBpmNum && slice.bpm <= maxBpmNum
      })
    }

    // Key filter
    if (keys && keys.trim()) {
      const keyList = keys.split(',').map(k => k.trim().toLowerCase())
      filteredSlices = filteredSlices.filter(slice => {
        if (!slice.keyEstimate) return false
        return keyList.includes(slice.keyEstimate.toLowerCase())
      })
    }

    // Fundamental frequency note filter
    if (notes && notes.trim()) {
      const noteList = notes.split(',').map(n => n.trim())
      filteredSlices = filteredSlices.filter(slice => {
        if (!slice.fundamentalFrequency) return false
        const noteName = freqToNoteName(slice.fundamentalFrequency)
        return noteName !== null && noteList.includes(noteName)
      })
    }

    // Date Added range filter
    if (dateAddedFromTs !== null || dateAddedToTs !== null) {
      filteredSlices = filteredSlices.filter((slice) =>
        isWithinDateRange(slice.createdAt, dateAddedFromTs, dateAddedToTs)
      )
    }

    // Source file creation-date range filter
    if (dateCreatedFromTs !== null || dateCreatedToTs !== null) {
      filteredSlices = filteredSlices.filter((slice) =>
        isWithinDateRange(slice.sourceCtime, dateCreatedFromTs, dateCreatedToTs)
      )
    }

    // Source file modified-date range filter
    if (dateUpdatedFromTs !== null || dateUpdatedToTs !== null) {
      filteredSlices = filteredSlices.filter((slice) =>
        isWithinDateRange(slice.sourceMtime, dateUpdatedFromTs, dateUpdatedToTs)
      )
    }

    // Keep payload unique by slice id after all post-filters.
    filteredSlices = Array.from(new Map(filteredSlices.map((slice) => [slice.id, slice])).values())

    const filteredSliceIdsForTags = filteredSlices.map((slice) => slice.id)
    if (filteredSliceIdsForTags.length > 0) {
      const sliceTagsResult = await db
        .select()
        .from(schema.sliceTags)
        .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
        .where(inArray(schema.sliceTags.sliceId, filteredSliceIdsForTags))

      for (const row of sliceTagsResult) {
        const sliceId = row.slice_tags.sliceId
        if (!tagsBySlice.has(sliceId)) {
          tagsBySlice.set(sliceId, [])
        }
        tagsBySlice.get(sliceId)!.push(row.tags)
      }
    }

    // Similarity filter and calculation
    let similarityScores = new Map<number, number>()
    if (similarTo) {
      const similarToId = parseInt(similarTo, 10)
      const minSimilarityValue = minSimilarity ? parseFloat(minSimilarity) : 0.5

      if (!isNaN(similarToId)) {
        const targetFeatures = await db
          .select()
          .from(schema.audioFeatures)
          .where(eq(schema.audioFeatures.sliceId, similarToId))
          .limit(1)

        if (targetFeatures.length > 0) {
          const target = targetFeatures[0]
          const sliceIds = filteredSlices.map(s => s.id).filter(id => id !== similarToId)

          if (sliceIds.length > 0) {
            if (target.yamnetEmbeddings) {
              // Best quality: use 1024-dim YAMNet embeddings
              const targetEmbeddings = JSON.parse(target.yamnetEmbeddings) as number[]
              const embeddingsResults = await db
                .select({
                  sliceId: schema.audioFeatures.sliceId,
                  yamnetEmbeddings: schema.audioFeatures.yamnetEmbeddings,
                })
                .from(schema.audioFeatures)
                .where(
                  and(
                    inArray(schema.audioFeatures.sliceId, sliceIds),
                    isNotNull(schema.audioFeatures.yamnetEmbeddings)
                  )
                )
              for (const result of embeddingsResults) {
                if (result.yamnetEmbeddings) {
                  const embeddings = JSON.parse(result.yamnetEmbeddings) as number[]
                  similarityScores.set(result.sliceId, cosineSimilarity(targetEmbeddings, embeddings))
                }
              }
            } else {
              // Fallback: cosine similarity over normalised scalar audio features
              const targetVec = buildScalarFeatureVector(target)
              if (targetVec) {
                const candidateFeatures = await db
                  .select()
                  .from(schema.audioFeatures)
                  .where(inArray(schema.audioFeatures.sliceId, sliceIds))
                for (const f of candidateFeatures) {
                  const candidateVec = buildScalarFeatureVector(f)
                  if (candidateVec) {
                    similarityScores.set(f.sliceId, cosineSimilarity(targetVec, candidateVec))
                  }
                }
              }
            }

            // Filter by minimum similarity threshold
            filteredSlices = filteredSlices.filter(slice => {
              if (slice.id === similarToId) return false
              const similarity = similarityScores.get(slice.id)
              return similarity !== undefined && similarity >= minSimilarityValue
            })
          }
        }
      }
    }

    // Sorting - default to similarity DESC when in similarity mode
    const effectiveSortBy = sortBy || (similarTo ? 'similarity' : undefined)
    const effectiveSortOrder = sortOrder || (similarTo ? 'desc' : 'asc')

    if (effectiveSortBy) {
      filteredSlices.sort((a, b) => {
        let aVal: any
        let bVal: any

        switch (effectiveSortBy) {
          case 'artist':
            aVal = (a.trackArtist ?? '').toLowerCase()
            bVal = (b.trackArtist ?? '').toLowerCase()
            break
          case 'album':
            aVal = (a.trackAlbum ?? '').toLowerCase()
            bVal = (b.trackAlbum ?? '').toLowerCase()
            break
          case 'year':
            aVal = a.trackYear ?? -1
            bVal = b.trackYear ?? -1
            break
          case 'albumArtist':
            aVal = (a.trackAlbumArtist ?? '').toLowerCase()
            bVal = (b.trackAlbumArtist ?? '').toLowerCase()
            break
          case 'genre':
            aVal = (a.trackGenre ?? '').toLowerCase()
            bVal = (b.trackGenre ?? '').toLowerCase()
            break
          case 'composer':
            aVal = (a.trackComposer ?? '').toLowerCase()
            bVal = (b.trackComposer ?? '').toLowerCase()
            break
          case 'trackNumber':
            aVal = a.trackTrackNumber ?? -1
            bVal = b.trackTrackNumber ?? -1
            break
          case 'discNumber':
            aVal = a.trackDiscNumber ?? -1
            bVal = b.trackDiscNumber ?? -1
            break
          case 'tagBpm':
            aVal = a.trackTagBpm ?? -1
            bVal = b.trackTagBpm ?? -1
            break
          case 'musicalKey':
            aVal = (a.trackMusicalKey ?? '').toLowerCase()
            bVal = (b.trackMusicalKey ?? '').toLowerCase()
            break
          case 'isrc':
            aVal = (a.trackIsrc ?? '').toLowerCase()
            bVal = (b.trackIsrc ?? '').toLowerCase()
            break
          case 'bpm':
            aVal = a.bpm ?? -1
            bVal = b.bpm ?? -1
            break
          case 'key':
            aVal = a.keyEstimate ?? ''
            bVal = b.keyEstimate ?? ''
            break
          case 'scale':
            aVal = a.scale ?? ''
            bVal = b.scale ?? ''
            break
          case 'note':
            aVal = a.fundamentalFrequency ?? -1
            bVal = b.fundamentalFrequency ?? -1
            break
          case 'polyphony':
            aVal = a.polyphony ?? -1
            bVal = b.polyphony ?? -1
            break
          case 'envelope':
            aVal = a.envelopeType ?? ''
            bVal = b.envelopeType ?? ''
            break
          case 'brightness':
            aVal = a.brightness ?? -1
            bVal = b.brightness ?? -1
            break
          case 'noisiness':
            aVal = (a.noisiness ?? a.roughness) ?? -1
            bVal = (b.noisiness ?? b.roughness) ?? -1
            break
          case 'warmth':
            aVal = a.warmth ?? -1
            bVal = b.warmth ?? -1
            break
          case 'hardness':
            aVal = a.hardness ?? -1
            bVal = b.hardness ?? -1
            break
          case 'sharpness':
            aVal = a.sharpness ?? -1
            bVal = b.sharpness ?? -1
            break
          case 'loudness':
            aVal = a.loudness ?? -1
            bVal = b.loudness ?? -1
            break
          case 'sampleRate':
            aVal = a.sampleRate ?? -1
            bVal = b.sampleRate ?? -1
            break
          case 'channels':
            aVal = a.channels ?? -1
            bVal = b.channels ?? -1
            break
          case 'format':
            aVal = a.fileFormat ?? ''
            bVal = b.fileFormat ?? ''
            break
          case 'dateModified':
            aVal = a.sourceMtime ?? ''
            bVal = b.sourceMtime ?? ''
            break
          case 'dateCreated':
            aVal = a.sourceCtime ?? ''
            bVal = b.sourceCtime ?? ''
            break
          case 'dateAdded':
            aVal = a.createdAt
            bVal = b.createdAt
            break
          case 'path':
            aVal = (
              deriveRelativePathDisplay(a.trackFolderPath, a.trackOriginalPath, a.trackRelativePath) ||
              a.trackOriginalPath ||
              a.trackFullPathHint ||
              ''
            ).toLowerCase()
            bVal = (
              deriveRelativePathDisplay(b.trackFolderPath, b.trackOriginalPath, b.trackRelativePath) ||
              b.trackOriginalPath ||
              b.trackFullPathHint ||
              ''
            ).toLowerCase()
            break
          case 'uri':
            aVal = (a.trackUri || '').toLowerCase()
            bVal = (b.trackUri || '').toLowerCase()
            break
          case 'name':
            aVal = a.name.toLowerCase()
            bVal = b.name.toLowerCase()
            break
          case 'duration':
            aVal = a.endTime - a.startTime
            bVal = b.endTime - b.startTime
            break
          case 'similarity':
            aVal = similarityScores.get(a.id) ?? -1
            bVal = similarityScores.get(b.id) ?? -1
            break
          case 'createdAt':
          default:
            aVal = a.createdAt
            bVal = b.createdAt
            break
        }

        // Handle null/undefined values - always sort them last
        if (aVal === null || aVal === undefined || aVal === -1) return 1
        if (bVal === null || bVal === undefined || bVal === -1) return -1

        // Compare values
        if (aVal < bVal) return effectiveSortOrder === 'asc' ? -1 : 1
        if (aVal > bVal) return effectiveSortOrder === 'asc' ? 1 : -1
        return 0
      })
    }

    // Get folder memberships for filtered slices
    const filteredSliceIds = filteredSlices.map(s => s.id)
    const folderLinks = await getFolderLinksForSliceIds(filteredSliceIds)

    const foldersBySlice = new Map<number, Set<number>>()
    for (const row of folderLinks) {
      if (!foldersBySlice.has(row.sliceId)) {
        foldersBySlice.set(row.sliceId, new Set())
      }
      foldersBySlice.get(row.sliceId)!.add(row.folderId)
    }

    // Best-effort backfill for fields that can be derived without re-analysis.
    const derivedUpdates = filteredSlices
      .map((slice) => {
        const derivedScale = slice.scale ?? parseScaleFromKeyEstimate(slice.keyEstimate)
        const derivedNoisiness = slice.noisiness ?? slice.roughness ?? null
        const needsScale = !slice.scale && !!derivedScale
        const needsNoisiness = slice.noisiness == null && derivedNoisiness != null

        if (!needsScale && !needsNoisiness) return null
        return { sliceId: slice.id, scale: derivedScale, noisiness: derivedNoisiness }
      })
      .filter((entry): entry is { sliceId: number; scale: string | null; noisiness: number | null } => entry !== null)

    for (const update of derivedUpdates) {
      await db
        .update(schema.audioFeatures)
        .set({
          scale: update.scale,
          noisiness: update.noisiness,
        })
        .where(eq(schema.audioFeatures.sliceId, update.sliceId))
    }

    // Normalize dimensions against the current candidate slice set so sliders
    // respond to the active scope instead of unrelated global outliers.
    const getRangeFromSlices = (
      selector: (slice: typeof filteredSlices[number]) => number | null | undefined
    ): Range => {
      let min = Number.POSITIVE_INFINITY
      let max = Number.NEGATIVE_INFINITY
      let hasValue = false

      for (const slice of filteredSlices) {
        const value = selector(slice)
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        if (value < min) min = value
        if (value > max) max = value
        hasValue = true
      }

      return hasValue ? { min, max } : { min: null, max: null }
    }

    const toFiniteNumber = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'bigint') {
        const converted = Number(value)
        return Number.isFinite(converted) ? converted : null
      }
      if (typeof value === 'string' && value.trim().length > 0) {
        const converted = Number.parseFloat(value)
        return Number.isFinite(converted) ? converted : null
      }
      return null
    }

    const getDensityMetric = (slice: typeof filteredSlices[number]): number | null => {
      const eventDensity = toFiniteNumber(slice.eventDensity)
      if (eventDensity !== null) {
        return eventDensity
      }

      const eventCount = toFiniteNumber(slice.eventCount)
      if (eventCount !== null) {
        const startTime = toFiniteNumber(slice.startTime)
        const endTime = toFiniteNumber(slice.endTime)
        if (startTime !== null && endTime !== null) {
          const duration = endTime - startTime
          if (duration > 0) {
            return eventCount / duration
          }
        }
      }

      const onsetRate = toFiniteNumber(slice.onsetRate)
      if (onsetRate !== null) {
        return onsetRate
      }

      return null
    }

    const dimensionRanges: DimensionRanges = {
      brightness: getRangeFromSlices((slice) => slice.brightness),
      harmonicity: getRangeFromSlices((slice) => slice.harmonicPercussiveRatio),
      noisiness: getRangeFromSlices((slice) => slice.noisiness ?? slice.roughness),
      attack: getRangeFromSlices((slice) => slice.hardness),
      dynamics: getRangeFromSlices((slice) => slice.dynamicRange),
      saturation: getRangeFromSlices((slice) => slice.roughness),
      surface: getRangeFromSlices((slice) => slice.roughness),
      rhythmic: getRangeFromSlices((slice) => slice.rhythmicRegularity),
      density: getRangeFromSlices((slice) => getDensityMetric(slice)),
      ambience: getRangeFromSlices((slice) => slice.releaseTime),
      stereoWidth: getRangeFromSlices((slice) => slice.stereoWidth),
      depth: getRangeFromSlices((slice) =>
        typeof slice.loudness === 'number' ? -slice.loudness : null
      ),
    }

    const perceptualRanges: Record<'brightness' | 'noisiness' | 'warmth' | 'hardness' | 'sharpness', Range> = {
      brightness: dimensionRanges.brightness,
      noisiness: dimensionRanges.noisiness,
      warmth: getRangeFromSlices((slice) => slice.warmth),
      hardness: getRangeFromSlices((slice) => slice.hardness),
      sharpness: getRangeFromSlices((slice) => slice.sharpness),
    }

    const getNormalizedDimensions = (slice: typeof filteredSlices[number]) => {
      const noisiness = slice.noisiness ?? slice.roughness ?? null
      const depthRaw = typeof slice.loudness === 'number' ? -slice.loudness : null
      const densityRaw = getDensityMetric(slice)
      return {
        brightness: normalizeValue(slice.brightness, dimensionRanges.brightness),
        harmonicity: normalizeValue(slice.harmonicPercussiveRatio, dimensionRanges.harmonicity),
        noisiness: normalizeValue(noisiness, dimensionRanges.noisiness),
        attack: normalizeValue(slice.hardness, dimensionRanges.attack),
        dynamics: normalizeValue(slice.dynamicRange, dimensionRanges.dynamics),
        saturation: normalizeValue(slice.roughness, dimensionRanges.saturation),
        surface: normalizeValue(slice.roughness, dimensionRanges.surface),
        rhythmic: normalizeValue(slice.rhythmicRegularity, dimensionRanges.rhythmic),
        density: normalizeValue(densityRaw, dimensionRanges.density),
        ambience: normalizeValue(slice.releaseTime, dimensionRanges.ambience),
        stereoWidth: normalizeValue(slice.stereoWidth, dimensionRanges.stereoWidth),
        depth: normalizeValue(depthRaw, dimensionRanges.depth),
      }
    }

    const dimensionFilterEntries = Object.entries(dimensionFilters) as Array<[DimensionKey, Range]>
    const hasDimensionFilters = dimensionFilterEntries.some(
      ([, range]) => range.min !== null || range.max !== null
    )
    if (hasDimensionFilters) {
      filteredSlices = filteredSlices.filter((slice) => {
        const normalizedDimensions = getNormalizedDimensions(slice)
        for (const [key, range] of dimensionFilterEntries) {
          if (range.min === null && range.max === null) continue
          const value = normalizedDimensions[key]
          if (value === null) return false
          if (range.min !== null && value < range.min) return false
          if (range.max !== null && value > range.max) return false
        }
        return true
      })
    }

    const result = filteredSlices.map((slice) => {
      const normalizedTags = sanitizeSliceTagsAndSampleType(
        tagsBySlice.get(slice.id) || [],
        slice.sampleType
      )

      return {
      ...(function () {
        const derivedScale = slice.scale ?? parseScaleFromKeyEstimate(slice.keyEstimate)
        const noisiness = slice.noisiness ?? slice.roughness ?? null
        const relativePath = deriveRelativePathDisplay(
          slice.trackFolderPath,
          slice.trackOriginalPath,
          slice.trackRelativePath
        )
        const pathDisplay = relativePath || slice.trackOriginalPath || slice.trackFullPathHint || null
        const absolutePath = slice.trackFullPathHint || slice.trackOriginalPath || null

        const subjectiveNormalized = {
          brightness: normalizeValue(slice.brightness, perceptualRanges.brightness),
          noisiness: normalizeValue(noisiness, perceptualRanges.noisiness),
          warmth: normalizeValue(slice.warmth, perceptualRanges.warmth),
          hardness: normalizeValue(slice.hardness, perceptualRanges.hardness),
          sharpness: normalizeValue(slice.sharpness, perceptualRanges.sharpness),
        }

        const dimensionNormalized = getNormalizedDimensions(slice)

        return {
          scale: derivedScale,
          sampleRate: slice.sampleRate,
          channels: slice.channels,
          format: slice.fileFormat,
          dateModified: slice.sourceMtime,
          dateCreated: slice.sourceCtime,
          warmth: slice.warmth,
          hardness: slice.hardness,
          sharpness: slice.sharpness,
          noisiness,
          polyphony: slice.polyphony,
          pathDisplay,
          absolutePath,
          uri: slice.trackUri || null,
          subjectiveNormalized,
          dimensionNormalized,
        }
      })(),
      id: slice.id,
      trackId: slice.trackId,
      name: slice.name,
      startTime: slice.startTime,
      endTime: slice.endTime,
      filePath: slice.filePath,
      favorite: slice.favorite === 1,
      sampleType: normalizedTags.sampleType,
      sampleModified: slice.sampleModified === 1,
      sampleModifiedAt: slice.sampleModifiedAt,
      dateAdded: slice.createdAt,
      createdAt: slice.createdAt,
      tags: normalizedTags.tags,
      folderIds: Array.from(foldersBySlice.get(slice.id) || []),
      bpm: slice.bpm,
      keyEstimate: slice.keyEstimate,
      fundamentalFrequency: slice.fundamentalFrequency,
      envelopeType: slice.envelopeType,
      genrePrimary: slice.genrePrimary,
      instrumentType: slice.instrumentType,
      brightness: slice.brightness,
      loudness: slice.loudness,
      roughness: slice.roughness,
      stereoWidth: slice.stereoWidth,
      rhythmicRegularity: slice.rhythmicRegularity,
      similarity: similarityScores.get(slice.id),
      track: {
        title: slice.trackTitle,
        youtubeId: slice.trackYoutubeId,
        source: slice.trackSource,
        folderPath: slice.trackFolderPath,
        originalPath: slice.trackOriginalPath,
        relativePath: slice.trackRelativePath,
        fullPathHint: slice.trackFullPathHint,
        uri: slice.trackUri,
        artist: slice.trackArtist,
        album: slice.trackAlbum,
        year: slice.trackYear,
        albumArtist: slice.trackAlbumArtist,
        genre: slice.trackGenre,
        composer: slice.trackComposer,
        trackNumber: slice.trackTrackNumber,
        discNumber: slice.trackDiscNumber,
        trackComment: slice.trackComment,
        musicalKey: slice.trackMusicalKey,
        tagBpm: slice.trackTagBpm,
        isrc: slice.trackIsrc,
      },
      }
    })

    res.json({
      samples: result,
      total: result.length,
    })
  } catch (error) {
    console.error('Error fetching sources samples:', error)
    res.status(500).json({ error: 'Failed to fetch samples' })
  }
})

// Helper function to auto-tag a slice using audio analysis
async function autoTagSlice(sliceId: number, audioPath: string): Promise<void> {
  try {
    const level: 'advanced' = 'advanced'
    console.log(`Running audio analysis on slice ${sliceId} (level: ${level})...`)

    const sliceContext = await db
      .select({
        name: schema.slices.name,
        source: schema.tracks.source,
        folderPath: schema.tracks.folderPath,
        relativePath: schema.tracks.relativePath,
      })
      .from(schema.slices)
      .leftJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .where(eq(schema.slices.id, sliceId))
      .limit(1)

    const pathHint = buildSamplePathHint({
      folderPath: sliceContext[0]?.folderPath ?? null,
      relativePath: sliceContext[0]?.relativePath ?? null,
      filename: sliceContext[0]?.name ?? null,
    })

    // Analyze audio with Python (Essentia + Librosa)
    const features = await analyzeAudioFeatures(audioPath, level, {
      filename: sliceContext[0]?.name ?? undefined,
    })
    const fileMetadata = await getAudioFileMetadata(audioPath).catch(() => null)
    const enrichedFeatures = {
      ...features,
      sampleRate: fileMetadata?.sampleRate ?? features.sampleRate,
      channels: fileMetadata?.channels ?? undefined,
      fileFormat: fileMetadata?.format ?? undefined,
      sourceMtime: fileMetadata?.modifiedAt ?? undefined,
      sourceCtime: fileMetadata?.createdAt ?? undefined,
    }

    console.log(`Analysis complete for slice ${sliceId}:`, {
      isOneShot: features.isOneShot,
      isLoop: features.isLoop,
      bpm: features.bpm,
      spectralCentroid: features.spectralCentroid.toFixed(1),
      analysisDurationMs: features.analysisDurationMs,
    })

    // Store raw features in database
    await storeAudioFeatures(sliceId, enrichedFeatures, {
      sampleName: sliceContext[0]?.name ?? null,
      pathHint,
      preferPathHint: true,
    })

    // Build post-analysis tag plan (Ollama sanity stage).
    const reviewedTags = await postAnalyzeSampleTags({
      features,
      sampleName: sliceContext[0]?.name ?? null,
      folderPath: pathHint,
      modelTags: featuresToTags(features),
    })

    // Get existing tags for this slice to avoid duplicating filename-derived tags
    const existingSliceTags = await db
      .select({ name: schema.tags.name })
      .from(schema.sliceTags)
      .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
      .where(eq(schema.sliceTags.sliceId, sliceId))
    const existingTagNames = new Set(existingSliceTags.map(t => t.name.toLowerCase()))

    if (reviewedTags.length === 0) {
      console.log(`No tags generated for slice ${sliceId}`)
      return
    }

    console.log(
      `Applying ${reviewedTags.length} reviewed tags to slice ${sliceId}:`,
      reviewedTags.map((tag) => tag.name).join(', ')
    )

    // Create tags and link them to the slice
    for (const reviewedTag of reviewedTags) {
      const lowerTag = reviewedTag.name.toLowerCase()
      if (existingTagNames.has(lowerTag)) continue // Skip already-applied tags
      const { color, category } = getTagMetadata(lowerTag, reviewedTag.category)

      try {
        // Check if tag exists
        let tag = await db
          .select()
          .from(schema.tags)
          .where(eq(schema.tags.name, lowerTag))
          .limit(1)

        // Create tag if it doesn't exist
        if (tag.length === 0) {
          const [newTag] = await db
            .insert(schema.tags)
            .values({
              name: lowerTag,
              color,
              category,
            })
            .returning()
          tag = [newTag]
        } else if (tag[0].category === 'filename' && category !== 'filename') {
          await db
            .update(schema.tags)
            .set({
              color,
              category,
            })
            .where(eq(schema.tags.id, tag[0].id))
        }

        // Link tag to slice
        await db
          .insert(schema.sliceTags)
          .values({ sliceId, tagId: tag[0].id })
          .onConflictDoNothing()
      } catch (error) {
        console.error(`Failed to add tag ${lowerTag} to slice ${sliceId}:`, error)
      }
    }

    console.log(`Successfully auto-tagged slice ${sliceId}`)
  } catch (error) {
    console.error(`Error auto-tagging slice ${sliceId}:`, error)
    // Don't throw - auto-tagging is optional
  }
}

// Get total sample count
router.get('/slices/count', async (_req, res) => {
  try {
    const row = await db
      .select({
        total: sql<number>`cast(count(*) as integer)`,
      })
      .from(schema.slices)
      .get()

    res.json({ total: row?.total ?? 0 })
  } catch (error) {
    console.error('Error getting slice count:', error)
    res.status(500).json({ error: 'Failed to get slice count' })
  }
})

function parseOptionalJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function serializeSliceAudioFeaturesForList(
  feature: typeof schema.audioFeatures.$inferSelect | undefined
) {
  if (!feature) return null

  return {
    id: feature.id,
    sliceId: feature.sliceId,
    duration: feature.duration,
    sampleRate: feature.sampleRate,
    channels: feature.channels,
    fileFormat: feature.fileFormat,
    sourceMtime: feature.sourceMtime,
    sourceCtime: feature.sourceCtime,
    isOneShot: feature.isOneShot === 1,
    isLoop: feature.isLoop === 1,
    bpm: feature.bpm,
    beatsCount: feature.beatsCount,
    onsetCount: feature.onsetCount,
    spectralCentroid: feature.spectralCentroid,
    spectralRolloff: feature.spectralRolloff,
    spectralBandwidth: feature.spectralBandwidth,
    spectralContrast: feature.spectralContrast,
    zeroCrossingRate: feature.zeroCrossingRate,
    mfccMean: parseOptionalJson<number[]>(feature.mfccMean),
    rmsEnergy: feature.rmsEnergy,
    loudness: feature.loudness,
    dynamicRange: feature.dynamicRange,
    keyEstimate: feature.keyEstimate,
    scale: feature.scale,
    keyStrength: feature.keyStrength,
    instrumentPredictions: parseOptionalJson<unknown[]>(feature.instrumentPredictions),
    attackTime: feature.attackTime,
    spectralFlux: feature.spectralFlux,
    spectralFlatness: feature.spectralFlatness,
    kurtosis: feature.kurtosis,
    dissonance: feature.dissonance,
    inharmonicity: feature.inharmonicity,
    tristimulus: parseOptionalJson<number[]>(feature.tristimulus),
    spectralComplexity: feature.spectralComplexity,
    spectralCrest: feature.spectralCrest,
    brightness: feature.brightness,
    warmth: feature.warmth,
    hardness: feature.hardness,
    noisiness: feature.noisiness,
    roughness: feature.roughness,
    sharpness: feature.sharpness,
    melBandsMean: parseOptionalJson<number[]>(feature.melBandsMean),
    melBandsStd: parseOptionalJson<number[]>(feature.melBandsStd),
    stereoWidth: feature.stereoWidth,
    panningCenter: feature.panningCenter,
    stereoImbalance: feature.stereoImbalance,
    harmonicPercussiveRatio: feature.harmonicPercussiveRatio,
    harmonicEnergy: feature.harmonicEnergy,
    percussiveEnergy: feature.percussiveEnergy,
    harmonicCentroid: feature.harmonicCentroid,
    percussiveCentroid: feature.percussiveCentroid,
    onsetRate: feature.onsetRate,
    beatStrength: feature.beatStrength,
    rhythmicRegularity: feature.rhythmicRegularity,
    danceability: feature.danceability,
    decayTime: feature.decayTime,
    sustainLevel: feature.sustainLevel,
    releaseTime: feature.releaseTime,
    envelopeType: feature.envelopeType,
    instrumentClasses: parseOptionalJson<unknown[]>(feature.instrumentClasses),
    genreClasses: parseOptionalJson<unknown[]>(feature.genreClasses),
    genrePrimary: feature.genrePrimary,
    yamnetEmbeddings: parseOptionalJson<number[]>(feature.yamnetEmbeddings),
    mlEmbeddings: parseOptionalJson<number[]>(feature.mlEmbeddings),
    mlEmbeddingModel: feature.mlEmbeddingModel,
    moodClasses: parseOptionalJson<unknown[]>(feature.moodClasses),
    loudnessIntegrated: feature.loudnessIntegrated,
    loudnessRange: feature.loudnessRange,
    loudnessMomentaryMax: feature.loudnessMomentaryMax,
    truePeak: feature.truePeak,
    eventCount: feature.eventCount,
    eventDensity: feature.eventDensity,
    chromaprintFingerprint: feature.chromaprintFingerprint,
    similarityHash: feature.similarityHash,
    instrumentType: feature.instrumentType,
    temporalCentroid: feature.temporalCentroid,
    crestFactor: feature.crestFactor,
    transientSpectralCentroid: feature.transientSpectralCentroid,
    transientSpectralFlatness: feature.transientSpectralFlatness,
    sampleTypeConfidence: feature.sampleTypeConfidence,
    fundamentalFrequency: feature.fundamentalFrequency,
    polyphony: feature.polyphony,
    analysisLevel: feature.analysisLevel,
    analysisVersion: feature.analysisVersion,
    createdAt: feature.createdAt,
    analysisDurationMs: feature.analysisDurationMs,
  }
}

// Get ALL slices (for Samples browser)
router.get('/slices', async (_req, res) => {
  try {
    // Get all slices with their parent track info
    const slices = await db
      .select({
        id: schema.slices.id,
        trackId: schema.slices.trackId,
        name: schema.slices.name,
        startTime: schema.slices.startTime,
        endTime: schema.slices.endTime,
        filePath: schema.slices.filePath,
        favorite: schema.slices.favorite,
        sampleType: schema.slices.sampleType,
        sampleModified: schema.slices.sampleModified,
        sampleModifiedAt: schema.slices.sampleModifiedAt,
        createdAt: schema.slices.createdAt,
        trackTitle: schema.tracks.title,
        trackYoutubeId: schema.tracks.youtubeId,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .orderBy(schema.slices.createdAt)

    // Get tags for all slices
    const sliceIds = slices.map((s) => s.id)

    const audioFeaturesRows =
      sliceIds.length > 0
        ? await db
            .select()
            .from(schema.audioFeatures)
            .where(inArray(schema.audioFeatures.sliceId, sliceIds))
        : []

    const audioFeaturesBySlice = new Map<number, typeof schema.audioFeatures.$inferSelect>()
    for (const feature of audioFeaturesRows) {
      audioFeaturesBySlice.set(feature.sliceId, feature)
    }

    const sliceTagsResult =
      sliceIds.length > 0
        ? await db
            .select()
            .from(schema.sliceTags)
            .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
            .where(inArray(schema.sliceTags.sliceId, sliceIds))
        : []

    const tagsBySlice = new Map<number, typeof schema.tags.$inferSelect[]>()
    for (const row of sliceTagsResult) {
      const sliceId = row.slice_tags.sliceId
      if (!tagsBySlice.has(sliceId)) {
        tagsBySlice.set(sliceId, [])
      }
      tagsBySlice.get(sliceId)!.push(row.tags)
    }

    // Get folder memberships for all slices
    const folderLinks =
      sliceIds.length > 0
        ? await db
            .select()
            .from(schema.folderSlices)
            .where(inArray(schema.folderSlices.sliceId, sliceIds))
        : []

    const foldersBySlice = new Map<number, number[]>()
    for (const row of folderLinks) {
      if (!foldersBySlice.has(row.sliceId)) {
        foldersBySlice.set(row.sliceId, [])
      }
      foldersBySlice.get(row.sliceId)!.push(row.folderId)
    }

    const result = slices.map((slice) => {
      const normalizedTags = sanitizeSliceTagsAndSampleType(
        tagsBySlice.get(slice.id) || [],
        slice.sampleType
      )
      const audioFeatures = serializeSliceAudioFeaturesForList(audioFeaturesBySlice.get(slice.id))

      return {
      id: slice.id,
      trackId: slice.trackId,
      name: slice.name,
      startTime: slice.startTime,
      endTime: slice.endTime,
      filePath: slice.filePath,
      favorite: slice.favorite === 1,
      sampleType: normalizedTags.sampleType,
      sampleModified: slice.sampleModified === 1,
      sampleModifiedAt: slice.sampleModifiedAt,
      createdAt: slice.createdAt,
      bpm: audioFeatures?.bpm ?? null,
      beatsCount: audioFeatures?.beatsCount ?? null,
      audioFeatures,
      tags: normalizedTags.tags,
      folderIds: foldersBySlice.get(slice.id) || [],
      track: {
        title: slice.trackTitle,
        youtubeId: slice.trackYoutubeId,
      },
      }
    })

    res.json(result)
  } catch (error) {
    console.error('Error fetching all slices:', error)
    res.status(500).json({ error: 'Failed to fetch slices' })
  }
})

// Get slices for a track
router.get('/tracks/:trackId/slices', async (req, res) => {
  const trackId = parseInt(req.params.trackId)

  try {
    const slices = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.trackId, trackId))
      .orderBy(schema.slices.startTime)

    // Get tags for each slice
    const sliceIds = slices.map((s) => s.id)
    const sliceTagsResult =
      sliceIds.length > 0
        ? await db
            .select()
            .from(schema.sliceTags)
            .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
            .where(inArray(schema.sliceTags.sliceId, sliceIds))
        : []

    const tagsBySlice = new Map<number, typeof schema.tags.$inferSelect[]>()
    for (const row of sliceTagsResult) {
      const sliceId = row.slice_tags.sliceId
      if (!tagsBySlice.has(sliceId)) {
        tagsBySlice.set(sliceId, [])
      }
      tagsBySlice.get(sliceId)!.push(row.tags)
    }

    const result = slices.map((slice) => {
      const normalizedTags = sanitizeSliceTagsAndSampleType(
        tagsBySlice.get(slice.id) || [],
        slice.sampleType
      )

      return {
        ...slice,
        sampleType: normalizedTags.sampleType,
        tags: normalizedTags.tags,
      }
    })

    res.json(result)
  } catch (error) {
    console.error('Error fetching slices:', error)
    res.status(500).json({ error: 'Failed to fetch slices' })
  }
})

// Create slice
router.post('/tracks/:trackId/slices', async (req, res) => {
  const trackId = parseInt(req.params.trackId)
  const { name, startTime, endTime } = req.body as {
    name: string
    startTime: number
    endTime: number
  }

  if (!name || startTime === undefined || endTime === undefined) {
    return res.status(400).json({ error: 'Name, startTime, and endTime required' })
  }

  if (startTime >= endTime) {
    return res.status(400).json({ error: 'startTime must be less than endTime' })
  }

  try {
    // Get track
    const track = await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, trackId))
      .limit(1)

    if (track.length === 0) {
      return res.status(404).json({ error: 'Track not found' })
    }

    if (!track[0].audioPath) {
      return res.status(400).json({ error: 'Track audio not ready' })
    }

    // Create slice directory
    const slicesDir = path.join(DATA_DIR, 'slices')
    await fs.mkdir(slicesDir, { recursive: true })

    // Insert slice record first to get ID
    const [inserted] = await db
      .insert(schema.slices)
      .values({
        trackId,
        name,
        startTime,
        endTime,
        createdAt: new Date().toISOString(),
      })
      .returning()

    // Extract slice audio
    const sliceFileName = `${track[0].youtubeId}_${inserted.id}.mp3`
    const slicePath = path.join(slicesDir, sliceFileName)

    try {
      await extractSlice(track[0].audioPath, slicePath, startTime, endTime)

      // Update slice with file path
      await db
        .update(schema.slices)
        .set({ filePath: slicePath })
        .where(eq(schema.slices.id, inserted.id))

      inserted.filePath = slicePath

      // Auto-tag the slice with YAMNet (run in background)
      autoTagSlice(inserted.id, slicePath).catch(err => {
        console.error('Background auto-tagging failed:', err)
      })
    } catch (err) {
      console.error('Failed to extract slice audio:', err)
      // Slice exists but without file - that's ok
    }

    res.json({ ...inserted, tags: [] })
  } catch (error) {
    console.error('Error creating slice:', error)
    res.status(500).json({ error: 'Failed to create slice' })
  }
})

// Update slice
router.put('/slices/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, startTime, endTime, sampleType, envelopeType, note } = req.body as {
    name?: string
    startTime?: number
    endTime?: number
    sampleType?: string | null
    envelopeType?: string | null
    note?: string | null
  }

  try {
    const slice = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, id))
      .limit(1)

    if (slice.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    const hasSlicePayload = (
      name !== undefined
      || startTime !== undefined
      || endTime !== undefined
      || sampleType !== undefined
    )
    const hasAudioFeaturePayload = envelopeType !== undefined || note !== undefined

    if (!hasSlicePayload && !hasAudioFeaturePayload) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    const updates: Partial<typeof schema.slices.$inferSelect> = {}
    const audioFeatureUpdates: Partial<typeof schema.audioFeatures.$inferSelect> = {}
    if (name !== undefined) updates.name = name
    if (startTime !== undefined) updates.startTime = startTime
    if (endTime !== undefined) updates.endTime = endTime
    if (sampleType !== undefined) {
      if (sampleType === null || (typeof sampleType === 'string' && sampleType.trim() === '')) {
        updates.sampleType = null
      } else if (typeof sampleType === 'string') {
        const normalizedSampleType = normalizeSampleTypeValue(sampleType)
        if (!normalizedSampleType) {
          return res.status(400).json({ error: 'Invalid sampleType. Expected oneshot or loop.' })
        }
        updates.sampleType = normalizedSampleType
      } else {
        return res.status(400).json({ error: 'Invalid sampleType. Expected oneshot or loop.' })
      }
    }

    if (envelopeType !== undefined) {
      if (envelopeType === null || (typeof envelopeType === 'string' && envelopeType.trim() === '')) {
        audioFeatureUpdates.envelopeType = null
      } else if (typeof envelopeType === 'string') {
        const normalizedEnvelopeType = normalizeEnvelopeTypeValue(envelopeType)
        if (!normalizedEnvelopeType) {
          return res.status(400).json({
            error: `Invalid envelopeType. Expected one of: ${ENVELOPE_TYPE_VALUES.join(', ')}`,
          })
        }
        audioFeatureUpdates.envelopeType = normalizedEnvelopeType
      } else {
        return res.status(400).json({
          error: `Invalid envelopeType. Expected one of: ${ENVELOPE_TYPE_VALUES.join(', ')}`,
        })
      }
    }

    if (note !== undefined) {
      if (note === null || (typeof note === 'string' && note.trim() === '')) {
        audioFeatureUpdates.fundamentalFrequency = null
      } else if (typeof note === 'string') {
        const [existingFeature] = await db
          .select({
            fundamentalFrequency: schema.audioFeatures.fundamentalFrequency,
          })
          .from(schema.audioFeatures)
          .where(eq(schema.audioFeatures.sliceId, id))
          .limit(1)
        const fallbackOctave = getFrequencyOctave(existingFeature?.fundamentalFrequency ?? 0)
        const frequency = noteToFrequency(note, fallbackOctave)
        if (frequency === null) {
          return res.status(400).json({ error: 'Invalid note. Expected note name like C, F#, Bb, or C4.' })
        }
        audioFeatureUpdates.fundamentalFrequency = frequency
      } else {
        return res.status(400).json({ error: 'Invalid note. Expected note name like C, F#, Bb, or C4.' })
      }
    }

    if (hasSlicePayload || hasAudioFeaturePayload) {
      updates.sampleModified = 1
      updates.sampleModifiedAt = new Date().toISOString()
    }

    // If time changed, regenerate slice audio
    if (startTime !== undefined || endTime !== undefined) {
      const track = await db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.id, slice[0].trackId))
        .limit(1)

      if (track[0]?.audioPath) {
        const newStart = startTime ?? slice[0].startTime
        const newEnd = endTime ?? slice[0].endTime

        if (slice[0].filePath) {
          try {
            await extractSlice(track[0].audioPath, slice[0].filePath, newStart, newEnd)

            // Re-run audio analysis since audio changed
            autoTagSlice(slice[0].id, slice[0].filePath).catch(err => {
              console.error('Background auto-tagging failed:', err)
            })
          } catch (err) {
            console.error('Failed to re-extract slice:', err)
          }
        }
      }
    }

    if (Object.keys(audioFeatureUpdates).length > 0) {
      const effectiveStartTime = startTime ?? slice[0].startTime
      const effectiveEndTime = endTime ?? slice[0].endTime
      const duration = Math.max(0, effectiveEndTime - effectiveStartTime)

      await db
        .insert(schema.audioFeatures)
        .values({
          sliceId: id,
          duration,
          ...audioFeatureUpdates,
        })
        .onConflictDoUpdate({
          target: schema.audioFeatures.sliceId,
          set: audioFeatureUpdates,
        })
    }

    const [updated] = await db
      .update(schema.slices)
      .set(updates)
      .where(eq(schema.slices.id, id))
      .returning()

    res.json(updated)
  } catch (error) {
    console.error('Error updating slice:', error)
    res.status(500).json({ error: 'Failed to update slice' })
  }
})

// Delete slice
router.delete('/slices/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const deleteSource = req.query.deleteSource === 'true'

  try {
    const slice = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, id))
      .limit(1)

    if (slice.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    // Delete file if requested and it exists
    if (deleteSource && slice[0].filePath) {
      try {
        await fs.unlink(slice[0].filePath)
      } catch (err: any) {
        // File might not exist or we don't have permission
        console.warn('Could not delete source file:', err.message)
      }
    }

    await db.delete(schema.slices).where(eq(schema.slices.id, id))

    res.json({ success: true, deletedSource: deleteSource && slice[0].filePath ? true : false })
  } catch (error) {
    console.error('Error deleting slice:', error)
    res.status(500).json({ error: 'Failed to delete slice' })
  }
})

// Batch download slices as ZIP
router.post('/slices/batch-download', async (req, res) => {
  const { sliceIds } = req.body as { sliceIds?: number[] }

  if (!Array.isArray(sliceIds) || sliceIds.length === 0) {
    return res.status(400).json({ error: 'sliceIds array required' })
  }

  const uniqueSliceIds = Array.from(
    new Set(
      sliceIds
        .map((id) => Number.parseInt(String(id), 10))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  )

  if (uniqueSliceIds.length === 0) {
    return res.status(400).json({ error: 'sliceIds array required' })
  }

  try {
    const slices = await db
      .select({
        id: schema.slices.id,
        name: schema.slices.name,
        filePath: schema.slices.filePath,
      })
      .from(schema.slices)
      .where(inArray(schema.slices.id, uniqueSliceIds))

    if (slices.length === 0) {
      return res.status(404).json({ error: 'No slices found for download' })
    }

    const orderById = new Map(uniqueSliceIds.map((id, index) => [id, index]))
    const orderedSlices = [...slices].sort(
      (a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0)
    )

    const usedNames = new Map<string, number>()
    const filesToArchive: Array<{ filePath: string; entryName: string }> = []

    for (const slice of orderedSlices) {
      if (!slice.filePath) continue

      const absolutePath = path.resolve(slice.filePath)

      try {
        await fs.access(absolutePath)
      } catch {
        continue
      }

      const extension = path.extname(slice.filePath) || '.mp3'
      const baseName = sanitizeArchiveEntryBaseName(slice.name || `slice-${slice.id}`)
      const entryName = createUniqueArchiveEntryName(baseName, extension, usedNames)
      filesToArchive.push({ filePath: absolutePath, entryName })
    }

    if (filesToArchive.length === 0) {
      return res.status(404).json({ error: 'No downloadable slice files found' })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const archiveFileName = `samples-${timestamp}.zip`

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${archiveFileName}"`)

    const archive = archiver('zip', {
      zlib: { level: 9 },
    })

    archive.on('warning', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        console.warn('Archive warning (missing file):', err.message)
        return
      }

      console.error('Archive warning during batch download:', err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create ZIP archive' })
      } else {
        res.end()
      }
    })

    archive.on('error', (err: Error) => {
      console.error('Archive error during batch download:', err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create ZIP archive' })
      } else {
        res.end()
      }
    })

    archive.pipe(res)

    for (const file of filesToArchive) {
      archive.file(file.filePath, { name: file.entryName })
    }

    await archive.finalize()
  } catch (error) {
    console.error('Error batch downloading slices:', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to batch download slices' })
    } else {
      res.end()
    }
  }
})

// Batch convert slices to a target audio format
router.post('/slices/batch-convert', async (req, res) => {
  const {
    sliceIds,
    targetFormat: rawTargetFormat,
    sampleRate: rawSampleRate,
    bitDepth: rawBitDepth,
  } = req.body as {
    sliceIds?: number[]
    targetFormat?: unknown
    sampleRate?: unknown
    bitDepth?: unknown
  }

  if (!Array.isArray(sliceIds) || sliceIds.length === 0) {
    return res.status(400).json({ error: 'sliceIds array required' })
  }

  const targetFormat = normalizeConversionFormat(rawTargetFormat)
  if (!targetFormat) {
    return res.status(400).json({
      error: `targetFormat must be one of: ${BATCH_CONVERSION_FORMATS.join(', ')}`,
    })
  }

  const sampleRate = normalizeConversionSampleRate(rawSampleRate)
  if (!isEmptyOptionalBatchConversionValue(rawSampleRate) && sampleRate === null) {
    return res.status(400).json({
      error: `sampleRate must be an integer between ${BATCH_CONVERSION_MIN_SAMPLE_RATE} and ${BATCH_CONVERSION_MAX_SAMPLE_RATE}`,
    })
  }

  const bitDepth = normalizeConversionBitDepth(rawBitDepth)
  if (!isEmptyOptionalBatchConversionValue(rawBitDepth) && bitDepth === null) {
    return res.status(400).json({
      error: `bitDepth must be one of: ${BATCH_CONVERSION_BIT_DEPTHS.join(', ')}`,
    })
  }

  if (bitDepth !== null && !BATCH_CONVERSION_BIT_DEPTH_FORMATS.has(targetFormat)) {
    return res.status(400).json({
      error: `bitDepth is only supported for: ${Array.from(BATCH_CONVERSION_BIT_DEPTH_FORMATS).join(', ')}`,
    })
  }

  const uniqueSliceIds = Array.from(
    new Set(
      sliceIds
        .map((id) => Number.parseInt(String(id), 10))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  )

  if (uniqueSliceIds.length === 0) {
    return res.status(400).json({ error: 'sliceIds array required' })
  }

  try {
    await ensureCoreDataDirs()

    const slices = await db
      .select({
        id: schema.slices.id,
        filePath: schema.slices.filePath,
      })
      .from(schema.slices)
      .where(inArray(schema.slices.id, uniqueSliceIds))

    if (slices.length === 0) {
      return res.status(404).json({ error: 'No slices found for conversion' })
    }

    const orderById = new Map(uniqueSliceIds.map((id, index) => [id, index]))
    const orderedSlices = [...slices].sort(
      (a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0)
    )

    const results: Array<{
      sliceId: number
      success: boolean
      skipped: boolean
      outputPath?: string
      format?: string | null
      error?: string
    }> = []

    let converted = 0
    let skipped = 0
    let failed = 0
    const hasRequestedQualityChange = sampleRate !== null || bitDepth !== null

    for (const slice of orderedSlices) {
      const sourcePath = slice.filePath

      if (!sourcePath) {
        failed += 1
        results.push({
          sliceId: slice.id,
          success: false,
          skipped: false,
          error: 'Slice file not found',
        })
        continue
      }

      const absoluteSourcePath = path.resolve(sourcePath)
      try {
        await fs.access(absoluteSourcePath)
      } catch {
        failed += 1
        results.push({
          sliceId: slice.id,
          success: false,
          skipped: false,
          error: 'Slice file is missing on disk',
        })
        continue
      }

      const sourceFormat = inferFormatFromFilePath(sourcePath)
      let shouldSkip = sourceFormat === targetFormat && !hasRequestedQualityChange

      if (sourceFormat === targetFormat && hasRequestedQualityChange) {
        const sourceMetadata = await getAudioFileMetadata(absoluteSourcePath).catch(() => null)
        const sampleRateMatches = sampleRate === null
          ? true
          : sourceMetadata?.sampleRate === sampleRate
        const bitDepthMatches = bitDepth === null
          ? true
          : sourceMetadata?.bitDepth === bitDepth
        shouldSkip = sampleRateMatches && bitDepthMatches
      }

      if (shouldSkip) {
        skipped += 1
        results.push({
          sliceId: slice.id,
          success: true,
          skipped: true,
          format: targetFormat,
        })
        continue
      }

      const outputBase = `${path.parse(absoluteSourcePath).name}-${targetFormat}-${randomUUID().slice(0, 8)}`
      const outputPath = path.join(SLICES_DIR, `${outputBase}.${targetFormat}`)

      try {
        await convertAudioFile(absoluteSourcePath, outputPath, targetFormat, {
          sampleRate: sampleRate ?? undefined,
          bitDepth: bitDepth ?? undefined,
        })

        const fileMetadata = await getAudioFileMetadata(outputPath).catch(() => null)
        const modifiedAt = new Date().toISOString()

        await db
          .update(schema.slices)
          .set({
            filePath: outputPath,
            sampleModified: 1,
            sampleModifiedAt: modifiedAt,
          })
          .where(eq(schema.slices.id, slice.id))

        await db
          .update(schema.audioFeatures)
          .set({
            sampleRate: fileMetadata?.sampleRate ?? undefined,
            channels: fileMetadata?.channels ?? undefined,
            fileFormat: fileMetadata?.format ?? targetFormat,
            sourceMtime: fileMetadata?.modifiedAt ?? undefined,
            sourceCtime: fileMetadata?.createdAt ?? undefined,
          })
          .where(eq(schema.audioFeatures.sliceId, slice.id))

        await unlinkManagedPath(sourcePath)

        converted += 1
        results.push({
          sliceId: slice.id,
          success: true,
          skipped: false,
          outputPath,
          format: fileMetadata?.format ?? targetFormat,
        })
      } catch (error) {
        await unlinkManagedPath(outputPath)
        failed += 1
        results.push({
          sliceId: slice.id,
          success: false,
          skipped: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    res.json({
      targetFormat,
      sampleRate,
      bitDepth,
      total: orderedSlices.length,
      converted,
      skipped,
      failed,
      results,
    })
  } catch (error) {
    console.error('Error batch converting slices:', error)
    res.status(500).json({ error: 'Failed to batch convert slices' })
  }
})

// Stream slice audio (for playback)
router.get('/slices/:id/download', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const slice = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, id))
      .limit(1)

    if (slice.length === 0 || !slice[0].filePath) {
      return res.status(404).json({ error: 'Slice file not found' })
    }

    // Stream audio inline for playback (not as attachment download)
    res.type('audio/mpeg')
    res.sendFile(path.resolve(slice[0].filePath), { acceptRanges: true })
  } catch (error) {
    console.error('Error streaming slice:', error)
    res.status(500).json({ error: 'Failed to stream slice' })
  }
})

// Batch generate AI tags for multiple slices
router.post('/slices/batch-ai-tags', async (req, res) => {
  const { sliceIds } = req.body as { sliceIds: number[] }

  if (!sliceIds || !Array.isArray(sliceIds) || sliceIds.length === 0) {
    return res.status(400).json({ error: 'sliceIds array required' })
  }

  try {
    // Get all slices with file paths
    const slices = await db
      .select()
      .from(schema.slices)
      .where(inArray(schema.slices.id, sliceIds))
    const aiManagedTagIds = await getAiManagedInstrumentTagIds()

    const results: {
      sliceId: number
      success: boolean
      error?: string
      hadPotentialCustomState?: boolean
      warningMessage?: string
      removedTags?: string[]
      addedTags?: string[]
    }[] = []
    const warningMessages: string[] = []
    const warningSliceIds = new Set<number>()

    // Process slices with concurrency limit
    const CONCURRENCY = 3
    for (let i = 0; i < slices.length; i += CONCURRENCY) {
      const batch = slices.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.all(
        batch.map(async (slice) => {
          if (!slice.filePath) {
            return { sliceId: slice.id, success: false, error: 'No audio file' }
          }
          try {
            const beforeTags = await getSliceTagNames(slice.id)
            const beforeAutoTags = await getSliceAiManagedTagNames(slice.id, aiManagedTagIds)

            await autoTagSlice(slice.id, slice.filePath)

            const afterTags = await getSliceTagNames(slice.id)
            const { removedTags, addedTags } = computeTagDiff(beforeTags, afterTags)
            const afterAutoTags = await getSliceAiManagedTagNames(slice.id, aiManagedTagIds)

            const autoTagChanged =
              beforeAutoTags.length > 0 &&
              (
                beforeAutoTags.some((tag) => !afterAutoTags.includes(tag)) ||
                afterAutoTags.some((tag) => !beforeAutoTags.includes(tag))
              )

            let warningMessage: string | null = null
            if (autoTagChanged || slice.sampleModified === 1) {
              warningMessage = autoTagChanged
                ? `Slice ${slice.id} had custom/changed AI tag state before analysis. Changes detected: -${removedTags.length} +${addedTags.length}.`
                : `Slice ${slice.id} was manually modified before analysis.`
            }

            await db.insert(schema.reanalysisLogs).values({
              sliceId: slice.id,
              beforeTags: JSON.stringify(beforeTags),
              afterTags: JSON.stringify(afterTags),
              removedTags: JSON.stringify(removedTags),
              addedTags: JSON.stringify(addedTags),
              hadPotentialCustomState: warningMessage ? 1 : 0,
              warningMessage,
            })

            if (warningMessage) {
              warningMessages.push(warningMessage)
              warningSliceIds.add(slice.id)
            }

            return {
              sliceId: slice.id,
              success: true,
              hadPotentialCustomState: Boolean(warningMessage),
              warningMessage: warningMessage ?? undefined,
              removedTags,
              addedTags,
            }
          } catch (error) {
            return {
              sliceId: slice.id,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          }
        })
      )
      results.push(...batchResults)
    }

    res.json({
      total: sliceIds.length,
      processed: results.length,
      successful: results.filter((r) => r.success).length,
      warnings: {
        totalWithWarnings: warningSliceIds.size,
        sliceIds: Array.from(warningSliceIds),
        messages: warningMessages,
      },
      results,
    })
  } catch (error) {
    console.error('Error batch generating AI tags:', error)
    res.status(500).json({ error: 'Failed to batch generate AI tags' })
  }
})

// Get all slices with audio features for Sample Space visualization
router.get('/slices/features', async (_req, res) => {
  try {
    const results = await db
      .select({
        // Slice info
        id: schema.slices.id,
        name: schema.slices.name,
        trackId: schema.slices.trackId,
        filePath: schema.slices.filePath,
        // Audio features
        duration: schema.audioFeatures.duration,
        bpm: schema.audioFeatures.bpm,
        onsetCount: schema.audioFeatures.onsetCount,
        spectralCentroid: schema.audioFeatures.spectralCentroid,
        spectralRolloff: schema.audioFeatures.spectralRolloff,
        spectralBandwidth: schema.audioFeatures.spectralBandwidth,
        spectralContrast: schema.audioFeatures.spectralContrast,
        zeroCrossingRate: schema.audioFeatures.zeroCrossingRate,
        mfccMean: schema.audioFeatures.mfccMean,
        rmsEnergy: schema.audioFeatures.rmsEnergy,
        loudness: schema.audioFeatures.loudness,
        dynamicRange: schema.audioFeatures.dynamicRange,
        keyEstimate: schema.audioFeatures.keyEstimate,
        keyStrength: schema.audioFeatures.keyStrength,
        attackTime: schema.audioFeatures.attackTime,
        spectralFlux: schema.audioFeatures.spectralFlux,
        spectralFlatness: schema.audioFeatures.spectralFlatness,
        kurtosis: schema.audioFeatures.kurtosis,
        dissonance: schema.audioFeatures.dissonance,
        inharmonicity: schema.audioFeatures.inharmonicity,
        spectralComplexity: schema.audioFeatures.spectralComplexity,
        spectralCrest: schema.audioFeatures.spectralCrest,
        noisiness: schema.audioFeatures.noisiness,
        roughness: schema.audioFeatures.roughness,
        sharpness: schema.audioFeatures.sharpness,
        stereoWidth: schema.audioFeatures.stereoWidth,
        panningCenter: schema.audioFeatures.panningCenter,
        stereoImbalance: schema.audioFeatures.stereoImbalance,
        harmonicPercussiveRatio: schema.audioFeatures.harmonicPercussiveRatio,
        harmonicEnergy: schema.audioFeatures.harmonicEnergy,
        percussiveEnergy: schema.audioFeatures.percussiveEnergy,
        harmonicCentroid: schema.audioFeatures.harmonicCentroid,
        percussiveCentroid: schema.audioFeatures.percussiveCentroid,
        onsetRate: schema.audioFeatures.onsetRate,
        beatStrength: schema.audioFeatures.beatStrength,
        rhythmicRegularity: schema.audioFeatures.rhythmicRegularity,
        danceability: schema.audioFeatures.danceability,
        decayTime: schema.audioFeatures.decayTime,
        sustainLevel: schema.audioFeatures.sustainLevel,
        releaseTime: schema.audioFeatures.releaseTime,
        loudnessIntegrated: schema.audioFeatures.loudnessIntegrated,
        loudnessRange: schema.audioFeatures.loudnessRange,
        loudnessMomentaryMax: schema.audioFeatures.loudnessMomentaryMax,
        truePeak: schema.audioFeatures.truePeak,
        eventCount: schema.audioFeatures.eventCount,
        eventDensity: schema.audioFeatures.eventDensity,
        temporalCentroid: schema.audioFeatures.temporalCentroid,
        crestFactor: schema.audioFeatures.crestFactor,
        transientSpectralCentroid: schema.audioFeatures.transientSpectralCentroid,
        transientSpectralFlatness: schema.audioFeatures.transientSpectralFlatness,
        sampleTypeConfidence: schema.audioFeatures.sampleTypeConfidence,
        polyphony: schema.audioFeatures.polyphony,
        // Fields needed for client-side filtering in the space view
        fundamentalFrequency: schema.audioFeatures.fundamentalFrequency,
        envelopeType: schema.audioFeatures.envelopeType,
        brightness: schema.audioFeatures.brightness,
        warmth: schema.audioFeatures.warmth,
        hardness: schema.audioFeatures.hardness,
        genrePrimary: schema.audioFeatures.genrePrimary,
        instrumentType: schema.audioFeatures.instrumentType,
        sliceCreatedAt: schema.slices.createdAt,
        sourceCtime: schema.audioFeatures.sourceCtime,
        sourceMtime: schema.audioFeatures.sourceMtime,
      })
      .from(schema.slices)
      .innerJoin(schema.audioFeatures, eq(schema.slices.id, schema.audioFeatures.sliceId))

    // Parse mfccMean JSON strings
    const parsed = results.map((r) => ({
      ...r,
      mfccMean: r.mfccMean ? JSON.parse(r.mfccMean) : null,
    }))

    res.json(parsed)
  } catch (error) {
    console.error('Error fetching slice features:', error)
    res.status(500).json({ error: 'Failed to fetch slice features' })
  }
})

// GET /api/slices/:id/features - Get audio features for a specific slice
router.get('/slices/:id/features', async (req, res) => {
  const sliceId = parseInt(req.params.id)

  try {
    // Get the slice info
    const slice = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, sliceId))
      .limit(1)

    if (slice.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    // Get audio features
    const features = await db
      .select()
      .from(schema.audioFeatures)
      .where(eq(schema.audioFeatures.sliceId, sliceId))
      .limit(1)

    if (features.length === 0) {
      return res.status(404).json({ error: 'Audio features not found for this slice' })
    }

    const feature = features[0]

    // Parse JSON fields
    const mfccMean = feature.mfccMean ? JSON.parse(feature.mfccMean) : null
    const tristimulus = feature.tristimulus ? JSON.parse(feature.tristimulus) : null
    const melBandsMean = feature.melBandsMean ? JSON.parse(feature.melBandsMean) : null
    const melBandsStd = feature.melBandsStd ? JSON.parse(feature.melBandsStd) : null
    const yamnetEmbeddings = feature.yamnetEmbeddings ? JSON.parse(feature.yamnetEmbeddings) : null
    const instrumentClasses = feature.instrumentClasses ? JSON.parse(feature.instrumentClasses) : null
    const genreClasses = feature.genreClasses ? JSON.parse(feature.genreClasses) : null
    const moodClasses = feature.moodClasses ? JSON.parse(feature.moodClasses) : null

    // Return all features
    res.json({
      id: slice[0].id,
      name: slice[0].name,
      trackId: slice[0].trackId,
      filePath: slice[0].filePath,
      sampleRate: feature.sampleRate,
      channels: feature.channels,
      format: feature.fileFormat,
      dateModified: feature.sourceMtime,
      dateCreated: feature.sourceCtime,
      dateAdded: slice[0].createdAt,
      isOneShot: feature.isOneShot,
      isLoop: feature.isLoop,
      fundamentalFrequency: feature.fundamentalFrequency,
      polyphony: feature.polyphony,
      duration: feature.duration,
      bpm: feature.bpm,
      onsetCount: feature.onsetCount,
      spectralCentroid: feature.spectralCentroid,
      spectralRolloff: feature.spectralRolloff,
      spectralBandwidth: feature.spectralBandwidth,
      spectralContrast: feature.spectralContrast,
      zeroCrossingRate: feature.zeroCrossingRate,
      mfccMean,
      rmsEnergy: feature.rmsEnergy,
      loudness: feature.loudness,
      dynamicRange: feature.dynamicRange,
      keyEstimate: feature.keyEstimate,
      scale: feature.scale,
      keyStrength: feature.keyStrength,
      attackTime: feature.attackTime,
      spectralFlux: feature.spectralFlux,
      spectralFlatness: feature.spectralFlatness,
      kurtosis: feature.kurtosis,
      dissonance: feature.dissonance,
      inharmonicity: feature.inharmonicity,
      tristimulus,
      spectralComplexity: feature.spectralComplexity,
      spectralCrest: feature.spectralCrest,
      brightness: feature.brightness,
      warmth: feature.warmth,
      hardness: feature.hardness,
      noisiness: feature.noisiness,
      roughness: feature.roughness,
      sharpness: feature.sharpness,
      melBandsMean,
      melBandsStd,
      stereoWidth: feature.stereoWidth,
      panningCenter: feature.panningCenter,
      stereoImbalance: feature.stereoImbalance,
      harmonicPercussiveRatio: feature.harmonicPercussiveRatio,
      harmonicEnergy: feature.harmonicEnergy,
      percussiveEnergy: feature.percussiveEnergy,
      harmonicCentroid: feature.harmonicCentroid,
      percussiveCentroid: feature.percussiveCentroid,
      onsetRate: feature.onsetRate,
      beatStrength: feature.beatStrength,
      rhythmicRegularity: feature.rhythmicRegularity,
      danceability: feature.danceability,
      decayTime: feature.decayTime,
      sustainLevel: feature.sustainLevel,
      releaseTime: feature.releaseTime,
      envelopeType: feature.envelopeType,
      instrumentClasses,
      genreClasses,
      genrePrimary: feature.genrePrimary,
      yamnetEmbeddings,
      moodClasses,
      loudnessIntegrated: feature.loudnessIntegrated,
      loudnessRange: feature.loudnessRange,
      loudnessMomentaryMax: feature.loudnessMomentaryMax,
      truePeak: feature.truePeak,
      eventCount: feature.eventCount,
      eventDensity: feature.eventDensity,
      chromaprintFingerprint: feature.chromaprintFingerprint,
      similarityHash: feature.similarityHash,
      temporalCentroid: feature.temporalCentroid,
      crestFactor: feature.crestFactor,
      transientSpectralCentroid: feature.transientSpectralCentroid,
      transientSpectralFlatness: feature.transientSpectralFlatness,
      sampleTypeConfidence: feature.sampleTypeConfidence,
      analysisLevel: 'advanced',
    })
  } catch (error) {
    console.error('Error fetching audio features for slice:', error)
    res.status(500).json({ error: 'Failed to fetch audio features' })
  }
})

// Toggle favorite status
router.post('/slices/:id/favorite', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const slice = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, id))
      .limit(1)

    if (slice.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    const newFavorite = slice[0].favorite === 1 ? 0 : 1

    await db
      .update(schema.slices)
      .set({ favorite: newFavorite })
      .where(eq(schema.slices.id, id))

    res.json({ favorite: newFavorite === 1 })
  } catch (error) {
    console.error('Error toggling favorite:', error)
    res.status(500).json({ error: 'Failed to toggle favorite' })
  }
})

// Batch delete slices
router.post('/slices/batch-delete', async (req, res) => {
  const { sliceIds } = req.body as { sliceIds: number[] }

  if (!sliceIds || !Array.isArray(sliceIds) || sliceIds.length === 0) {
    return res.status(400).json({ error: 'sliceIds array required' })
  }

  try {
    // Get all slices to delete (to get file paths)
    const slices = await db
      .select()
      .from(schema.slices)
      .where(inArray(schema.slices.id, sliceIds))

    const results: { sliceId: number; success: boolean; error?: string }[] = []

    // Delete each slice and its file
    for (const slice of slices) {
      try {
        // Delete file if it exists
        if (slice.filePath) {
          await unlinkManagedPath(slice.filePath)
        }

        // Delete from database
        await db.delete(schema.slices).where(eq(schema.slices.id, slice.id))
        results.push({ sliceId: slice.id, success: true })
      } catch (error) {
        results.push({
          sliceId: slice.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    res.json({
      total: sliceIds.length,
      deleted: results.filter((r) => r.success).length,
      results,
    })
  } catch (error) {
    console.error('Error batch deleting slices:', error)
    res.status(500).json({ error: 'Failed to batch delete slices' })
  }
})

async function runBatchReanalyze(options: BatchReanalyzeRunOptions): Promise<BatchReanalyzeResponsePayload> {
  const includeFilenameTags = options.includeFilenameTags === true
  if (options.allowAiTagging === false) {
    console.warn('[reanalyze] allowAiTagging=false requested, but AI tagging is forced on.')
  }
  const signal = options.signal
  const concurrency = resolveBatchReanalyzeConcurrency(options.concurrency)
  const results: BatchReanalyzeResultItem[] = []
  const resultBySliceId = new Map<number, BatchReanalyzeResultItem>()
  type PendingReviewSample = {
    sliceId: number
    sampleName: string
    folderPath: string | null
    relativePath: string | null
    pathHint: string | null
    beforeTags: string[]
    beforeAutoTags: string[]
    sampleModified: number
    features: Awaited<ReturnType<typeof analyzeAudioFeatures>>
    modelEvidenceTags: string[]
    filenameEvidenceTags: ParsedFilenameTag[]
  }
  const pendingReviewQueue: PendingReviewSample[] = []
  const auditSamples: BatchAuditSampleContext[] = []
  let aiManagedTagIds: number[] = []
  const warningMessages: string[] = []
  const warningSliceIds = new Set<number>()
  let stage: BatchReanalyzeStage = 'analysis'
  let analyzed = 0
  let failed = 0

  const ensureNotCanceled = () => {
    if (signal?.aborted) {
      throw new Error(BATCH_REANALYZE_CANCELLED_ERROR)
    }
  }

  const emitProgress = (total: number) => {
    options.onProgress?.({
      total,
      analyzed,
      failed,
      processed: analyzed + failed,
      stage,
      warningSliceIds: Array.from(warningSliceIds),
      warningMessages: [...warningMessages],
    })
  }

  const recordFailure = (sliceId: number, error: string, total: number) => {
    failed += 1
    const failureResult: BatchReanalyzeResultItem = {
      sliceId,
      success: false,
      error,
    }
    results.push(failureResult)
    resultBySliceId.set(sliceId, failureResult)
    emitProgress(total)
  }

  const applyReviewedTagsForSample = async (
    sample: PendingReviewSample,
    reviewedTags: ReviewedTagResult[]
  ) => {
    const sanitizedReviewedTags = normalizeReviewedTagsForWrite(reviewedTags, {
      maxTags: 10,
      isOneShot: sample.features.isOneShot,
      isLoop: sample.features.isLoop,
    })
    const suggestedAutoTags = sanitizedReviewedTags.map((tag) => tag.name)
    await replaceAutoReanalysisTagsForSlice(sample.sliceId, sanitizedReviewedTags, aiManagedTagIds)

    const afterTags = await getSliceTagNames(sample.sliceId)
    const { removedTags, addedTags } = computeTagDiff(sample.beforeTags, afterTags)

    const beforeAutoSet = new Set(sample.beforeAutoTags)
    const suggestedAutoSet = new Set(suggestedAutoTags)
    const autoTagStateChanged =
      sample.beforeAutoTags.some((tag) => !suggestedAutoSet.has(tag)) ||
      suggestedAutoTags.some((tag) => !beforeAutoSet.has(tag))

    let warningMessage: string | null = null
    if (autoTagStateChanged || sample.sampleModified === 1) {
      warningMessage = autoTagStateChanged
        ? `Slice ${sample.sliceId} had custom/changed AI tag state before re-analysis. Changes detected: -${removedTags.length} +${addedTags.length}.`
        : `Slice ${sample.sliceId} was manually modified before re-analysis.`
    }

    await db.insert(schema.reanalysisLogs).values({
      sliceId: sample.sliceId,
      beforeTags: JSON.stringify(sample.beforeTags),
      afterTags: JSON.stringify(afterTags),
      removedTags: JSON.stringify(removedTags),
      addedTags: JSON.stringify(addedTags),
      hadPotentialCustomState: warningMessage ? 1 : 0,
      warningMessage,
    })

    if (warningMessage) {
      warningMessages.push(warningMessage)
      warningSliceIds.add(sample.sliceId)
    }

    await db
      .update(schema.slices)
      .set({
        sampleModified: 0,
        sampleModifiedAt: null,
      })
      .where(eq(schema.slices.id, sample.sliceId))

    auditSamples.push({
      sliceId: sample.sliceId,
      sampleName: sample.sampleName,
      folderPath: sample.pathHint ?? sample.folderPath,
      currentTags: sanitizedReviewedTags.map((tag) => ({
        tag: tag.name,
        category: tag.category,
        confidence: 0.9,
      })),
      modelTags: sample.modelEvidenceTags,
      isOneShot: sample.features.isOneShot,
      isLoop: sample.features.isLoop,
      instrumentHint: deriveInstrumentHintForAudit(sample.features.instrumentPredictions),
      genrePrimary: sample.features.genrePrimary ?? null,
      previousAutoTags: sample.beforeAutoTags,
      filenameTags: sample.filenameEvidenceTags.map((entry) => ({
        tag: entry.tag,
        category: entry.category,
        confidence: entry.confidence,
      })),
      instrumentType: deriveInstrumentType(sample.features.instrumentClasses, sample.sampleName, {
        pathHint: sample.pathHint,
        preferPathHint: true,
      }),
    })

    analyzed += 1
    const successResult: BatchReanalyzeResultItem = {
      sliceId: sample.sliceId,
      success: true,
      hadPotentialCustomState: Boolean(warningMessage),
      warningMessage: warningMessage ?? undefined,
      removedTags,
      addedTags,
    }
    results.push(successResult)
    resultBySliceId.set(sample.sliceId, successResult)
    emitProgress(total)
  }

  const processQueuedReviewBatch = async (maxBatchSize: number) => {
    const batchSize = Math.max(1, maxBatchSize)
    const reviewBatch = pendingReviewQueue.splice(0, batchSize)
    if (reviewBatch.length === 0) return

    const reviewedBySliceId = new Map<number, ReviewedTagResult[]>()
    const unresolvedForAi: typeof reviewBatch = []

    for (const sample of reviewBatch) {
      const deterministicTags = buildFallbackReviewedTags({
        sampleName: sample.sampleName,
        folderPath: sample.pathHint ?? sample.folderPath,
        modelTags: sample.modelEvidenceTags,
        modelConfidence: (sample.features.instrumentPredictions || [])
          .reduce((best, pred) => {
            if (!pred || typeof pred.confidence !== 'number' || !Number.isFinite(pred.confidence)) return best
            return pred.confidence > best ? pred.confidence : best
          }, 0),
        filenameTags: sample.filenameEvidenceTags,
        previousAutoTags: sample.beforeAutoTags,
        isOneShot: sample.features.isOneShot,
        isLoop: sample.features.isLoop,
        maxTags: 10,
      })

      if (deterministicTags.length > 0) {
        reviewedBySliceId.set(sample.sliceId, deterministicTags)
        continue
      }

      unresolvedForAi.push(sample)
    }

    if (unresolvedForAi.length > 0) {
      try {
        const reviewedBatch = await reviewSampleTagBatchWithOllama({
          samples: unresolvedForAi.map((sample) => ({
            sliceId: sample.sliceId,
            sampleName: sample.sampleName,
            folderPath: sample.pathHint ?? sample.folderPath,
            modelTags: sample.modelEvidenceTags,
            previousAutoTags: sample.beforeAutoTags,
            filenameTags: sample.filenameEvidenceTags.map((entry) => ({
              tag: entry.tag,
              category: entry.category,
              confidence: entry.confidence,
            })),
            instrumentType: deriveInstrumentType(sample.features.instrumentClasses, sample.sampleName, {
              pathHint: sample.pathHint,
              preferPathHint: true,
            }),
            genrePrimary: sample.features.genrePrimary ?? null,
            maxTags: 10,
          })),
          maxTags: 10,
        })

        for (const entry of reviewedBatch) {
          const normalizedTags = normalizeReviewedTagsForWrite(
            entry.tags.map((tag) => ({ name: tag.tag, category: tag.category })),
            { maxTags: 10 }
          )
          if (normalizedTags.length > 0) {
            reviewedBySliceId.set(entry.sliceId, normalizedTags)
          }
        }
      } catch (error) {
        console.error('[reanalyze] AI fallback batch review failed:', error)
      }
    }

    for (const sample of reviewBatch) {
      ensureNotCanceled()
      let reviewedTags = reviewedBySliceId.get(sample.sliceId) ?? []

      await applyReviewedTagsForSample(sample, reviewedTags)
    }
  }

  const slicesToAnalyze = options.sliceIds && options.sliceIds.length > 0
    ? await db
        .select({
          id: schema.slices.id,
          name: schema.slices.name,
          filePath: schema.slices.filePath,
          trackId: schema.slices.trackId,
          sampleModified: schema.slices.sampleModified,
          folderPath: schema.tracks.folderPath,
          relativePath: schema.tracks.relativePath,
        })
        .from(schema.slices)
        .leftJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
        .where(inArray(schema.slices.id, options.sliceIds))
    : await db
        .select({
          id: schema.slices.id,
          name: schema.slices.name,
          filePath: schema.slices.filePath,
          trackId: schema.slices.trackId,
          sampleModified: schema.slices.sampleModified,
          folderPath: schema.tracks.folderPath,
          relativePath: schema.tracks.relativePath,
        })
        .from(schema.slices)
        .leftJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))

  ensureNotCanceled()

  if (slicesToAnalyze.length === 0) {
    emitProgress(0)
    return {
      total: 0,
      analyzed: 0,
      failed: 0,
      warnings: createEmptyBatchReanalyzeWarnings(),
      audit: createEmptyBatchReanalyzeAuditSummary(BATCH_REANALYZE_AUDIT_ENABLED),
      results: [],
    }
  }

  // Clean up bad tags (AudioSet ontology labels that leaked through)
  const badTags = await db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(like(schema.tags.name, '%/m/%'))
  if (badTags.length > 0) {
    const badTagIds = badTags.map((tag) => tag.id)
    await db.delete(schema.sliceTags).where(inArray(schema.sliceTags.tagId, badTagIds))
    await db.delete(schema.tags).where(inArray(schema.tags.id, badTagIds))
    console.log(`Cleaned up ${badTags.length} bad AudioSet ontology tags`)
  }

  const total = slicesToAnalyze.length
  aiManagedTagIds = await getAiManagedInstrumentTagIds()
  emitProgress(total)
  console.log(`[reanalyze] Processing ${total} slices with concurrency ${concurrency}.`)

  for (let i = 0; i < total; i += concurrency) {
    ensureNotCanceled()
    const chunk = slicesToAnalyze.slice(i, i + concurrency)

    const analyzedChunk = await Promise.all(
      chunk.map(async (slice): Promise<{ kind: 'ready'; sample: PendingReviewSample } | { kind: 'failed'; sliceId: number; error: string }> => {
        try {
          ensureNotCanceled()
          if (!slice.filePath) {
            return { kind: 'failed', sliceId: slice.id, error: 'No file path' }
          }

          let filePath = slice.filePath
          if (!path.isAbsolute(filePath)) {
            if (filePath.startsWith('data/')) {
              filePath = filePath.substring(5)
            }
            filePath = path.join(DATA_DIR, filePath)
          }

          try {
            await fs.access(filePath)
          } catch {
            return { kind: 'failed', sliceId: slice.id, error: 'File not found' }
          }

          const beforeTags = await getSliceTagNames(slice.id)
          const beforeAutoTags = await getSliceAiManagedTagNames(slice.id, aiManagedTagIds)
          const pathHint = buildSamplePathHint({
            folderPath: slice.folderPath ?? null,
            relativePath: slice.relativePath ?? null,
            filename: slice.name ?? null,
          })

          const features = await analyzeAudioFeatures(filePath, 'advanced', {
            signal,
            filename: slice.name ?? undefined,
          })
          const modelEvidenceTags = featuresToTags(features)
          ensureNotCanceled()

          const fileMetadata = await getAudioFileMetadata(filePath).catch(() => null)
          const enrichedFeatures = {
            ...features,
            sampleRate: fileMetadata?.sampleRate ?? features.sampleRate,
            channels: fileMetadata?.channels ?? undefined,
            fileFormat: fileMetadata?.format ?? undefined,
            sourceMtime: fileMetadata?.modifiedAt ?? undefined,
            sourceCtime: fileMetadata?.createdAt ?? undefined,
          }

          await storeAudioFeatures(slice.id, enrichedFeatures, {
            sampleName: slice.name ?? null,
            pathHint,
            preferPathHint: true,
          })
          ensureNotCanceled()

          const filenameEvidenceTags =
            includeFilenameTags && slice.name
              ? parseFilenameTags(slice.name, pathHint)
              : []

          return {
            kind: 'ready',
            sample: {
              sliceId: slice.id,
              sampleName: slice.name,
              folderPath: slice.folderPath ?? null,
              relativePath: slice.relativePath ?? null,
              pathHint,
              beforeTags,
              beforeAutoTags,
              sampleModified: slice.sampleModified,
              features,
              modelEvidenceTags,
              filenameEvidenceTags,
            },
          }
        } catch (error) {
          if (isBatchReanalyzeCancellationError(error)) {
            throw error
          }
          return {
            kind: 'failed',
            sliceId: slice.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      })
    )

    for (const chunkResult of analyzedChunk) {
      if (chunkResult.kind === 'failed') {
        recordFailure(chunkResult.sliceId, chunkResult.error, total)
        continue
      }

      pendingReviewQueue.push(chunkResult.sample)
      while (pendingReviewQueue.length >= BATCH_REANALYZE_REVIEW_BATCH_SIZE) {
        ensureNotCanceled()
        await processQueuedReviewBatch(BATCH_REANALYZE_REVIEW_BATCH_SIZE)
      }
    }

    ensureNotCanceled()
    if (i + concurrency < total) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  while (pendingReviewQueue.length > 0) {
    ensureNotCanceled()
    await processQueuedReviewBatch(pendingReviewQueue.length)
  }

  stage = 'audit'
  emitProgress(total)
  const audit = await runBatchReanalyzeAudit({
    samples: auditSamples,
    resultBySliceId,
    ensureNotCanceled,
  })

  const warnings: BatchReanalyzeWarningSummary = {
    totalWithWarnings: warningSliceIds.size,
    sliceIds: Array.from(warningSliceIds),
    messages: [...warningMessages],
  }

  return {
    total,
    analyzed,
    failed,
    warnings,
    audit,
    results,
  }
}

router.get('/slices/batch-reanalyze/status', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(getBatchReanalyzeStatusResponse())
})

router.post('/slices/batch-reanalyze/start', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  if (batchReanalyzeJobState.status === 'running' || batchReanalyzeJobState.status === 'cancelling') {
    return res.status(409).json({
      error: 'Batch re-analysis already running',
      status: getBatchReanalyzeStatusResponse(),
    })
  }

  const { sliceIds, concurrency, includeFilenameTags, allowAiTagging } = req.body as BatchReanalyzeRequestBody
  const resolvedConcurrency = resolveBatchReanalyzeConcurrency(concurrency)
  const normalizedIncludeFilenameTags = includeFilenameTags === true
  const normalizedAllowAiTagging = true
  if (allowAiTagging === false) {
    console.warn('[reanalyze] allowAiTagging=false requested at job start, but AI tagging is forced on.')
  }
  const startedAt = new Date().toISOString()
  const jobId = randomUUID()
  const abortController = new AbortController()
  batchReanalyzeAbortController = abortController

  batchReanalyzeJobState = {
    jobId,
    status: 'running',
    stage: 'analysis',
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
    total: 0,
    analyzed: 0,
    failed: 0,
    processed: 0,
    concurrency: resolvedConcurrency,
    includeFilenameTags: normalizedIncludeFilenameTags,
    allowAiTagging: normalizedAllowAiTagging,
    error: null,
    warnings: createEmptyBatchReanalyzeWarnings(),
    audit: createEmptyBatchReanalyzeAuditSummary(BATCH_REANALYZE_AUDIT_ENABLED),
    resultSummary: null,
  }

  void (async () => {
    try {
      const result = await runBatchReanalyze({
        sliceIds,
        concurrency: resolvedConcurrency,
        includeFilenameTags: normalizedIncludeFilenameTags,
        allowAiTagging: normalizedAllowAiTagging,
        signal: abortController.signal,
        onProgress: (progress) => {
          batchReanalyzeJobState = {
            ...batchReanalyzeJobState,
            total: progress.total,
            analyzed: progress.analyzed,
            failed: progress.failed,
            processed: progress.processed,
            stage: progress.stage,
            warnings: {
              totalWithWarnings: progress.warningSliceIds.length,
              sliceIds: [...progress.warningSliceIds],
              messages: [...progress.warningMessages],
            },
            updatedAt: new Date().toISOString(),
          }
        },
      })
      const finishedAt = new Date().toISOString()
      batchReanalyzeJobState = {
        ...batchReanalyzeJobState,
        status: 'completed',
        finishedAt,
        updatedAt: finishedAt,
        total: result.total,
        analyzed: result.analyzed,
        failed: result.failed,
        processed: result.analyzed + result.failed,
        stage: 'analysis',
        error: null,
        warnings: {
          totalWithWarnings: result.warnings.totalWithWarnings,
          sliceIds: [...result.warnings.sliceIds],
          messages: [...result.warnings.messages],
        },
        audit: result.audit,
        resultSummary: {
          total: result.total,
          analyzed: result.analyzed,
          failed: result.failed,
          warnings: {
            totalWithWarnings: result.warnings.totalWithWarnings,
            sliceIds: [...result.warnings.sliceIds],
            messages: [...result.warnings.messages],
          },
          audit: result.audit,
        },
      }
    } catch (error) {
      const finishedAt = new Date().toISOString()
      if (isBatchReanalyzeCancellationError(error)) {
        batchReanalyzeJobState = {
          ...batchReanalyzeJobState,
          status: 'canceled',
          stage: 'analysis',
          finishedAt,
          updatedAt: finishedAt,
          error: null,
          resultSummary: {
            total: batchReanalyzeJobState.total,
            analyzed: batchReanalyzeJobState.analyzed,
            failed: batchReanalyzeJobState.failed,
            warnings: {
              totalWithWarnings: batchReanalyzeJobState.warnings.totalWithWarnings,
              sliceIds: [...batchReanalyzeJobState.warnings.sliceIds],
              messages: [...batchReanalyzeJobState.warnings.messages],
            },
            audit: batchReanalyzeJobState.audit,
          },
        }
        return
      }

      console.error('Error batch re-analyzing slices:', error)
      const message = error instanceof Error ? error.message : 'Failed to batch re-analyze slices'
      batchReanalyzeJobState = {
        ...batchReanalyzeJobState,
        status: 'failed',
        stage: 'analysis',
        finishedAt,
        updatedAt: finishedAt,
        error: message,
      }
    } finally {
      batchReanalyzeAbortController = null
    }
  })()

  res.status(202).json({
    started: true,
    status: getBatchReanalyzeStatusResponse(),
  })
})

router.post('/slices/batch-reanalyze/cancel', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  if (
    !batchReanalyzeAbortController ||
    (batchReanalyzeJobState.status !== 'running' && batchReanalyzeJobState.status !== 'cancelling')
  ) {
    return res.json({
      canceled: false,
      status: getBatchReanalyzeStatusResponse(),
    })
  }

  batchReanalyzeJobState = {
    ...batchReanalyzeJobState,
    status: 'cancelling',
    updatedAt: new Date().toISOString(),
  }

  batchReanalyzeAbortController.abort()
  console.log('[reanalyze] Cancellation requested by client')

  res.json({
    canceled: true,
    status: getBatchReanalyzeStatusResponse(),
  })
})

// POST /api/slices/batch-reanalyze - Re-analyze all or selected slices
router.post('/slices/batch-reanalyze', async (req, res) => {
  const abortController = new AbortController()
  let cancellationRequested = false

  const requestCancellation = () => {
    if (cancellationRequested) return
    cancellationRequested = true
    abortController.abort()
    console.log('[reanalyze] Cancellation requested by client')
  }

  const handleRequestClose = () => {
    if (!res.writableEnded) {
      requestCancellation()
    }
  }

  req.on('aborted', requestCancellation)
  req.on('close', handleRequestClose)

  try {
    const { sliceIds, concurrency, includeFilenameTags, allowAiTagging } = req.body as BatchReanalyzeRequestBody
    if (allowAiTagging === false) {
      console.warn('[reanalyze] allowAiTagging=false requested, but AI tagging is forced on.')
    }

    const result = await runBatchReanalyze({
      sliceIds,
      concurrency,
      includeFilenameTags,
      allowAiTagging: true,
      signal: abortController.signal,
    })

    if (cancellationRequested || res.writableEnded) {
      return
    }

    res.json(result)
  } catch (error) {
    if (cancellationRequested || res.writableEnded) {
      return
    }

    if (isBatchReanalyzeCancellationError(error)) {
      return res.status(499).json({ error: 'Batch re-analysis canceled' })
    }

    console.error('Error batch re-analyzing slices:', error)
    res.status(500).json({ error: 'Failed to batch re-analyze slices' })
  } finally {
    req.off('aborted', requestCancellation)
    req.off('close', handleRequestClose)
  }
})

// Phase 6: Similarity Detection Endpoints

// Helper function to calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0)
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))

  if (magA === 0 || magB === 0) return 0
  return dotProduct / (magA * magB)
}

// Build a normalized feature vector from scalar audio features.
// Used as fallback when YAMNet embeddings are unavailable.
function buildScalarFeatureVector(f: Record<string, any>): number[] | null {
  const vec: number[] = []
  let populated = 0

  const push = (val: any, scale: number, weight = 1) => {
    const n = typeof val === 'number' && Number.isFinite(val) ? val : null
    vec.push(n !== null ? Math.min(Math.max(n / scale, -2), 2) * weight : 0)
    if (n !== null) populated++
  }

  // Core spectral features – present at every analysis level
  push(f.spectralCentroid, 8000, 2)
  push(f.spectralRolloff, 12000, 1.5)
  push(f.spectralBandwidth, 4000, 1)
  push(f.spectralFlux, 1, 1)
  push(f.spectralFlatness, 1, 1)
  push(f.zeroCrossingRate, 1, 1.5)
  push(f.rmsEnergy, 1, 1.5)
  push(f.attackTime, 1, 1)
  push(f.kurtosis, 50, 0.5)

  // Perceptual / Phase-1 features (0-1 normalised, present after advanced analysis)
  push(f.brightness, 1, 2)
  push(f.warmth, 1, 2)
  push(f.hardness, 1, 1.5)
  push(f.sharpness, 1, 1)

  // Rhythmic / pitch
  push(f.bpm, 200, 1.5)
  push(f.fundamentalFrequency, 2000, 1)

  // MFCC coefficients 1-12 (skip 0 – encodes loudness, already covered)
  if (f.mfccMean) {
    try {
      const mfcc = JSON.parse(f.mfccMean) as number[]
      for (let i = 1; i <= 12; i++) {
        const v = mfcc[i]
        vec.push(typeof v === 'number' && Number.isFinite(v) ? v / 30 : 0)
        if (typeof v === 'number' && Number.isFinite(v)) populated++
      }
    } catch {
      for (let k = 0; k < 12; k++) vec.push(0)
    }
  } else {
    for (let k = 0; k < 12; k++) vec.push(0)
  }

  return populated >= 3 ? vec : null
}

// GET /api/slices/:id/similar - Find similar samples based on ML embeddings (PANNs preferred, YAMNet fallback)
router.get('/slices/:id/similar', async (req, res) => {
  const sliceId = Number.parseInt(req.params.id, 10)
  const limit = parseInt(req.query.limit as string) || 20

  if (Number.isNaN(sliceId)) {
    return res.status(400).json({ error: 'Invalid slice id' })
  }

  try {
    // Get target slice's audio features with embeddings
    const targetFeatures = await db
      .select()
      .from(schema.audioFeatures)
      .where(eq(schema.audioFeatures.sliceId, sliceId))
      .limit(1)


    if (targetFeatures.length === 0) {
      return res.json([])
    }

    const target = targetFeatures[0]
    let similarities: { sliceId: number; similarity: number }[] = []

    // Prefer PANNs mlEmbeddings, then YAMNet, then scalar fallback
    const targetMlModel = target.mlEmbeddingModel
    const targetMlEmbeddings = target.mlEmbeddings
    const targetYamnetEmbeddings = target.yamnetEmbeddings

    if (targetMlEmbeddings && targetMlModel) {
      // Best quality: use PANNs 2048-dim embeddings (only compare same model)
      const targetEmbeddings = JSON.parse(targetMlEmbeddings) as number[]
      const allFeatures = await db
        .select({
          sliceId: schema.audioFeatures.sliceId,
          mlEmbeddings: schema.audioFeatures.mlEmbeddings,
          mlEmbeddingModel: schema.audioFeatures.mlEmbeddingModel,
        })
        .from(schema.audioFeatures)
        .where(sql`${schema.audioFeatures.sliceId} != ${sliceId} AND ${schema.audioFeatures.mlEmbeddings} IS NOT NULL AND ${schema.audioFeatures.mlEmbeddingModel} = ${targetMlModel}`)

      similarities = allFeatures
        .map(f => {
          const candidateSliceId = Number(f.sliceId)
          if (Number.isNaN(candidateSliceId)) return null
          const embeddings = JSON.parse(f.mlEmbeddings!) as number[]
          return { sliceId: candidateSliceId, similarity: cosineSimilarity(targetEmbeddings, embeddings) }
        })
        .filter((s): s is { sliceId: number; similarity: number } => Boolean(s))
        .filter(s => s.sliceId !== sliceId && s.similarity > 0.5)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
    } else if (targetYamnetEmbeddings) {
      // Fallback: use 1024-dim YAMNet embeddings
      const targetEmbeddings = JSON.parse(targetYamnetEmbeddings) as number[]
      const allFeatures = await db
        .select({
          sliceId: schema.audioFeatures.sliceId,
          yamnetEmbeddings: schema.audioFeatures.yamnetEmbeddings,
        })
        .from(schema.audioFeatures)
        .where(sql`${schema.audioFeatures.sliceId} != ${sliceId} AND ${schema.audioFeatures.yamnetEmbeddings} IS NOT NULL`)

      similarities = allFeatures
        .map(f => {
          const candidateSliceId = Number(f.sliceId)
          if (Number.isNaN(candidateSliceId)) return null
          const embeddings = JSON.parse(f.yamnetEmbeddings!) as number[]
          return { sliceId: candidateSliceId, similarity: cosineSimilarity(targetEmbeddings, embeddings) }
        })
        .filter((s): s is { sliceId: number; similarity: number } => Boolean(s))
        .filter(s => s.sliceId !== sliceId && s.similarity > 0.5)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
    } else {
      // Last fallback: cosine similarity over normalised scalar audio features
      const targetVec = buildScalarFeatureVector(target)
      if (targetVec) {
        const allFeatures = await db
          .select()
          .from(schema.audioFeatures)
          .where(sql`${schema.audioFeatures.sliceId} != ${sliceId}`)

        similarities = allFeatures
          .map(f => {
            const candidateSliceId = Number(f.sliceId)
            if (Number.isNaN(candidateSliceId)) return null
            const candidateVec = buildScalarFeatureVector(f)
            if (!candidateVec) return null
            return { sliceId: candidateSliceId, similarity: cosineSimilarity(targetVec, candidateVec) }
          })
          .filter((s): s is { sliceId: number; similarity: number } => Boolean(s))
          .filter(s => s.sliceId !== sliceId && s.similarity > 0.5)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit)
      }
    }

    // Get slice details for similar samples
    const similarSliceIds = Array.from(new Set(similarities.map(s => s.sliceId)))
      .filter(id => id !== sliceId)

    if (similarSliceIds.length === 0) {
      return res.json([])
    }

    const slices = await db
      .select({
        id: schema.slices.id,
        trackId: schema.slices.trackId,
        name: schema.slices.name,
        filePath: schema.slices.filePath,
        trackTitle: schema.tracks.title,
        trackYoutubeId: schema.tracks.youtubeId,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .where(inArray(schema.slices.id, similarSliceIds))

    // Map similarity scores to slices
    const results = slices
      .filter(slice => Number(slice.id) !== sliceId) // Final safeguard against self-inclusion
      .map(slice => {
      const sim = similarities.find(s => Number(s.sliceId) === Number(slice.id))
      return {
        ...slice,
        similarity: sim?.similarity || 0,
        track: {
          title: slice.trackTitle,
          youtubeId: slice.trackYoutubeId,
        },
      }
    }).sort((a, b) => b.similarity - a.similarity)

    res.json(results)
  } catch (error) {
    console.error('Error finding similar slices:', error)
    res.status(500).json({ error: 'Failed to find similar slices' })
  }
})

/**
 * Compute fingerprint similarity between two chromaprint fingerprints using Hamming distance.
 * Decodes base64 chromaprint strings to int32 arrays, XORs them, and counts differing bits.
 * Returns a similarity score between 0.0 (completely different) and 1.0 (identical).
 */
function fingerprintSimilarity(fpA: string, fpB: string): number {
  let bufA: Buffer
  let bufB: Buffer
  try {
    bufA = Buffer.from(fpA, 'base64')
    bufB = Buffer.from(fpB, 'base64')
  } catch {
    return 0
  }

  // Ensure both are multiple of 4 bytes (int32 arrays)
  const lenA = Math.floor(bufA.length / 4)
  const lenB = Math.floor(bufB.length / 4)
  if (lenA === 0 || lenB === 0) return 0

  // Compare overlapping portion
  const compareLen = Math.min(lenA, lenB)
  const maxLen = Math.max(lenA, lenB)

  let totalBits = 0
  let matchingBits = 0

  for (let i = 0; i < compareLen; i++) {
    const a = bufA.readInt32LE(i * 4)
    const b = bufB.readInt32LE(i * 4)
    const xor = a ^ b
    // Count set bits (Hamming distance) using bit manipulation
    let bits = xor
    let setBits = 0
    while (bits) {
      setBits += 1
      bits &= bits - 1 // Clear lowest set bit
    }
    totalBits += 32
    matchingBits += 32 - setBits
  }

  // Penalize length difference: non-overlapping int32 blocks count as all-different
  totalBits += (maxLen - compareLen) * 32

  if (totalBits === 0) return 0
  return matchingBits / totalBits
}

// GET /api/slices/duplicates - Find potential duplicate samples based on chromaprint fingerprint
router.get('/slices/duplicates', async (_req: any, res) => {
  const enableNearDuplicates = _req.query.nearDuplicates === 'true'
  const NEAR_DUPLICATE_THRESHOLD = 0.85
  const NEAR_DUPLICATE_DURATION_TOLERANCE = 0.20 // 20%
  try {
    // Collect fingerprint + path identity data so we can catch both true audio dupes
    // and obvious duplicated imports when fingerprint is missing.
    const allRows = await db
      .select({
        sliceId: schema.slices.id,
        chromaprintFingerprint: schema.audioFeatures.chromaprintFingerprint,
        similarityHash: schema.audioFeatures.similarityHash,
        duration: schema.audioFeatures.duration,
        filePath: schema.slices.filePath,
        startTime: schema.slices.startTime,
        endTime: schema.slices.endTime,
        trackOriginalPath: schema.tracks.originalPath,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .leftJoin(schema.audioFeatures, eq(schema.slices.id, schema.audioFeatures.sliceId))

    if (allRows.length === 0) {
      return res.json({ groups: [], total: 0 })
    }

    // Degenerate chromaprint fingerprint returned for audio too short for meaningful analysis.
    // Treat it as missing so we fall through to content hashing.
    const DEGENERATE_FINGERPRINT = 'AQAAAA'

    const exactGroups = new Map<string, Set<number>>()
    const fileIdentityGroups = new Map<string, Set<number>>()
    const contentHashGroups = new Map<string, Set<number>>()

    // Collect slices that need content hashing (missing persisted hash)
    const needsHash: Array<{ sliceId: number; filePath: string }> = []
    const hashBackfills: Array<{ sliceId: number; hash: string }> = []

    for (const row of allRows) {
      const fp = row.chromaprintFingerprint
      if (fp && fp !== DEGENERATE_FINGERPRINT) {
        if (!exactGroups.has(fp)) {
          exactGroups.set(fp, new Set<number>())
        }
        exactGroups.get(fp)!.add(row.sliceId)
      }

      const storedHash = row.similarityHash?.trim()
      if (storedHash) {
        if (!contentHashGroups.has(storedHash)) {
          contentHashGroups.set(storedHash, new Set<number>())
        }
        contentHashGroups.get(storedHash)!.add(row.sliceId)
      }

      const identityPath = row.trackOriginalPath || row.filePath
      if (identityPath) {
        const identityKey = [
          normalizeIdentityPathValue(identityPath),
          Math.round(row.startTime * 1000),
          Math.round(row.endTime * 1000),
        ].join('|')

        if (!fileIdentityGroups.has(identityKey)) {
          fileIdentityGroups.set(identityKey, new Set<number>())
        }
        fileIdentityGroups.get(identityKey)!.add(row.sliceId)
      }

      // Queue for content hashing if we don't already have a persisted hash.
      if (!storedHash && row.filePath) {
        needsHash.push({ sliceId: row.sliceId, filePath: row.filePath })
      }
    }

    // Compute SHA256 of slice file contents for exact byte-level duplicate detection.
    // This catches re-imports of the same file regardless of path or name.
    await Promise.all(needsHash.map(async ({ sliceId, filePath }) => {
      try {
        const buf = await fs.readFile(filePath)
        const hash = createHash('sha256').update(buf).digest('hex')
        if (!contentHashGroups.has(hash)) {
          contentHashGroups.set(hash, new Set<number>())
        }
        contentHashGroups.get(hash)!.add(sliceId)
        hashBackfills.push({ sliceId, hash })
      } catch {
        // File missing or unreadable — skip
      }
    }))

    // Persist computed hashes so subsequent scans are fast and don't depend on file reads.
    await Promise.all(hashBackfills.map(({ sliceId, hash }) =>
      db
        .update(schema.audioFeatures)
        .set({ similarityHash: hash })
        .where(eq(schema.audioFeatures.sliceId, sliceId))
    ))

    // Near-duplicate detection via chromaprint Hamming distance (opt-in)
    const nearDuplicateGroups = new Map<string, { sliceIds: Set<number>; similarity: number }>()

    if (enableNearDuplicates) {
      // Collect rows that have valid fingerprints for near-duplicate comparison
      const fpRows: Array<{ sliceId: number; fp: string; duration: number }> = []
      for (const row of allRows) {
        const fp = row.chromaprintFingerprint
        if (fp && fp !== DEGENERATE_FINGERPRINT && typeof row.duration === 'number' && row.duration > 0) {
          fpRows.push({ sliceId: row.sliceId, fp, duration: row.duration })
        }
      }

      // Pairwise comparison (only between similar-duration samples)
      for (let i = 0; i < fpRows.length; i++) {
        for (let j = i + 1; j < fpRows.length; j++) {
          const a = fpRows[i]
          const b = fpRows[j]

          // Duration pre-filter: skip if durations differ by more than tolerance
          const durationRatio = Math.min(a.duration, b.duration) / Math.max(a.duration, b.duration)
          if (durationRatio < 1 - NEAR_DUPLICATE_DURATION_TOLERANCE) continue

          // Skip if fingerprints are identical (already caught by exactGroups)
          if (a.fp === b.fp) continue

          const sim = fingerprintSimilarity(a.fp, b.fp)
          if (sim >= NEAR_DUPLICATE_THRESHOLD) {
            const key = [Math.min(a.sliceId, b.sliceId), Math.max(a.sliceId, b.sliceId)].join(',')
            const existing = nearDuplicateGroups.get(key)
            if (!existing || sim > existing.similarity) {
              nearDuplicateGroups.set(key, {
                sliceIds: new Set([a.sliceId, b.sliceId]),
                similarity: sim,
              })
            }
          }
        }
      }
    }

    const dedupedGroups = new Map<string, {
      sliceIds: number[]
      matchType: 'exact' | 'file' | 'content' | 'near-duplicate'
      hashSimilarity: number
    }>()

    const addGroup = (sliceIdSet: Set<number>, matchType: 'exact' | 'file' | 'content' | 'near-duplicate', similarity = 1.0) => {
      const sliceIds = Array.from(sliceIdSet).sort((a, b) => a - b)
      if (sliceIds.length <= 1) return

      const signature = sliceIds.join(',')
      const existing = dedupedGroups.get(signature)

      // Priority: exact fingerprint > content hash > file path identity > near-duplicate
      const priority: Record<string, number> = { exact: 3, content: 2, file: 1, 'near-duplicate': 0 }
      if (!existing || (priority[matchType] ?? -1) > (priority[existing.matchType] ?? -1)) {
        dedupedGroups.set(signature, {
          sliceIds,
          matchType,
          hashSimilarity: similarity,
        })
      }
    }

    for (const set of exactGroups.values()) addGroup(set, 'exact')
    for (const set of contentHashGroups.values()) addGroup(set, 'content')
    for (const set of fileIdentityGroups.values()) addGroup(set, 'file')
    for (const { sliceIds, similarity } of nearDuplicateGroups.values()) addGroup(sliceIds, 'near-duplicate', similarity)

    const duplicateGroups = Array.from(dedupedGroups.values())

    // Get slice details for all duplicates
    const allDuplicateIds = new Set<number>()
    duplicateGroups.forEach(g => g.sliceIds.forEach(id => allDuplicateIds.add(id)))

    if (allDuplicateIds.size === 0) {
      return res.json({ groups: [], total: 0 })
    }

    const slices = await db
      .select({
        id: schema.slices.id,
        name: schema.slices.name,
        filePath: schema.slices.filePath,
        favorite: schema.slices.favorite,
        createdAt: schema.slices.createdAt,
        trackTitle: schema.tracks.title,
        sampleRate: schema.audioFeatures.sampleRate,
        channels: schema.audioFeatures.channels,
        format: schema.audioFeatures.fileFormat,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .leftJoin(schema.audioFeatures, eq(schema.slices.id, schema.audioFeatures.sliceId))
      .where(inArray(schema.slices.id, Array.from(allDuplicateIds)))

    const duplicateIdList = Array.from(allDuplicateIds)
    const tagCountsResult = duplicateIdList.length > 0
      ? await db
          .select({
            sliceId: schema.sliceTags.sliceId,
            count: sql<number>`cast(count(*) as integer)`,
          })
          .from(schema.sliceTags)
          .where(inArray(schema.sliceTags.sliceId, duplicateIdList))
          .groupBy(schema.sliceTags.sliceId)
      : []

    const folderCountsResult = duplicateIdList.length > 0
      ? await db
          .select({
            sliceId: schema.folderSlices.sliceId,
            count: sql<number>`cast(count(*) as integer)`,
          })
          .from(schema.folderSlices)
          .where(inArray(schema.folderSlices.sliceId, duplicateIdList))
          .groupBy(schema.folderSlices.sliceId)
      : []

    const tagCountBySliceId = new Map(tagCountsResult.map((row) => [row.sliceId, Number(row.count) || 0]))
    const folderCountBySliceId = new Map(folderCountsResult.map((row) => [row.sliceId, Number(row.count) || 0]))

    const sliceMap = new Map(slices.map((s) => [
      s.id,
      {
        ...s,
        favorite: s.favorite === 1,
        tagsCount: tagCountBySliceId.get(s.id) ?? 0,
        folderCount: folderCountBySliceId.get(s.id) ?? 0,
      },
    ]))

    const groups = duplicateGroups
      .map(g => ({
        matchType: g.matchType,
        hashSimilarity: g.hashSimilarity,
        samples: g.sliceIds.map(id => sliceMap.get(id)!).filter(Boolean),
      }))
      .sort((a, b) => b.samples.length - a.samples.length)

    res.json({
      groups,
      total: groups.length,
    })
  } catch (error) {
    console.error('Error finding duplicate slices:', error)
    res.status(500).json({ error: 'Failed to find duplicate slices' })
  }
})

// GET /api/slices/hierarchy - Build similarity-based hierarchy using clustering
router.get('/slices/hierarchy', async (_req, res) => {
  try {
    // Get all slices with YAMNet embeddings
    const allFeatures = await db
      .select({
        sliceId: schema.audioFeatures.sliceId,
        yamnetEmbeddings: schema.audioFeatures.yamnetEmbeddings,
      })
      .from(schema.audioFeatures)
      .where(sql`${schema.audioFeatures.yamnetEmbeddings} IS NOT NULL`)

    if (allFeatures.length === 0) {
      return res.json({ hierarchy: null, message: 'No embeddings available for clustering' })
    }

    // Parse embeddings
    const samples = allFeatures.map(f => ({
      sliceId: f.sliceId,
      embeddings: JSON.parse(f.yamnetEmbeddings!) as number[],
    }))

    // Simple agglomerative clustering
    // Start with each sample as its own cluster
    interface Cluster {
      id: string
      sliceIds: number[]
      centroid: number[]
      children?: Cluster[]
    }

    let clusters: Cluster[] = samples.map((s, i) => ({
      id: `sample_${s.sliceId}`,
      sliceIds: [s.sliceId],
      centroid: s.embeddings,
    }))

    // Merge clusters until we have a reasonable number of top-level groups (e.g., 5-10)
    const TARGET_CLUSTERS = Math.min(10, Math.max(5, Math.floor(samples.length / 20)))

    while (clusters.length > TARGET_CLUSTERS) {
      // Find two closest clusters
      let minDist = Infinity
      let mergeI = 0
      let mergeJ = 1

      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const dist = 1 - cosineSimilarity(clusters[i].centroid, clusters[j].centroid)
          if (dist < minDist) {
            minDist = dist
            mergeI = i
            mergeJ = j
          }
        }
      }

      // Merge clusters
      const merged: Cluster = {
        id: `cluster_${clusters[mergeI].id}_${clusters[mergeJ].id}`,
        sliceIds: [...clusters[mergeI].sliceIds, ...clusters[mergeJ].sliceIds],
        centroid: clusters[mergeI].centroid.map((v, i) =>
          (v + clusters[mergeJ].centroid[i]) / 2
        ),
        children: [clusters[mergeI], clusters[mergeJ]],
      }

      // Replace with merged cluster
      clusters = [
        ...clusters.slice(0, mergeI),
        ...clusters.slice(mergeI + 1, mergeJ),
        ...clusters.slice(mergeJ + 1),
        merged,
      ]
    }

    // Get slice details
    const allSliceIds = samples.map(s => s.sliceId)
    const slices = await db
      .select({
        id: schema.slices.id,
        name: schema.slices.name,
        filePath: schema.slices.filePath,
        trackTitle: schema.tracks.title,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .where(inArray(schema.slices.id, allSliceIds))

    const sliceMap = new Map(slices.map(s => [s.id, s]))

    // Build hierarchy response
    const buildNode = (cluster: Cluster): any => {
      if (cluster.children) {
        return {
          type: 'cluster',
          id: cluster.id,
          size: cluster.sliceIds.length,
          children: cluster.children.map(buildNode),
        }
      } else {
        const slice = sliceMap.get(cluster.sliceIds[0])
        return {
          type: 'sample',
          id: cluster.id,
          sliceId: cluster.sliceIds[0],
          name: slice?.name,
          trackTitle: slice?.trackTitle,
        }
      }
    }

    const hierarchy = clusters.map(buildNode)

    res.json({
      hierarchy,
      totalClusters: TARGET_CLUSTERS,
      totalSamples: samples.length,
    })
  } catch (error) {
    console.error('Error building hierarchy:', error)
    res.status(500).json({ error: 'Failed to build hierarchy' })
  }
})

// Phase 5: LMNN Weight Learning Endpoints

// POST /api/weights/learn - Learn optimal feature weights from labeled samples
router.post('/weights/learn', async (_req, res) => {
  try {
    const { spawn } = await import('child_process')
    const pathMod = await import('path')
    const fsMod = await import('fs/promises')
    const { fileURLToPath } = await import('url')

    const __fn = fileURLToPath(import.meta.url)
    const __dn = pathMod.dirname(__fn)

    // Get all samples with filename-derived tags
    const samplesWithTags = await db
      .select({
        sliceId: schema.audioFeatures.sliceId,
        spectralCentroid: schema.audioFeatures.spectralCentroid,
        spectralRolloff: schema.audioFeatures.spectralRolloff,
        spectralBandwidth: schema.audioFeatures.spectralBandwidth,
        spectralContrast: schema.audioFeatures.spectralContrast,
        spectralFlux: schema.audioFeatures.spectralFlux,
        spectralFlatness: schema.audioFeatures.spectralFlatness,
        rmsEnergy: schema.audioFeatures.rmsEnergy,
        loudness: schema.audioFeatures.loudness,
        dynamicRange: schema.audioFeatures.dynamicRange,
        attackTime: schema.audioFeatures.attackTime,
        brightness: schema.audioFeatures.brightness,
        warmth: schema.audioFeatures.warmth,
        hardness: schema.audioFeatures.hardness,
        roughness: schema.audioFeatures.roughness,
        sharpness: schema.audioFeatures.sharpness,
        harmonicPercussiveRatio: schema.audioFeatures.harmonicPercussiveRatio,
        temporalCentroid: schema.audioFeatures.temporalCentroid,
        crestFactor: schema.audioFeatures.crestFactor,
        transientSpectralCentroid: schema.audioFeatures.transientSpectralCentroid,
        transientSpectralFlatness: schema.audioFeatures.transientSpectralFlatness,
        stereoWidth: schema.audioFeatures.stereoWidth,
        zeroCrossingRate: schema.audioFeatures.zeroCrossingRate,
        bpm: schema.audioFeatures.bpm,
        tagName: schema.tags.name,
      })
      .from(schema.audioFeatures)
      .innerJoin(schema.sliceTags, eq(schema.audioFeatures.sliceId, schema.sliceTags.sliceId))
      .innerJoin(schema.tags, and(eq(schema.sliceTags.tagId, schema.tags.id), eq(schema.tags.category, 'filename')))

    if (samplesWithTags.length < 20) {
      return res.status(400).json({
        error: 'Need at least 20 labeled samples for weight learning',
        current: samplesWithTags.length
      })
    }

    // Group by sliceId, pick primary tag
    const sampleMap = new Map<number, { features: number[], label: string }>()
    const featureNames = [
      'spectralCentroid', 'spectralRolloff', 'spectralBandwidth', 'spectralContrast',
      'spectralFlux', 'spectralFlatness', 'rmsEnergy', 'loudness', 'dynamicRange',
      'attackTime', 'brightness', 'warmth', 'hardness', 'roughness', 'sharpness',
      'harmonicPercussiveRatio', 'temporalCentroid', 'crestFactor',
      'transientSpectralCentroid', 'transientSpectralFlatness', 'stereoWidth',
      'zeroCrossingRate', 'bpm',
    ]

    for (const row of samplesWithTags) {
      if (sampleMap.has(row.sliceId)) continue
      const featureValues = featureNames.map(f => (row as any)[f] ?? 0)
      sampleMap.set(row.sliceId, { features: featureValues, label: row.tagName })
    }

    const samples = Array.from(sampleMap.values())
    const inputData = {
      features: samples.map(s => s.features),
      labels: samples.map(s => s.label),
      feature_names: featureNames,
    }

    const PYTHON_SCRIPT = pathMod.join(__dn, '../python/learn_weights.py')
    const VENV_PYTHON = pathMod.join(__dn, '../../venv/bin/python')
    const PYTHON_EXECUTABLE = process.env.PYTHON_PATH || VENV_PYTHON

    const proc = spawn(PYTHON_EXECUTABLE, [PYTHON_SCRIPT], {
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.stdin.write(JSON.stringify(inputData))
    proc.stdin.end()

    proc.on('close', async (code: number | null) => {
      if (code !== 0) {
        console.error('Weight learning failed:', stderr)
        return res.status(500).json({ error: 'Weight learning failed', details: stderr.substring(0, 500) })
      }

      try {
        const result = JSON.parse(stdout)
        const DATA_DIR = process.env.DATA_DIR || './data'
        const weightsPath = pathMod.join(DATA_DIR, 'learned_weights.json')
        await fsMod.mkdir(DATA_DIR, { recursive: true })
        await fsMod.writeFile(weightsPath, JSON.stringify(result, null, 2))
        res.json(result)
      } catch {
        res.status(500).json({ error: 'Failed to parse weight learning results' })
      }
    })

    proc.on('error', (err: Error) => {
      res.status(500).json({ error: `Failed to spawn Python process: ${err.message}` })
    })
  } catch (error) {
    console.error('Error in weight learning:', error)
    res.status(500).json({ error: 'Failed to run weight learning' })
  }
})

// GET /api/weights/learned - Get stored learned weights
router.get('/weights/learned', async (_req, res) => {
  try {
    const pathMod = await import('path')
    const fsMod = await import('fs/promises')

    const DATA_DIR = process.env.DATA_DIR || './data'
    const weightsPath = pathMod.join(DATA_DIR, 'learned_weights.json')

    try {
      const data = await fsMod.readFile(weightsPath, 'utf-8')
      res.json(JSON.parse(data))
    } catch {
      res.status(404).json({ error: 'No learned weights found. Import labeled samples and run weight learning first.' })
    }
  } catch (error) {
    console.error('Error fetching learned weights:', error)
    res.status(500).json({ error: 'Failed to fetch learned weights' })
  }
})

export default router
