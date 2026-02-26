/**
 * Deterministic Tag Review Service
 *
 * Handles alias normalization, deduplication, single-instrument enforcement,
 * and unknown tag rejection. Only instrument tags pass through.
 */

import { findCongruentTagsInText, resolveTag } from '../constants/tagRegistry.js'
import type { TagCategory } from '../constants/tagRegistry.js'

export interface ReviewedTagResult {
  name: string
  category: 'instrument'
}

export interface LocalTagReviewInput {
  /** Source sample name for congruence fallback */
  sampleName?: string | null
  /** Source folder path for congruence fallback */
  folderPath?: string | null
  /** Raw candidate tags from model / analysis */
  modelTags: string[]
  /** Best model confidence from analysis output (0..1) */
  modelConfidence?: number | null
  /** Tags previously assigned by AI (for carry-over) */
  previousAutoTags?: string[]
  /** Filename-derived tag entries */
  filenameTags?: Array<{
    tag: string
    confidence: number
    category?: TagCategory | string
  }>
  /** Features-derived info */
  isOneShot?: boolean
  isLoop?: boolean
  instrumentType?: string | null
  genrePrimary?: string | null
  maxTags?: number
}

// Junk tag patterns — reject these outright
const JUNK_PATTERNS: RegExp[] = [
  /^[0-9]+$/,              // pure numbers
  /^[a-f0-9]{8,}$/,        // hex strings (opaque IDs)
  /\/m\//,                  // YAMNet ontology IDs
  /^perc[-_][a-z0-9]+$/,   // compound filename chunks
  /^vinyl[-_][a-z0-9]+$/,  // compound filename chunks
]

const INVALID_TAGS = new Set(['tron'])

// Instrument priority order (first match wins when enforcing single instrument)
const INSTRUMENT_PRIORITY = [
  'kick', 'snare', 'hihat', 'clap', 'rimshot', 'tom', 'cymbal', 'shaker',
  'percussion', 'bass', 'vocal', 'keys', 'guitar', 'strings', 'synth',
  'pad', 'lead', 'pluck', 'fx', 'foley', 'ambience', 'chord', 'arp', 'bell', 'brass', 'flute',
  'cowbell', 'conga', 'woodblock', 'marimba',
]
const LOW_CONFIDENCE_FILENAME_TAG_THRESHOLD = 0.72
const LOW_CONFIDENCE_MODEL_TAG_THRESHOLD = 0.6
const GENERIC_SLICE_NAME_PATTERN = /^slice\s*\d+$/i
const GENERIC_SLICE_AMBIENCE_FALLBACK_CONFIDENCE = 0.65

function isJunkTag(tag: string): boolean {
  if (INVALID_TAGS.has(tag)) return true
  if (tag.length < 2 || tag.length >= 30) return true
  return JUNK_PATTERNS.some((pattern) => pattern.test(tag))
}

function normalizeAndResolve(raw: string): { canonical: string; category: 'instrument' } | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^\w\s\-\/]/g, '')
    .replace(/\s+/g, ' ')

  if (!cleaned) return null

  // Strip trailing numeric variants (e.g. "vinyl02" → "vinyl") but keep drum machine names
  let normalized = cleaned
  const suffixMatch = normalized.match(/^([a-z][a-z-]{2,})\d{1,3}$/)
  if (suffixMatch && !['808', '909'].includes(normalized)) {
    normalized = suffixMatch[1]
  }

  const resolved = resolveTag(normalized)

  // Only allow known instrument tags
  if (!resolved.isKnown) return null
  if (isJunkTag(resolved.canonical)) return null

  return { canonical: resolved.canonical, category: 'instrument' }
}

/**
 * Deterministic tag review — only allows known instrument tags.
 */
