/**
 * Canonical Tag Registry
 * Single source of truth for tag metadata: aliases, categories, colors, reducibility.
 * Stripped to instrument-only — type/character/general categories removed.
 */

export type TagCategory = 'instrument' | 'filename'

export interface TagRegistryEntry {
  category: 'instrument'
  color: string
  aliases: string[]
}

// ---------------------------------------------------------------------------
// Canonical Tag Registry — instrument tags only
// ---------------------------------------------------------------------------

export const TAG_REGISTRY: Record<string, TagRegistryEntry> = {
  kick: { category: 'instrument', color: '#22c55e', aliases: ['808', 'bd', 'bassdrum'] },
  snare: { category: 'instrument', color: '#22c55e', aliases: ['sd', 'snr'] },
  hihat: { category: 'instrument', color: '#22c55e', aliases: ['hh', 'hat'] },
  clap: { category: 'instrument', color: '#22c55e', aliases: ['clp'] },
  rimshot: { category: 'instrument', color: '#22c55e', aliases: ['rim'] },
  tom: { category: 'instrument', color: '#22c55e', aliases: [] },
  cymbal: { category: 'instrument', color: '#22c55e', aliases: ['crash', 'ride'] },
  shaker: { category: 'instrument', color: '#22c55e', aliases: ['tambourine', 'maraca', 'maracas'] },
  percussion: { category: 'instrument', color: '#22c55e', aliases: ['perc'] },
  bass: { category: 'instrument', color: '#22c55e', aliases: ['sub'] },
  synth: { category: 'instrument', color: '#22c55e', aliases: ['synthesizer'] },
  pad: { category: 'instrument', color: '#22c55e', aliases: [] },
  lead: { category: 'instrument', color: '#22c55e', aliases: [] },
  pluck: { category: 'instrument', color: '#22c55e', aliases: [] },
  keys: { category: 'instrument', color: '#22c55e', aliases: ['piano', 'rhodes', 'organ'] },
  guitar: { category: 'instrument', color: '#22c55e', aliases: ['gtr'] },
  strings: { category: 'instrument', color: '#22c55e', aliases: ['violin', 'cello', 'viola'] },
  brass: { category: 'instrument', color: '#22c55e', aliases: ['trumpet', 'trombone', 'horn'] },
  flute: { category: 'instrument', color: '#22c55e', aliases: ['sax', 'saxophone'] },
  vocal: { category: 'instrument', color: '#22c55e', aliases: ['vox', 'voice'] },
  fx: { category: 'instrument', color: '#22c55e', aliases: ['fxs', 'riser', 'sweep', 'impact', 'whoosh'] },
  foley: { category: 'instrument', color: '#22c55e', aliases: [] },
  ambience: { category: 'instrument', color: '#22c55e', aliases: ['ambient', 'atmos', 'atmosphere'] },
  chord: { category: 'instrument', color: '#22c55e', aliases: ['chrd', 'stab'] },
  arp: { category: 'instrument', color: '#22c55e', aliases: ['arpeggio'] },
  bell: { category: 'instrument', color: '#22c55e', aliases: [] },
  marimba: { category: 'instrument', color: '#22c55e', aliases: ['vibes'] },
  cowbell: { category: 'instrument', color: '#22c55e', aliases: [] },
  conga: { category: 'instrument', color: '#22c55e', aliases: ['bongo'] },
  woodblock: { category: 'instrument', color: '#22c55e', aliases: ['timbales'] },
}

// ---------------------------------------------------------------------------
// Derived maps (built at module load)
// ---------------------------------------------------------------------------

export const ALIAS_TO_CANONICAL: Record<string, string> = {}
export const CANONICAL_TAGS = new Set<string>()

for (const [canonical, entry] of Object.entries(TAG_REGISTRY)) {
  CANONICAL_TAGS.add(canonical)
  for (const alias of entry.aliases) {
    ALIAS_TO_CANONICAL[alias] = canonical
  }
}

/**
 * Tag names managed by automated AI review/reanalysis (canonical + aliases).
 * Any other instrument tag is treated as user-custom and should be preserved.
 */
export const AI_MANAGED_INSTRUMENT_TAG_NAMES = Object.freeze(
  Array.from(new Set([...CANONICAL_TAGS, ...Object.keys(ALIAS_TO_CANONICAL)])).sort()
)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResolvedTag {
  canonical: string
  entry: TagRegistryEntry | null
  isKnown: boolean
}

export interface CongruentTagMatch {
  canonical: string
  matchType: 'exact' | 'partial'
}

/**
 * Resolve a raw tag string to its canonical form and registry entry.
 */
