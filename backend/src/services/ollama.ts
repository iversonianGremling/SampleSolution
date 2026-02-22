import axios from 'axios'

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b'
const OLLAMA_FILENAME_TAGGING_ENABLED = process.env.OLLAMA_FILENAME_TAGGING !== '0'
const OLLAMA_FILENAME_TIMEOUT_MS = Number(process.env.OLLAMA_FILENAME_TIMEOUT_MS || 8000)
const OLLAMA_HEALTH_CACHE_MS = Number(process.env.OLLAMA_HEALTH_CACHE_MS || 60000)

interface OllamaGenerateResponse {
  response: string
  done: boolean
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>
}

type HealthCache = {
  value: boolean
  expiresAt: number
}

let ollamaHealthCache: HealthCache | null = null

export type SemanticTagCategory = 'general' | 'type' | 'energy' | 'instrument'

export interface CategorizedTag {
  tag: string
  category: SemanticTagCategory
  confidence: number
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
    return 'energy'
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

  const energyHints = [
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
  ]
  if (energyHints.some((hint) => lower.includes(hint))) {
    return 'energy'
  }

  return 'general'
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
  options: { timeoutMs: number; temperature: number; numPredict: number }
): Promise<string | null> {
  try {
    const response = await axios.post<OllamaGenerateResponse>(
      `${OLLAMA_HOST}/api/generate`,
      {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: options.temperature,
          num_predict: options.numPredict,
        },
      },
      {
        timeout: options.timeoutMs,
      }
    )

    return response.data.response.trim()
  } catch {
    return null
  }
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
- Use case (e.g., sampling, beats, loops, vocals)

Return ONLY a JSON array of lowercase tag strings, nothing else.
Example: ["jazz", "piano", "70s", "chill", "sampling"]`

  try {
    const text = await generateFromOllama(prompt, {
      timeoutMs: 60000,
      temperature: 0.3,
      numPredict: 200,
    })
    if (!text) return []

    const tags = normalizeSimpleTagList(tryParseJsonArray(text), 8)
    if (tags.length > 0) return tags

    // Fallback: try comma-separated tags
    const commaTags = text
      .replace(/[\[\]"']/g, '')
      .split(',')
      .map((t) => normalizeTag(t))
      .filter((t) => t.length > 0 && t.length < 30)
      .slice(0, 8)

    return commaTags.length > 0 ? commaTags : []
  } catch (error) {
    console.error('Ollama tag extraction failed:', error)
    return []
  }
}

export async function checkOllamaHealth(
  options: { timeoutMs?: number; force?: boolean } = {}
): Promise<boolean> {
  const now = Date.now()
  if (!options.force && ollamaHealthCache && ollamaHealthCache.expiresAt > now) {
    return ollamaHealthCache.value
  }

  try {
    const response = await axios.get(`${OLLAMA_HOST}/api/tags`, {
      timeout: options.timeoutMs ?? 5000,
    })
    const healthy = response.status === 200
    ollamaHealthCache = {
      value: healthy,
      expiresAt: now + OLLAMA_HEALTH_CACHE_MS,
    }
    return healthy
  } catch {
    ollamaHealthCache = {
      value: false,
      expiresAt: now + OLLAMA_HEALTH_CACHE_MS,
    }
    return false
  }
}

export async function ensureModelAvailable(): Promise<boolean> {
  try {
    const response = await axios.get<OllamaTagsResponse>(`${OLLAMA_HOST}/api/tags`)
    const models = response.data.models || []
    return models.some((m) => typeof m.name === 'string' && m.name.startsWith(OLLAMA_MODEL.split(':')[0]))
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

  const isHealthy = await checkOllamaHealth({ timeoutMs: 800 })
  if (!isHealthy) return []

  const folderPath = input.folderPath?.trim() || ''
  const maxTags = Math.min(Math.max(input.maxTags ?? 10, 1), 20)

  const prompt = `Classify tags from this audio sample name and folder path.

Filename: ${filename}
Folder path: ${folderPath || '(none)'}

Task:
- Extract useful tags that are explicitly present or strongly implied.
- Use ONLY these categories: instrument, type, energy, general.
- "instrument": clap, perc, tom, kick, snare, hat, bass, synth, vocal, fx, etc.
- "type": one-shot / oneshot / loop / beat / fill / break.
- "energy": hard/soft/aggressive/punchy/fat/thin/dynamic/compressed.
- "general": mood, genre, style, processing, era, texture (e.g. lofi, dry, analog, dark, trap, house).
- Keep tags lowercase, short, and singular when possible.

Return ONLY JSON:
[
  {"tag":"clap","category":"instrument","confidence":0.98},
  {"tag":"oneshot","category":"type","confidence":0.95}
]

No prose, no markdown.`

  const text = await generateFromOllama(prompt, {
    timeoutMs: OLLAMA_FILENAME_TIMEOUT_MS,
    temperature: 0.1,
    numPredict: 220,
  })
  if (!text) return []

  return normalizeCategorizedTagList(tryParseJsonArray(text), maxTags)
}