export function reviewTagsLocally(input: LocalTagReviewInput): ReviewedTagResult[] {
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
  const hasFilenameEvidence = (input.filenameTags || [])
    .some((entry) => Boolean(normalizeAndResolve(entry.tag)))
  const modelConfidence =
    typeof input.modelConfidence === 'number' && Number.isFinite(input.modelConfidence)
      ? input.modelConfidence
      : null

  // Generic names like "Slice 1" provide no semantic cues. For low-confidence models,
  // force a conservative ambience tag instead of unstable instrument guesses.
  if (
    isGenericSliceName &&
    !hasInformativePath &&
    !hasFilenameEvidence &&
    !input.instrumentType &&
    (modelConfidence === null || modelConfidence <= GENERIC_SLICE_AMBIENCE_FALLBACK_CONFIDENCE)
  ) {
    return [{ name: 'ambience', category: 'instrument' }]
  }

  // ── Step 1: Collect all candidates with normalization ──
  const candidateMap = new Map<string, { priority: number }>()
  let priorityCounter = 0

  function addResolvedCandidate(canonical: string) {
    if (!candidateMap.has(canonical)) {
      candidateMap.set(canonical, { priority: priorityCounter++ })
    }
  }

  function addCandidate(raw: string) {
    const result = normalizeAndResolve(raw)
    if (!result) return

    addResolvedCandidate(result.canonical)
  }

  function addModelCandidates() {
    for (const tag of input.modelTags || []) {
      for (const segment of tag.split(/[|,\/]+/)) {
        addCandidate(segment.trim())
      }
    }
  }

  function addFilenameCandidates() {
    for (const entry of input.filenameTags || []) {
      const resolved = normalizeAndResolve(entry.tag)
      if (!resolved) continue
      const isLowConfidence = typeof entry.confidence === 'number'
        && entry.confidence < LOW_CONFIDENCE_FILENAME_TAG_THRESHOLD
      if (isLowConfidence && !congruentNameTags.has(resolved.canonical)) {
        continue
      }
      addResolvedCandidate(resolved.canonical)
    }
  }

  // Path-derived instrument hints are treated as highest-confidence evidence.
  if (input.instrumentType) {
    addCandidate(input.instrumentType)
  }

  const preferFilenameEvidence =
    typeof input.modelConfidence === 'number' &&
    Number.isFinite(input.modelConfidence) &&
    input.modelConfidence < LOW_CONFIDENCE_MODEL_TAG_THRESHOLD

  if (preferFilenameEvidence) {
    addFilenameCandidates()
    addModelCandidates()
  } else {
    addModelCandidates()
    addFilenameCandidates()
  }

  // Previous auto tags for carry-over
  for (const tag of input.previousAutoTags || []) {
    for (const segment of tag.split(/[|,\/]+/)) {
      addCandidate(segment.trim())
    }
  }

  // No usable tags survived: rescue from name/path congruence.
  if (candidateMap.size === 0 && congruentNameTags.size > 0) {
    for (const tag of congruentNameTags) {
      addResolvedCandidate(tag)
    }
  }

  // ── Step 2: Convert to array sorted by priority ──
  let tags = Array.from(candidateMap.entries())
    .sort((a, b) => a[1].priority - b[1].priority)
    .map(([name]) => ({ name, category: 'instrument' as const }))

  // ── Step 3: Single-instrument enforcement ──
  if (tags.length > 1) {
    // Keep the highest-priority instrument tag
    let bestInstrument = tags[0]
    for (const inst of tags) {
      const idx = INSTRUMENT_PRIORITY.indexOf(inst.name)
      const bestIdx = INSTRUMENT_PRIORITY.indexOf(bestInstrument.name)
      // Prefer known instruments; among known, prefer the one that appeared first in candidate order
      if (idx >= 0 && (bestIdx < 0 || tags.indexOf(inst) < tags.indexOf(bestInstrument))) {
        bestInstrument = inst
      }
    }
    tags = [bestInstrument]
  }

  // ── Step 4: Final deduplication and truncation ──
  const seen = new Set<string>()
  const result: ReviewedTagResult[] = []
  for (const tag of tags) {
    if (seen.has(tag.name)) continue
    seen.add(tag.name)
    result.push(tag)
    if (result.length >= maxTags) break
  }

  return result
}
