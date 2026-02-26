import axios from 'axios'
import { TAG_REGISTRY, resolveTag } from '../constants/tagRegistry.js'

const OLLAMA_PRIMARY_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434'
const OLLAMA_PRIMARY_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b'
const OLLAMA_ANALYZER_HOST = process.env.OLLAMA_ANALYZER_HOST || OLLAMA_PRIMARY_HOST
const OLLAMA_ANALYZER_MODEL = process.env.OLLAMA_ANALYZER_MODEL || OLLAMA_PRIMARY_MODEL
const OLLAMA_CPU_HOST = process.env.OLLAMA_CPU_HOST || OLLAMA_PRIMARY_HOST
const OLLAMA_CPU_MODEL = process.env.OLLAMA_CPU_MODEL || OLLAMA_PRIMARY_MODEL
const OLLAMA_FILENAME_TAGGING_ENABLED = process.env.OLLAMA_FILENAME_TAGGING !== '0'
const OLLAMA_TAG_REVIEW_ENABLED = process.env.OLLAMA_TAG_REVIEW !== '0'

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

const OLLAMA_FILENAME_TIMEOUT_MS = parsePositiveInteger(
  process.env.OLLAMA_FILENAME_TIMEOUT_MS,
  30000
)
const OLLAMA_TAG_REVIEW_TIMEOUT_MS = parsePositiveInteger(
  process.env.OLLAMA_TAG_REVIEW_TIMEOUT_MS,
  45000
)
const OLLAMA_TAG_REVIEW_BATCH_TIMEOUT_MS = parsePositiveInteger(
  process.env.OLLAMA_TAG_REVIEW_BATCH_TIMEOUT_MS,
  90000
)
const OLLAMA_TAG_AUDIT_TIMEOUT_MS = parsePositiveInteger(
  process.env.OLLAMA_TAG_AUDIT_TIMEOUT_MS,
  90000
)
const OLLAMA_HEALTH_CACHE_MS = parsePositiveInteger(
  process.env.OLLAMA_HEALTH_CACHE_MS,
  60000
)
const OLLAMA_HEALTH_FAILURE_CACHE_MS = parsePositiveInteger(
  process.env.OLLAMA_HEALTH_FAILURE_CACHE_MS,
  5000
)
const OLLAMA_MAX_CONCURRENT_GENERATE = parsePositiveInteger(
  process.env.OLLAMA_MAX_CONCURRENT_GENERATE,
  1
)
const OLLAMA_ANALYZER_MAX_CONCURRENT_GENERATE = parsePositiveInteger(
  process.env.OLLAMA_ANALYZER_MAX_CONCURRENT_GENERATE,
  OLLAMA_MAX_CONCURRENT_GENERATE
)
const OLLAMA_CPU_MAX_CONCURRENT_GENERATE = parsePositiveInteger(
  process.env.OLLAMA_CPU_MAX_CONCURRENT_GENERATE,
  OLLAMA_MAX_CONCURRENT_GENERATE
)
const OLLAMA_GENERATE_FAILURE_THRESHOLD = parsePositiveInteger(
  process.env.OLLAMA_GENERATE_FAILURE_THRESHOLD,
  2
)
const OLLAMA_ANALYZER_GENERATE_FAILURE_THRESHOLD = parsePositiveInteger(
  process.env.OLLAMA_ANALYZER_GENERATE_FAILURE_THRESHOLD,
  OLLAMA_GENERATE_FAILURE_THRESHOLD
)
const OLLAMA_CPU_GENERATE_FAILURE_THRESHOLD = parsePositiveInteger(
  process.env.OLLAMA_CPU_GENERATE_FAILURE_THRESHOLD,
  OLLAMA_GENERATE_FAILURE_THRESHOLD
)
const OLLAMA_GENERATE_FAILURE_COOLDOWN_MS = parsePositiveInteger(
  process.env.OLLAMA_GENERATE_FAILURE_COOLDOWN_MS,
  30000
)
const OLLAMA_ANALYZER_GENERATE_FAILURE_COOLDOWN_MS = parsePositiveInteger(
  process.env.OLLAMA_ANALYZER_GENERATE_FAILURE_COOLDOWN_MS,
  OLLAMA_GENERATE_FAILURE_COOLDOWN_MS
)
const OLLAMA_CPU_GENERATE_FAILURE_COOLDOWN_MS = parsePositiveInteger(
  process.env.OLLAMA_CPU_GENERATE_FAILURE_COOLDOWN_MS,
  OLLAMA_GENERATE_FAILURE_COOLDOWN_MS
)
const OLLAMA_TAG_REVIEW_RETRIES_PER_TARGET = parseNonNegativeInteger(
  process.env.OLLAMA_TAG_REVIEW_RETRIES_PER_TARGET,
  1
)
const OLLAMA_TAG_AUDIT_RETRIES_PER_TARGET = parseNonNegativeInteger(
  process.env.OLLAMA_TAG_AUDIT_RETRIES_PER_TARGET,
  OLLAMA_TAG_REVIEW_RETRIES_PER_TARGET
)
const OLLAMA_TAG_REVIEW_RETRY_DELAY_MS = parseNonNegativeInteger(
  process.env.OLLAMA_TAG_REVIEW_RETRY_DELAY_MS,
  200
)
const OLLAMA_TAG_AUDIT_RETRY_DELAY_MS = parseNonNegativeInteger(
  process.env.OLLAMA_TAG_AUDIT_RETRY_DELAY_MS,
  OLLAMA_TAG_REVIEW_RETRY_DELAY_MS
)
const OLLAMA_TAG_REVIEW_HEALTH_TIMEOUT_MS = parsePositiveInteger(
  process.env.OLLAMA_TAG_REVIEW_HEALTH_TIMEOUT_MS,
  800
)
const OLLAMA_TAG_AUDIT_HEALTH_TIMEOUT_MS = parsePositiveInteger(
  process.env.OLLAMA_TAG_AUDIT_HEALTH_TIMEOUT_MS,
  OLLAMA_TAG_REVIEW_HEALTH_TIMEOUT_MS
)
const OLLAMA_DEBUG_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  (process.env.OLLAMA_DEBUG || '').trim().toLowerCase()
)
const OLLAMA_DEBUG_MAX_CHARS = parsePositiveInteger(
  process.env.OLLAMA_DEBUG_MAX_CHARS,
  500
)

interface OllamaGenerateResponse {
  response: string
  done: boolean
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>
}

type OllamaTarget = 'primary' | 'analyzer' | 'cpu'

type OllamaTargetConfig = {
  label: string
  host: string
  model: string
  forceCpu: boolean
  maxConcurrentGenerate: number
  generateFailureThreshold: number
  generateFailureCooldownMs: number
}