export function resolveTag(raw: string): ResolvedTag {
  const normalized = raw.trim().toLowerCase()
  if (!normalized) {
    return { canonical: normalized, entry: null, isKnown: false }
  }

  // Direct canonical match
  if (TAG_REGISTRY[normalized]) {
    return { canonical: normalized, entry: TAG_REGISTRY[normalized], isKnown: true }
  }

  // Alias match
  const aliasTarget = ALIAS_TO_CANONICAL[normalized]
  if (aliasTarget && TAG_REGISTRY[aliasTarget]) {
    return { canonical: aliasTarget, entry: TAG_REGISTRY[aliasTarget], isKnown: true }
  }

  return { canonical: normalized, entry: null, isKnown: false }
}

function tokenizeForCongruence(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 1)
}

function isAsciiLetter(char: string | undefined): boolean {
  return Boolean(char && /[a-z]/.test(char))
}

function hasBoundaryCongruence(token: string, term: string): boolean {
  let index = token.indexOf(term)
  while (index >= 0) {
    const before = index > 0 ? token[index - 1] : undefined
    const afterIndex = index + term.length
    const after = afterIndex < token.length ? token[afterIndex] : undefined
    const beforeBoundary = index === 0 || !isAsciiLetter(before)
    const afterBoundary = afterIndex === token.length || !isAsciiLetter(after)
    if (beforeBoundary || afterBoundary) return true
    index = token.indexOf(term, index + 1)
  }
  return false
}

const CONGRUENCE_TERMS: Array<{ term: string; canonical: string }> = (() => {
  const terms: Array<{ term: string; canonical: string }> = []
  const seenTerms = new Set<string>()

  for (const [canonical, entry] of Object.entries(TAG_REGISTRY)) {
    const candidates = [canonical, ...entry.aliases]
    for (const rawTerm of candidates) {
      const term = rawTerm.trim().toLowerCase()
      if (term.length < 3 || seenTerms.has(term)) continue
      seenTerms.add(term)
      terms.push({ term, canonical })
    }
  }

  return terms.sort((a, b) => b.term.length - a.term.length)
})()

/**
 * Match canonical tags from text using exact token matches first, then safe partial matches.
 */
export function findCongruentTagsInText(text: string): CongruentTagMatch[] {
  const tokens = tokenizeForCongruence(text)
  if (tokens.length === 0) return []

  const byCanonical = new Map<string, CongruentTagMatch['matchType']>()

  const setMatch = (canonical: string, matchType: CongruentTagMatch['matchType']) => {
    const existing = byCanonical.get(canonical)
    if (existing === 'exact') return
    if (existing === 'partial' && matchType === 'partial') return
    byCanonical.set(canonical, matchType)
  }

  for (const token of tokens) {
    const resolvedExact = resolveTag(token)
    if (resolvedExact.isKnown) {
      setMatch(resolvedExact.canonical, 'exact')
    }

    if (token.length < 3) continue

    for (const { term, canonical } of CONGRUENCE_TERMS) {
      if (term === token || !token.includes(term)) continue
      if (!hasBoundaryCongruence(token, term)) continue
      setMatch(canonical, 'partial')
    }
  }

  return Array.from(byCanonical.entries())
    .map(([canonical, matchType]) => ({ canonical, matchType }))
    .sort((a, b) => {
      if (a.matchType !== b.matchType) {
        return a.matchType === 'exact' ? -1 : 1
      }
      return a.canonical.localeCompare(b.canonical)
    })
}

/**
 * Check whether a tag name is a reducible dimension tag that should be suppressed.
 * With the tag cleanup, all non-instrument tags are now suppressed.
 */
export function isReducibleDimensionTag(tagName: string): boolean {
  const normalized = tagName.trim().toLowerCase()
  const resolved = resolveTag(normalized)
  // If it's a known instrument tag, it's not reducible
  if (resolved.isKnown) return false
  // Unknown tags are not reducible per se, but they'll be blocked by the review service
  return false
}

// ---------------------------------------------------------------------------
// Color scheme by category
// ---------------------------------------------------------------------------

const COLOR_BY_CATEGORY: Record<TagCategory, string> = {
  instrument: '#22c55e',
  filename: '#f472b6',
}

/**
 * Get tag metadata (color and category) from the registry, with fallback for unknown tags.
 */
export function getTagMetadataFromRegistry(
  tagName: string,
  preferredCategory?: TagCategory
): { color: string; category: TagCategory } {
  const resolved = resolveTag(tagName)

  if (resolved.entry) {
    return {
      color: resolved.entry.color,
      category: resolved.entry.category,
    }
  }

  // Unknown tag — use preferred category or default to instrument
  const category: TagCategory = preferredCategory ?? 'instrument'
  return {
    color: COLOR_BY_CATEGORY[category] || COLOR_BY_CATEGORY.instrument,
    category,
  }
}