type HealthCache = {
  value: boolean
  expiresAt: number
}

type OllamaTargetState = {
  healthCache: HealthCache | null
  activeGenerateRequests: number
  generateQueue: Array<() => void>
  generateFailureCount: number
  generateCooldownUntil: number
}

const OLLAMA_TARGETS: Record<OllamaTarget, OllamaTargetConfig> = {
  primary: {
    label: 'primary',
    host: OLLAMA_PRIMARY_HOST,
    model: OLLAMA_PRIMARY_MODEL,
    forceCpu: false,
    maxConcurrentGenerate: OLLAMA_MAX_CONCURRENT_GENERATE,
    generateFailureThreshold: OLLAMA_GENERATE_FAILURE_THRESHOLD,
    generateFailureCooldownMs: OLLAMA_GENERATE_FAILURE_COOLDOWN_MS,
  },
  analyzer: {
    label: 'analyzer',
    host: OLLAMA_ANALYZER_HOST,
    model: OLLAMA_ANALYZER_MODEL,
    forceCpu: false,
    maxConcurrentGenerate: OLLAMA_ANALYZER_MAX_CONCURRENT_GENERATE,
    generateFailureThreshold: OLLAMA_ANALYZER_GENERATE_FAILURE_THRESHOLD,
    generateFailureCooldownMs: OLLAMA_ANALYZER_GENERATE_FAILURE_COOLDOWN_MS,
  },
  cpu: {
    label: 'cpu',
    host: OLLAMA_CPU_HOST,
    model: OLLAMA_CPU_MODEL,
    forceCpu: true,
    maxConcurrentGenerate: OLLAMA_CPU_MAX_CONCURRENT_GENERATE,
    generateFailureThreshold: OLLAMA_CPU_GENERATE_FAILURE_THRESHOLD,
    generateFailureCooldownMs: OLLAMA_CPU_GENERATE_FAILURE_COOLDOWN_MS,
  },
}

const ollamaTargetState: Record<OllamaTarget, OllamaTargetState> = {
  primary: {
    healthCache: null,
    activeGenerateRequests: 0,
    generateQueue: [],
    generateFailureCount: 0,
    generateCooldownUntil: 0,
  },
  analyzer: {
    healthCache: null,
    activeGenerateRequests: 0,
    generateQueue: [],
    generateFailureCount: 0,
    generateCooldownUntil: 0,
  },
  cpu: {
    healthCache: null,
    activeGenerateRequests: 0,
    generateQueue: [],
    generateFailureCount: 0,
    generateCooldownUntil: 0,
  },
}

const DEFAULT_TAG_REVIEW_TARGET_CHAIN: OllamaTarget[] = ['analyzer', 'primary', 'cpu']
const DEFAULT_TAG_AUDIT_TARGET_CHAIN: OllamaTarget[] = ['primary', 'analyzer', 'cpu']

function parseTagReviewTargetChain(value: string | undefined, fallback: OllamaTarget[]): OllamaTarget[] {
  if (!value || value.trim() === '') {
    return [...fallback]
  }

  const parsed: OllamaTarget[] = []
  const seen = new Set<OllamaTarget>()
  for (const token of value.split(',')) {
    const normalized = token.trim().toLowerCase()
    if (normalized !== 'primary' && normalized !== 'analyzer' && normalized !== 'cpu') continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    parsed.push(normalized)
  }

  if (parsed.length === 0) {
    return [...fallback]
  }
  return parsed
}

const OLLAMA_TAG_REVIEW_TARGET_CHAIN = parseTagReviewTargetChain(
  process.env.OLLAMA_TAG_REVIEW_TARGET_CHAIN,
  DEFAULT_TAG_REVIEW_TARGET_CHAIN
)
const OLLAMA_TAG_AUDIT_TARGET_CHAIN = parseTagReviewTargetChain(
  process.env.OLLAMA_TAG_AUDIT_TARGET_CHAIN,
  DEFAULT_TAG_AUDIT_TARGET_CHAIN
)
const ALLOWED_INSTRUMENT_TAGS = Object.keys(TAG_REGISTRY).sort()
const ALLOWED_INSTRUMENT_TAGS_PROMPT = ALLOWED_INSTRUMENT_TAGS.join(', ')

export type SemanticTagCategory = 'general' | 'type' | 'character' | 'instrument'

export interface CategorizedTag {
  tag: string
  category: SemanticTagCategory
  confidence: number
}

function clipDebugValue(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= OLLAMA_DEBUG_MAX_CHARS) return singleLine
  return `${singleLine.slice(0, OLLAMA_DEBUG_MAX_CHARS)}...`
}

function toDebugString(value: unknown): string {
  if (typeof value === 'string') return clipDebugValue(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return String(value)
  }
  try {
    return clipDebugValue(JSON.stringify(value))
  } catch {
    return '[unserializable]'
  }
}

function logOllamaDebug(event: string, fields?: Record<string, unknown>): void {
  if (!OLLAMA_DEBUG_ENABLED) return
  if (!fields || Object.keys(fields).length === 0) {
    console.log(`[ollama debug] ${event}`)
    return
  }

  const details = Object.entries(fields)
    .map(([key, value]) => `${key}=${toDebugString(value)}`)
    .join(' ')
  console.log(`[ollama debug] ${event} ${details}`)
}

function clampConfidence(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.65
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
}

function tryParseJsonArray(text: string): unknown[] | null {
  const trimmed = text.trim()

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      return Array.isArray(parsed) ? parsed : null
    } catch {
      // continue to relaxed extraction
    }
  }

  const jsonMatch = trimmed.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return null

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function normalizeSimpleTagList(raw: unknown[] | null, maxTags: number): string[] {
  if (!raw) return []

  return raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => normalizeTag(value))
    .filter((value) => value.length > 0 && value.length < 30)
    .slice(0, maxTags)
}

function mapCategory(rawCategory: string | undefined): SemanticTagCategory {
  const normalized = rawCategory?.toLowerCase().trim()
  if (!normalized) return 'general'

  if (['instrument', 'instruments', 'drum', 'drums', 'percussion', 'vocal', 'fx'].includes(normalized)) {
    return 'instrument'
  }
  if (['type', 'sample_type', 'sample type'].includes(normalized)) {
    return 'type'
  }
  if (['energy', 'character'].includes(normalized)) {
    return 'character'
  }
  if (
    [
      'mood',
      'genre',
      'style',
      'processing',
      'texture',
      'era',
      'descriptor',
      'general',
    ].includes(normalized)
  ) {
    return 'general'
  }

  return 'general'
}

function inferCategoryFromTag(tag: string): SemanticTagCategory {
  const lower = tag.toLowerCase()
  const resolved = resolveTag(lower)
  if (resolved.isKnown) return 'instrument'

  const typeHints = [
    'one-shot',
    'oneshot',
    'one_shot',
    'loop',
    'beat',
    'groove',
    'pattern',
    'break',
    'fill',
    'top',
  ]
  if (typeHints.some((hint) => lower.includes(hint))) {
    return 'type'
  }

  const instrumentHints = [
    'kick',
    '808',
    '909',
    'snare',
    'clap',
    'hat',
    'hihat',
    'tom',
    'perc',
    'percussion',
    'ride',
    'crash',
    'shaker',
    'vocal',
    'vox',
    'bass',
    'synth',
    'piano',
    'guitar',
    'strings',
    'fx',
    'riser',
    'sweep',
    'impact',
    'whoosh',
  ]
  if (instrumentHints.some((hint) => lower.includes(hint))) {
    return 'instrument'
  }

  const characterHints = [
    'aggressive',
    'hard',
    'soft',
    'punchy',
    'fat',
    'thin',
    'dynamic',
    'compressed',
    'loud',
    'quiet',
    'lofi',
    'lo-fi',
    'acoustic',
    'dry',
    'tape',
    'distortion',
    'distorted',
    'distorsion',
    'vinyl',
    'saturated',
    'filtered',
    'clean',
    'dirty',
    'analog',
    'analogue',
    'digital',
    'vintage',
  ]
  if (characterHints.some((hint) => lower.includes(hint))) {
    return 'character'
  }

  return 'general'
}

function getTargetConfig(target: OllamaTarget): OllamaTargetConfig {
  return OLLAMA_TARGETS[target]
}

function getTargetState(target: OllamaTarget): OllamaTargetState {
  return ollamaTargetState[target]
}

async function acquireGenerateSlot(target: OllamaTarget): Promise<void> {
  const config = getTargetConfig(target)
  const state = getTargetState(target)
  if (state.activeGenerateRequests < config.maxConcurrentGenerate) {
    state.activeGenerateRequests += 1
    return
  }

  await new Promise<void>((resolve) => {
    state.generateQueue.push(resolve)
  })
  state.activeGenerateRequests += 1
}

function releaseGenerateSlot(target: OllamaTarget): void {
  const state = getTargetState(target)
  state.activeGenerateRequests = Math.max(0, state.activeGenerateRequests - 1)
  const next = state.generateQueue.shift()
  if (next) {
    next()
  }
}

function getGenerateCooldownRemainingMs(target: OllamaTarget): number {
  const state = getTargetState(target)
  return Math.max(0, state.generateCooldownUntil - Date.now())
}

function isGenerateCooldownActive(target: OllamaTarget): boolean {
  return getGenerateCooldownRemainingMs(target) > 0
}

function registerGenerateSuccess(target: OllamaTarget): void {
  const state = getTargetState(target)
  state.generateFailureCount = 0
}

function registerGenerateFailure(target: OllamaTarget): void {
  const config = getTargetConfig(target)
  const state = getTargetState(target)
  if (config.generateFailureThreshold <= 0 || config.generateFailureCooldownMs <= 0) return

  state.generateFailureCount += 1
  if (state.generateFailureCount < config.generateFailureThreshold) return

  state.generateFailureCount = 0
  state.generateCooldownUntil = Date.now() + config.generateFailureCooldownMs
  const cooldownSeconds = Math.ceil(config.generateFailureCooldownMs / 1000)
  console.warn(
    `[ollama:${config.label}] generate failure threshold reached, pausing generate requests for ${cooldownSeconds}s.`
  )
  logOllamaDebug('generate:cooldown-activated', {
    target: config.label,
    host: config.host,
    model: config.model,
    cooldownMs: config.generateFailureCooldownMs,
  })
}

function normalizeCategorizedTagList(raw: unknown[] | null, maxTags: number): CategorizedTag[] {
  if (!raw) return []

  const deduped = new Map<string, CategorizedTag>()

  for (const entry of raw) {
    let tag = ''
    let category: SemanticTagCategory = 'general'
    let confidence = 0.65

    if (typeof entry === 'string') {
      tag = normalizeTag(entry)
      category = inferCategoryFromTag(tag)
    } else if (entry && typeof entry === 'object') {
      const value = entry as Record<string, unknown>
      const rawTag = typeof value.tag === 'string'
        ? value.tag
        : typeof value.name === 'string'
          ? value.name
          : ''
      tag = normalizeTag(rawTag)
      category = mapCategory(typeof value.category === 'string' ? value.category : undefined)
      if (!value.category) {
        category = inferCategoryFromTag(tag)
      }
      confidence = clampConfidence(
        typeof value.confidence === 'number' ? value.confidence : undefined
      )
    } else {
      continue
    }

    if (!tag || tag.length >= 30) continue

    if (category === 'instrument') {
      const resolved = resolveTag(tag)
      if (!resolved.isKnown) continue
      tag = resolved.canonical
    }

    const existing = deduped.get(tag)
    if (!existing || confidence > existing.confidence) {
      deduped.set(tag, { tag, category, confidence })
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxTags)
}

async function generateFromOllama(
  prompt: string,
  options: {
    timeoutMs: number
    temperature: number
    numPredict: number
    context: string
    target?: OllamaTarget
    forceCpu?: boolean
  }
): Promise<string | null> {
  const target = options.target ?? 'primary'
  const config = getTargetConfig(target)
  const state = getTargetState(target)
  const forceCpu = options.forceCpu ?? config.forceCpu

  if (isGenerateCooldownActive(target)) {
    logOllamaDebug('request:skipped-cooldown', {
      target: config.label,
      host: config.host,
      model: config.model,
      forceCpu,
      context: options.context,
      cooldownRemainingMs: getGenerateCooldownRemainingMs(target),
    })
    return null
  }

  const queuedAt = Date.now()
  logOllamaDebug('enqueue', {
    target: config.label,
    host: config.host,
    model: config.model,
    forceCpu,
    context: options.context,
    active: state.activeGenerateRequests,
    queue: state.generateQueue.length,
  })

  await acquireGenerateSlot(target)
  const queueWaitMs = Date.now() - queuedAt

  logOllamaDebug('request:start', {
    target: config.label,
    host: config.host,
    model: config.model,
    forceCpu,
    context: options.context,
    timeoutMs: options.timeoutMs,
    temperature: options.temperature,
    numPredict: options.numPredict,
    queueWaitMs,
    active: state.activeGenerateRequests,
    queue: state.generateQueue.length,
    promptPreview: prompt,
  })

  const startedAt = Date.now()
  try {
    if (isGenerateCooldownActive(target)) {
      logOllamaDebug('request:skipped-cooldown-post-queue', {
        target: config.label,
        host: config.host,
        model: config.model,
        forceCpu,
        context: options.context,
        cooldownRemainingMs: getGenerateCooldownRemainingMs(target),
      })
      return null
    }

    const response = await axios.post<OllamaGenerateResponse>(
      `${config.host}/api/generate`,
      {
        model: config.model,
        prompt,
        stream: false,
        options: {
          temperature: options.temperature,
          num_predict: options.numPredict,
          ...(forceCpu ? { num_gpu: 0 } : {}),
        },
      },
      {
        timeout: options.timeoutMs,
      }
    )

    registerGenerateSuccess(target)
    const text = response.data.response.trim()
    logOllamaDebug('request:ok', {
      target: config.label,
      host: config.host,
      model: config.model,
      forceCpu,
      context: options.context,
      status: response.status,
      durationMs: Date.now() - startedAt,
      responseLength: text.length,
      responsePreview: text,
    })
    return text
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logOllamaDebug('request:error', {
        target: config.label,
        host: config.host,
        model: config.model,
        forceCpu,
        context: options.context,
        durationMs: Date.now() - startedAt,
        status: error.response?.status ?? null,
        code: error.code ?? null,
        message: error.message,
        responseData: error.response?.data ?? null,
      })
    } else {
      logOllamaDebug('request:error', {
        target: config.label,
        host: config.host,
        model: config.model,
        forceCpu,
        context: options.context,
        durationMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    registerGenerateFailure(target)
    return null
  } finally {
    releaseGenerateSlot(target)
    logOllamaDebug('slot:release', {
      target: config.label,
      host: config.host,
      model: config.model,
      forceCpu,
      context: options.context,
      active: state.activeGenerateRequests,
      queue: state.generateQueue.length,
    })
  }
}

function sleepMs(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

async function generateFromOllamaWithFallback(
  prompt: string,
  options: {
    timeoutMs: number
    temperature: number
    numPredict: number
    context: string
    targets: OllamaTarget[]
    retriesPerTarget: number
    retryDelayMs: number
    healthTimeoutMs: number
  }
): Promise<string | null> {
  const dedupedTargets: OllamaTarget[] = []
  const seen = new Set<OllamaTarget>()
  for (const target of options.targets) {
    if (seen.has(target)) continue
    dedupedTargets.push(target)
    seen.add(target)
  }
  if (dedupedTargets.length === 0) {
    dedupedTargets.push(...DEFAULT_TAG_REVIEW_TARGET_CHAIN)
  }

  const maxRetries = Math.max(0, options.retriesPerTarget)
  const attemptsPerTarget = maxRetries + 1
  logOllamaDebug('fallback-chain:start', {
    context: options.context,
    targets: dedupedTargets,
    retriesPerTarget: maxRetries,
    retryDelayMs: options.retryDelayMs,
    healthTimeoutMs: options.healthTimeoutMs,
  })

  for (const target of dedupedTargets) {
    const config = getTargetConfig(target)

    if (isGenerateCooldownActive(target)) {
      logOllamaDebug('fallback-chain:skip-cooldown', {
        context: options.context,
        target: config.label,
        host: config.host,
        model: config.model,
        cooldownRemainingMs: getGenerateCooldownRemainingMs(target),
      })
      continue
    }

    const isHealthy = await checkOllamaHealth({
      timeoutMs: options.healthTimeoutMs,
      target,
    })
    if (!isHealthy) {
      logOllamaDebug('fallback-chain:skip-unhealthy', {
        context: options.context,
        target: config.label,
        host: config.host,
        model: config.model,
      })
      continue
    }

    for (let attempt = 1; attempt <= attemptsPerTarget; attempt += 1) {
      const text = await generateFromOllama(prompt, {
        timeoutMs: options.timeoutMs,
        temperature: options.temperature,
        numPredict: options.numPredict,
        context: `${options.context}:${config.label}:attempt-${attempt}`,
        target,
      })
      if (text) {
        logOllamaDebug('fallback-chain:success', {
          context: options.context,
          target: config.label,
          host: config.host,
          model: config.model,
          attempt,
        })
        return text
      }

      if (attempt < attemptsPerTarget) {
        await sleepMs(options.retryDelayMs)
      }
    }

    logOllamaDebug('fallback-chain:target-exhausted', {
      context: options.context,
      target: config.label,
      host: config.host,
      model: config.model,
      attempts: attemptsPerTarget,
    })
  }

  logOllamaDebug('fallback-chain:all-failed', {
    context: options.context,
    targets: dedupedTargets,
  })
  return null
}

export async function extractTagsFromDescription(
  title: string,
  description: string
): Promise<string[]> {
  const prompt = `Analyze this YouTube video about music/audio and extract relevant tags for categorization.

Title: ${title}

Description: ${description.slice(0, 1500)}

Extract 3-8 tags from these categories:
- Genre (e.g., jazz, hip-hop, electronic, classical, rock, soul, funk)
- Mood (e.g., chill, energetic, dark, uplifting, melancholic)
- Instruments (e.g., piano, drums, guitar, synth, bass, strings)
- Era/decade (e.g., 70s, 80s, vintage, modern)
- Style (e.g., lo-fi, cinematic, ambient, acoustic)

Return ONLY a JSON array of lowercase tag strings, nothing else.
Example: ["jazz", "piano", "70s", "chill", "sampling"]`

  try {
    const text = await generateFromOllama(prompt, {
      timeoutMs: 60000,
      temperature: 0.3,
      numPredict: 200,
      context: 'youtube-description-tags',
      target: 'primary',
    })
    if (!text) return []

    const tags = normalizeSimpleTagList(tryParseJsonArray(text), 8)
    if (tags.length > 0) {
      logOllamaDebug('youtube-tags:parsed', { count: tags.length, tags })
      return tags
    }

    // Fallback: try comma-separated tags
    const commaTags = text
      .replace(/[\[\]"']/g, '')
      .split(',')
      .map((t) => normalizeTag(t))
      .filter((t) => t.length > 0 && t.length < 30)
      .slice(0, 8)

    logOllamaDebug('youtube-tags:fallback-comma', { count: commaTags.length, tags: commaTags })
    return commaTags.length > 0 ? commaTags : []
  } catch (error) {
    console.error('Ollama tag extraction failed:', error)
    return []
  }
}

export async function checkOllamaHealth(
  options: { timeoutMs?: number; force?: boolean; target?: OllamaTarget } = {}
): Promise<boolean> {
  const target = options.target ?? 'primary'
  const config = getTargetConfig(target)
  const state = getTargetState(target)
  const now = Date.now()
  if (!options.force && state.healthCache && state.healthCache.expiresAt > now) {
    return state.healthCache.value
  }

  try {
    const response = await axios.get(`${config.host}/api/tags`, {
      timeout: options.timeoutMs ?? 5000,
    })
    const healthy = response.status === 200
    state.healthCache = {
      value: healthy,
      expiresAt: now + OLLAMA_HEALTH_CACHE_MS,
    }
    return healthy
  } catch {
    state.healthCache = {
      value: false,
      expiresAt: now + OLLAMA_HEALTH_FAILURE_CACHE_MS,
    }
    return false
  }
}

export async function ensureModelAvailable(
  options: { target?: OllamaTarget } = {}
): Promise<boolean> {
  const target = options.target ?? 'primary'
  const config = getTargetConfig(target)
  try {
    const response = await axios.get<OllamaTagsResponse>(`${config.host}/api/tags`)
    const models = response.data.models || []
    return models.some(
      (m) => typeof m.name === 'string' && m.name.startsWith(config.model.split(':')[0])
    )
  } catch {
    return false
  }
}

export async function extractCategorizedTagsFromText(input: {
  filename: string
  folderPath?: string | null
  maxTags?: number
}): Promise<CategorizedTag[]> {
  if (!OLLAMA_FILENAME_TAGGING_ENABLED) return []

  const filename = input.filename.trim()
  if (!filename) return []

  const isHealthy = await checkOllamaHealth({ timeoutMs: 800, target: 'primary' })
  if (!isHealthy) return []

  const folderPath = input.folderPath?.trim() || ''
  const maxTags = Math.min(Math.max(input.maxTags ?? 10, 1), 20)

  const prompt = `Classify tags from this audio sample name and folder path.

Filename: ${filename}
Folder path: ${folderPath || '(none)'}

Task:
- Extract useful tags that are explicitly present or strongly implied through the text.
- Use ONLY these categories: instrument, type, character, general.
- "instrument": clap, perc, tom, kick, snare, hat, bass, synth, vocal, fx, violin, trumpet, horns... (long etc)
- "type": one-shot / loop if they are present or very evident otherwise skip.
- "character": lofi, acoustic, dry, tape, distortion, vinyl, saturated, filtered, clean, dirty, analog.
- "general": mood/style/context tags (genre-like words can be general tags, not a category).
- Keep tags lowercase, short, and singular when possible.
- Make sure that they make syntactic and semantic sense (e.g. if "vinyl" is present, "lofi" should also be present as character; if "perc" is present, "vocal" should not be present). 
- Do not include duplicate tags.
- Avoid picking out meaningless or junk tags like vinyl02, tron, opaque IDs/codes.
- Return between 0 and ${maxTags} tags.

Return ONLY JSON:
[
  {"tag":"clap","category":"instrument","confidence":0.98},
  {"tag":"oneshot","category":"type","confidence":0.95}
]

No prose, no markdown.`

  const text = await generateFromOllama(prompt, {
    timeoutMs: OLLAMA_FILENAME_TIMEOUT_MS,
    temperature: 0.1,
    numPredict: 160,
    context: 'filename-tag-extract',
    target: 'primary',
  })
  if (!text) return []

  const tags = normalizeCategorizedTagList(tryParseJsonArray(text), maxTags)
  logOllamaDebug('filename-tags:parsed', {
    filename,
    folderPath: folderPath || null,
    count: tags.length,
    tags,
  })
  return tags
}

export interface TagReviewInput {
  sampleName: string
  folderPath?: string | null
  modelTags: string[]
  previousAutoTags?: string[]
  filenameTags?: Array<{ tag: string; category?: string; confidence?: number }>
  instrumentType?: string | null
  genrePrimary?: string | null
  maxTags?: number
}

type TagReviewMode = 'review' | 'review_batch' | 'audit'

type TagReviewRuntimeOptions = {
  timeoutMs: number
  temperature: number
  numPredict: number
  context: string
  targets: OllamaTarget[]
  retriesPerTarget: number
  retryDelayMs: number
  healthTimeoutMs: number
}

type TagReviewRuntimeOverrides = Partial<TagReviewRuntimeOptions> & {
  contextSuffix?: string
}

function normalizeTagReviewInput(
  input: TagReviewInput
): Omit<TagReviewInput, 'maxTags'> & { maxTags: number } {
  const modelTags = Array.from(
    new Set(
      (input.modelTags || [])
        .map((tag) => normalizeTag(tag))
        .filter((tag) => tag.length > 0 && tag.length < 30)
    )
  )
  const previousAutoTags = Array.from(
    new Set(
      (input.previousAutoTags || [])
        .map((tag) => normalizeTag(tag))
        .filter((tag) => tag.length > 0 && tag.length < 30)
    )
  )
  const filenameTags = (input.filenameTags || [])
    .map((entry) => ({
      tag: normalizeTag(entry.tag || ''),
      category: mapCategory(entry.category),
      confidence: clampConfidence(entry.confidence),
    }))
    .filter((entry) => entry.tag.length > 0 && entry.tag.length < 30)

  return {
    sampleName: input.sampleName.trim(),
    folderPath: input.folderPath?.trim() || null,
    modelTags,
    previousAutoTags,
    filenameTags,
    instrumentType: input.instrumentType?.trim().toLowerCase() || null,
    genrePrimary: input.genrePrimary?.trim().toLowerCase() || null,
    maxTags: Math.min(Math.max(input.maxTags ?? 10, 1), 20),
  }
}

function getTagReviewRuntimeOptions(mode: TagReviewMode): TagReviewRuntimeOptions {
  if (mode === 'review_batch') {
    return {
      timeoutMs: OLLAMA_TAG_REVIEW_BATCH_TIMEOUT_MS,
      temperature: 0.05,
      numPredict: 1200,
      context: 'post-analysis-review-batch',
      targets: OLLAMA_TAG_REVIEW_TARGET_CHAIN,
      retriesPerTarget: OLLAMA_TAG_REVIEW_RETRIES_PER_TARGET,
      retryDelayMs: OLLAMA_TAG_REVIEW_RETRY_DELAY_MS,
      healthTimeoutMs: OLLAMA_TAG_REVIEW_HEALTH_TIMEOUT_MS,
    }
  }

  if (mode === 'audit') {
    return {
      timeoutMs: OLLAMA_TAG_AUDIT_TIMEOUT_MS,
      temperature: 0.05,
      numPredict: 1200,
      context: 'post-analysis-audit',
      targets: OLLAMA_TAG_AUDIT_TARGET_CHAIN,
      retriesPerTarget: OLLAMA_TAG_AUDIT_RETRIES_PER_TARGET,
      retryDelayMs: OLLAMA_TAG_AUDIT_RETRY_DELAY_MS,
      healthTimeoutMs: OLLAMA_TAG_AUDIT_HEALTH_TIMEOUT_MS,
    }
  }

  return {
    timeoutMs: OLLAMA_TAG_REVIEW_TIMEOUT_MS,
    temperature: 0.05,
    numPredict: 300,
    context: 'post-analysis-review',
    targets: OLLAMA_TAG_REVIEW_TARGET_CHAIN,
    retriesPerTarget: OLLAMA_TAG_REVIEW_RETRIES_PER_TARGET,
    retryDelayMs: OLLAMA_TAG_REVIEW_RETRY_DELAY_MS,
    healthTimeoutMs: OLLAMA_TAG_REVIEW_HEALTH_TIMEOUT_MS,
  }
}

function resolveTagReviewRuntimeOptions(
  mode: TagReviewMode,
  overrides?: TagReviewRuntimeOverrides
): TagReviewRuntimeOptions {
  const base = getTagReviewRuntimeOptions(mode)
  const contextSuffix = overrides?.contextSuffix?.trim()
  return {
    timeoutMs: overrides?.timeoutMs ?? base.timeoutMs,
    temperature: overrides?.temperature ?? base.temperature,
    numPredict: overrides?.numPredict ?? base.numPredict,
    context: contextSuffix ? `${base.context}:${contextSuffix}` : (overrides?.context ?? base.context),
    targets: overrides?.targets && overrides.targets.length > 0 ? overrides.targets : base.targets,
    retriesPerTarget: overrides?.retriesPerTarget ?? base.retriesPerTarget,
    retryDelayMs: overrides?.retryDelayMs ?? base.retryDelayMs,
    healthTimeoutMs: overrides?.healthTimeoutMs ?? base.healthTimeoutMs,
  }
}

type NormalizedTagReviewInput = ReturnType<typeof normalizeTagReviewInput>

function buildTagReviewPrompt(
  normalized: NormalizedTagReviewInput,
  additionalInstructions?: string | null
): string {
  const extraInstructions = additionalInstructions?.trim()
    ? `\nAdditional constraints from bulk audit:\n${additionalInstructions.trim()}\n`
    : ''

  return `You are the post-analysis tag QA stage for an audio sample library.

Your task: review candidate tags and output a coherent final tag set.

Sample name: ${normalized.sampleName}
Folder path: ${normalized.folderPath || '(none)'}
Model tags: ${JSON.stringify(normalized.modelTags)}
Previous auto tags: ${JSON.stringify(normalized.previousAutoTags)}
Filename hint tags: ${JSON.stringify(normalized.filenameTags)}
Derived instrument type: ${normalized.instrumentType || '(unknown)'}
Derived genre metadata field: ${normalized.genrePrimary || '(unknown)'}
${extraInstructions}
Rules:
1) Allowed categories ONLY: instrument, type, character, general.
1.1) For category "instrument", use ONLY these canonical tags: ${ALLOWED_INSTRUMENT_TAGS_PROMPT}
2) Choose one primary instrument-family tag for most cases unless strong evidence.
3) Reject contradictory instrument bundles (example bad: vocal + hat + snare + synth + tom + bass + fx).
4) If the name strongly implies percussion (perc/hat/snare/kick/tom), do not pick vocal unless evidence is overwhelming.
5) Category semantics:
   - instrument: kick, snare, hihat, tom, clap, percussion, bass, synth, vocal, fx, etc.
   - type: EXCLUSIVELY "oneshot" or "loop".
   - character: lofi, acoustic, dry, tape, distortion, vinyl, saturated, filtered, clean, dirty, analog, digital, vintage.
   - general: other useful context tags.
6) Canonicalize synonyms/spelling:
   - distorsion/distorted -> distortion
   - lo-fi -> lofi
   - one-shot/one_shot -> oneshot
7) Semantic coherence rules:
   - If you output vinyl, also output lofi (both as character).
   - Do NOT output raw compound filename chunks like perc-metal or perc-nasty.
   - Instead map them to meaningful semantics (e.g. percussion + metallic / harsh).
8) Reject junk tags like vinyl02, tron, opaque IDs/codes, or meaningless noise labels.
9) Keep tags lowercase, short, singular, and sensible.
10) Genre is metadata, not a category label. If a genre-like tag is useful, place it in general.
11) Return between 0 and ${normalized.maxTags} tags when possible.

Return ONLY JSON array:
[
  {"tag":"snare","category":"instrument","confidence":0.92},
  {"tag":"oneshot","category":"type","confidence":0.88},
  {"tag":"distortion","category":"character","confidence":0.84}
]

No prose. No markdown.`
}

async function reviewNormalizedSampleTagsWithOllama(
  normalized: NormalizedTagReviewInput,
  options?: {
    mode?: TagReviewMode
    runtimeOverrides?: TagReviewRuntimeOverrides
    additionalInstructions?: string | null
  }
): Promise<CategorizedTag[]> {
  const runtime = resolveTagReviewRuntimeOptions(options?.mode ?? 'review', options?.runtimeOverrides)
  const prompt = buildTagReviewPrompt(normalized, options?.additionalInstructions)
  const text = await generateFromOllamaWithFallback(prompt, {
    timeoutMs: runtime.timeoutMs,
    temperature: runtime.temperature,
    numPredict: runtime.numPredict,
    context: runtime.context,
    targets: runtime.targets,
    retriesPerTarget: runtime.retriesPerTarget,
    retryDelayMs: runtime.retryDelayMs,
    healthTimeoutMs: runtime.healthTimeoutMs,
  })
  if (!text) return []

  const reviewedTags = normalizeCategorizedTagList(tryParseJsonArray(text), normalized.maxTags)
  logOllamaDebug('tag-review:parsed', {
    sampleName: normalized.sampleName,
    folderPath: normalized.folderPath,
    count: reviewedTags.length,
    tags: reviewedTags,
  })
  return reviewedTags
}

export async function reviewSampleTagsWithOllama(input: TagReviewInput): Promise<CategorizedTag[]> {
  if (!OLLAMA_TAG_REVIEW_ENABLED) return []

  const normalized = normalizeTagReviewInput(input)
  if (!normalized.sampleName) return []

  return reviewNormalizedSampleTagsWithOllama(normalized, { mode: 'review' })
}

export async function reviewSampleTagsWithOllamaTarget(
  input: TagReviewInput,
  target: 'primary' | 'analyzer' | 'cpu',
  options?: {
    additionalInstructions?: string | null
    contextSuffix?: string
    timeoutMs?: number
  }
): Promise<CategorizedTag[]> {
  if (!OLLAMA_TAG_REVIEW_ENABLED) return []

  const normalized = normalizeTagReviewInput(input)
  if (!normalized.sampleName) return []

  return reviewNormalizedSampleTagsWithOllama(normalized, {
    mode: 'review',
    additionalInstructions: options?.additionalInstructions,
    runtimeOverrides: {
      targets: [target],
      retriesPerTarget: 0,
      contextSuffix: options?.contextSuffix ?? `single-${target}`,
      ...(typeof options?.timeoutMs === 'number' && options.timeoutMs > 0
        ? { timeoutMs: options.timeoutMs }
        : {}),
    },
  })
}

export interface TagReviewBatchSampleInput extends TagReviewInput {
  sliceId: number
  additionalInstructions?: string | null
}

export interface TagReviewBatchInput {
  samples: TagReviewBatchSampleInput[]
  maxTags?: number
}

export interface TagReviewBatchResult {
  sliceId: number
  tags: CategorizedTag[]
  note: string | null
}

function normalizeTagReviewBatchInput(input: TagReviewBatchInput): {
  samples: Array<{ sliceId: number; normalized: NormalizedTagReviewInput; additionalInstructions: string | null }>
  maxTags: number
} {
  const maxTags = Math.min(Math.max(input.maxTags ?? 10, 1), 20)
  const samples: Array<{ sliceId: number; normalized: NormalizedTagReviewInput; additionalInstructions: string | null }> = []
  const seenSliceIds = new Set<number>()

  for (const sample of input.samples || []) {
    const sliceId = Number.isInteger(sample.sliceId) ? sample.sliceId : Number.NaN
    if (!Number.isFinite(sliceId) || sliceId <= 0 || seenSliceIds.has(sliceId)) continue

    const normalized = normalizeTagReviewInput({
      ...sample,
      maxTags: Math.min(sample.maxTags ?? maxTags, maxTags),
    })
    if (!normalized.sampleName) continue

    samples.push({
      sliceId,
      normalized,
      additionalInstructions: sample.additionalInstructions?.trim() || null,
    })
    seenSliceIds.add(sliceId)
  }

  return { samples, maxTags }
}

function parseTagReviewBatchResults(
  raw: unknown[] | null,
  validSliceIds: Set<number>,
  defaultMaxTags: number
): TagReviewBatchResult[] {
  if (!raw) return []

  const bySliceId = new Map<number, TagReviewBatchResult>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const value = entry as Record<string, unknown>
    const rawSliceId = typeof value.sliceId === 'number'
      ? value.sliceId
      : typeof value.slice_id === 'number'
        ? value.slice_id
        : Number.NaN
    const sliceId = Number.isInteger(rawSliceId) ? rawSliceId : Number.NaN
    if (!Number.isFinite(sliceId) || sliceId <= 0 || !validSliceIds.has(sliceId)) continue

    const rawTags = Array.isArray(value.tags)
      ? value.tags
      : Array.isArray(value.reviewedTags)
        ? value.reviewedTags
        : Array.isArray(value.suggestedTags)
          ? value.suggestedTags
          : []
    const tags = normalizeCategorizedTagList(rawTags, defaultMaxTags)
    const note = typeof value.note === 'string'
      ? value.note.trim() || null
      : typeof value.reason === 'string'
        ? value.reason.trim() || null
        : null

    const existing = bySliceId.get(sliceId)
    if (!existing || tags.length > existing.tags.length) {
      bySliceId.set(sliceId, { sliceId, tags, note })
    }
  }

  return Array.from(bySliceId.values())
}

export async function reviewSampleTagBatchWithOllama(input: TagReviewBatchInput): Promise<TagReviewBatchResult[]> {
  if (!OLLAMA_TAG_REVIEW_ENABLED) return []

  const normalized = normalizeTagReviewBatchInput(input)
  if (normalized.samples.length === 0) return []

  const payload = normalized.samples.map((entry) => ({
    sliceId: entry.sliceId,
    sampleName: entry.normalized.sampleName,
    folderPath: entry.normalized.folderPath,
    modelTags: entry.normalized.modelTags,
    previousAutoTags: entry.normalized.previousAutoTags,
    filenameTags: entry.normalized.filenameTags,
    instrumentType: entry.normalized.instrumentType,
    genrePrimary: entry.normalized.genrePrimary,
    maxTags: entry.normalized.maxTags,
    additionalInstructions: entry.additionalInstructions,
  }))

  const prompt = `You are the post-analysis tag QA stage for an audio sample library.

Review tags for EACH sample in this batch and return one output object per sliceId.

Input batch:
${JSON.stringify(payload)}

Rules:
1) Allowed categories only: instrument, type, character, general.
1.1) For category "instrument", use ONLY these canonical tags: ${ALLOWED_INSTRUMENT_TAGS_PROMPT}
2) Keep each sample coherent; avoid contradictory instrument bundles.
3) Type category can only be oneshot or loop.
4) Reject non-musical/junk tags and opaque IDs.
5) If vinyl is present, include lofi (both character).
6) Keep tags lowercase, short, singular, sensible.
7) Use additionalInstructions per sample when provided.
8) Return at most each sample's maxTags.

Return ONLY JSON array:
[
  {
    "sliceId": 123,
    "tags": [
      {"tag":"snare","category":"instrument","confidence":0.92},
      {"tag":"oneshot","category":"type","confidence":0.90}
    ],
    "note": "optional short note"
  }
]

No prose. No markdown.`

  const runtime = resolveTagReviewRuntimeOptions('review_batch')
  const text = await generateFromOllamaWithFallback(prompt, {
    timeoutMs: runtime.timeoutMs,
    temperature: runtime.temperature,
    numPredict: runtime.numPredict,
    context: runtime.context,
    targets: runtime.targets,
    retriesPerTarget: runtime.retriesPerTarget,
    retryDelayMs: runtime.retryDelayMs,
    healthTimeoutMs: runtime.healthTimeoutMs,
  })
  if (!text) return []

  const validSliceIds = new Set<number>(normalized.samples.map((entry) => entry.sliceId))
  const results = parseTagReviewBatchResults(tryParseJsonArray(text), validSliceIds, normalized.maxTags)
  logOllamaDebug('tag-review-batch:parsed', {
    sampleCount: normalized.samples.length,
    resultCount: results.length,
    results,
  })
  return results
}

export interface TagAuditSampleInput {
  sliceId: number
  sampleName: string
  folderPath?: string | null
  currentTags: Array<{ tag: string; category?: string; confidence?: number }>
  modelTags?: string[]
  isOneShot?: boolean
  isLoop?: boolean
  instrumentHint?: string | null
  genrePrimary?: string | null
}

export interface TagAuditBatchInput {
  samples: TagAuditSampleInput[]
  maxTags?: number
}

export interface TagAuditIssue {
  sliceId: number
  reason: string | null
  suspiciousTags: string[]
  suggestedTags: CategorizedTag[]
}

type NormalizedTagAuditSample = {
  sliceId: number
  sampleName: string
  folderPath: string | null
  currentTags: CategorizedTag[]
  modelTags: string[]
  isOneShot: boolean | null
  isLoop: boolean | null
  instrumentHint: string | null
  genrePrimary: string | null
}

function normalizeTagAuditInput(
  input: TagAuditBatchInput
): { maxTags: number; samples: NormalizedTagAuditSample[] } {
  const maxTags = Math.min(Math.max(input.maxTags ?? 10, 1), 20)
  const samples: NormalizedTagAuditSample[] = []
  const seenSliceIds = new Set<number>()

  for (const sample of input.samples || []) {
    const sliceId = Number.isInteger(sample.sliceId) ? sample.sliceId : Number.NaN
    if (!Number.isFinite(sliceId) || sliceId <= 0 || seenSliceIds.has(sliceId)) continue

    const sampleName = sample.sampleName?.trim() || ''
    if (!sampleName) continue

    const currentTags = normalizeCategorizedTagList(
      (sample.currentTags || []).map((entry) => ({
        tag: entry.tag,
        category: entry.category,
        confidence: entry.confidence,
      })),
      maxTags
    )

    const modelTags = Array.from(
      new Set(
        (sample.modelTags || [])
          .map((tag) => normalizeTag(tag))
          .filter((tag) => tag.length > 0 && tag.length < 30)
      )
    )

    samples.push({
      sliceId,
      sampleName,
      folderPath: sample.folderPath?.trim() || null,
      currentTags,
      modelTags,
      isOneShot: typeof sample.isOneShot === 'boolean' ? sample.isOneShot : null,
      isLoop: typeof sample.isLoop === 'boolean' ? sample.isLoop : null,
      instrumentHint: sample.instrumentHint?.trim().toLowerCase() || null,
      genrePrimary: sample.genrePrimary?.trim().toLowerCase() || null,
    })
    seenSliceIds.add(sliceId)
  }

  return { maxTags, samples }
}

function parseTagAuditIssues(raw: unknown[] | null, validSliceIds: Set<number>, maxTags: number): TagAuditIssue[] {
  if (!raw) return []

  const bySliceId = new Map<number, TagAuditIssue>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const value = entry as Record<string, unknown>
    const rawSliceId = typeof value.sliceId === 'number'
      ? value.sliceId
      : typeof value.slice_id === 'number'
        ? value.slice_id
        : Number.NaN
    const sliceId = Number.isInteger(rawSliceId) ? rawSliceId : Number.NaN
    if (!Number.isFinite(sliceId) || sliceId <= 0 || !validSliceIds.has(sliceId)) continue

    const weird = typeof value.weird === 'boolean' ? value.weird : true
    const suggestedRaw = Array.isArray(value.suggestedTags)
      ? value.suggestedTags
      : Array.isArray(value.recommendedTags)
        ? value.recommendedTags
        : []
    const suggestedTags = normalizeCategorizedTagList(suggestedRaw, maxTags)

    const suspiciousRaw = Array.isArray(value.suspiciousTags)
      ? value.suspiciousTags
      : Array.isArray(value.weirdTags)
        ? value.weirdTags
        : []
    const suspiciousTags = normalizeSimpleTagList(suspiciousRaw, 24)

    const reason = typeof value.reason === 'string'
      ? value.reason.trim() || null
      : typeof value.issue === 'string'
        ? value.issue.trim() || null
        : null

    if (!weird && suggestedTags.length === 0 && suspiciousTags.length === 0 && !reason) {
      continue
    }

    const existing = bySliceId.get(sliceId)
    if (
      !existing ||
      suggestedTags.length > existing.suggestedTags.length ||
      suspiciousTags.length > existing.suspiciousTags.length
    ) {
      bySliceId.set(sliceId, {
        sliceId,
        reason,
        suspiciousTags,
        suggestedTags,
      })
    }
  }

  return Array.from(bySliceId.values())
}

export async function auditSampleTagsWithOllama(input: TagAuditBatchInput): Promise<TagAuditIssue[]> {
  if (!OLLAMA_TAG_REVIEW_ENABLED) return []

  const normalized = normalizeTagAuditInput(input)
  if (normalized.samples.length === 0) return []

  const samplePayload = normalized.samples.map((sample) => ({
    sliceId: sample.sliceId,
    sampleName: sample.sampleName,
    folderPath: sample.folderPath,
    currentTags: sample.currentTags,
    modelTags: sample.modelTags,
    isOneShot: sample.isOneShot,
    isLoop: sample.isLoop,
    instrumentHint: sample.instrumentHint,
    genrePrimary: sample.genrePrimary,
  }))

  const prompt = `You are the final post-analysis tag auditor for an audio sample library.

Review each sample's CURRENT tags and flag only the problematic ones.

Input samples:
${JSON.stringify(samplePayload)}

Rules:
1) Allowed categories only: instrument, type, character, general.
1.1) For category "instrument", use ONLY these canonical tags: ${ALLOWED_INSTRUMENT_TAGS_PROMPT}
2) A "type" tag can only be oneshot or loop.
3) Reject non-musical / junk tags (IDs, garbage tokens, nonsense labels).
4) Reject contradictory sets (example: vocal + snare + hihat + synth on a single short one-shot unless very strong evidence).
5) If current tags are coherent, do NOT include that sample in output.
6) For flagged samples, infer a corrected full replacement tag set in suggestedTags.
7) Keep tags lowercase, short, and semantically musical.
8) If vinyl is present, include lofi (both character).
9) Prefer one primary instrument-family tag unless strong evidence for multiple.
10) Return only tags you are confident are supported by the sample name/folder/model context.

Return ONLY JSON array (empty array when no issues):
[
  {
    "sliceId": 123,
    "reason": "brief explanation",
    "suspiciousTags": ["tron", "vocal"],
    "suggestedTags": [
      {"tag":"snare","category":"instrument","confidence":0.93},
      {"tag":"oneshot","category":"type","confidence":0.90}
    ]
  }
]

No prose. No markdown.`

  const runtime = getTagReviewRuntimeOptions('audit')
  const text = await generateFromOllamaWithFallback(prompt, {
    timeoutMs: runtime.timeoutMs,
    temperature: runtime.temperature,
    numPredict: runtime.numPredict,
    context: runtime.context,
    targets: runtime.targets,
    retriesPerTarget: runtime.retriesPerTarget,
    retryDelayMs: runtime.retryDelayMs,
    healthTimeoutMs: runtime.healthTimeoutMs,
  })
  if (!text) return []

  const validSliceIds = new Set<number>(normalized.samples.map((sample) => sample.sliceId))
  const issues = parseTagAuditIssues(tryParseJsonArray(text), validSliceIds, normalized.maxTags)
  logOllamaDebug('tag-audit:parsed', {
    sampleCount: normalized.samples.length,
    issueCount: issues.length,
    issues,
  })
  return issues
}
