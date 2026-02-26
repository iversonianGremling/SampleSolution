export type NameCaseMode = 'none' | 'lower' | 'upper' | 'title' | 'snake' | 'kebab'
export type NumberingPosition = 'prefix' | 'suffix'
export type ConversionTargetFormat = 'mp3' | 'wav' | 'flac' | 'aiff' | 'ogg' | 'm4a'
export type ConversionTargetSelection = ConversionTargetFormat | 'keep'
export type ConversionTargetBitDepth = 16 | 24 | 32

export interface BulkRenameHighlightRange {
  start: number
  end: number
}

export interface BulkRenameRules {
  filterText: string
  searchText: string
  matchRegex: boolean
  replaceMatches: boolean
  replaceText: string
  caseSensitive: boolean
  prefix: string
  suffix: string
  caseMode: NameCaseMode
  numberingEnabled: boolean
  numberingStart: number
  numberingPad: number
  numberingSeparator: string
  numberingPosition: NumberingPosition
  conversionEnabled: boolean
  targetFormat: ConversionTargetSelection
  targetSampleRate: number | null
  targetBitDepth: ConversionTargetBitDepth | null
}

export const DEFAULT_BULK_RENAME_RULES: BulkRenameRules = {
  filterText: '',
  searchText: '',
  matchRegex: false,
  replaceMatches: true,
  replaceText: '',
  caseSensitive: false,
  prefix: '',
  suffix: '',
  caseMode: 'none',
  numberingEnabled: false,
  numberingStart: 1,
  numberingPad: 2,
  numberingSeparator: '-',
  numberingPosition: 'suffix',
  conversionEnabled: false,
  targetFormat: 'wav',
  targetSampleRate: null,
  targetBitDepth: null,
}

const WORD_SEGMENT_REGEX = /[A-Za-z0-9]+/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildSearchPattern(
  searchText: string,
  rules: Pick<BulkRenameRules, 'caseSensitive' | 'matchRegex'>,
  global: boolean,
): RegExp | null {
  const trimmedSearchText = searchText.trim()
  if (!trimmedSearchText) return null

  const source = rules.matchRegex ? trimmedSearchText : escapeRegExp(trimmedSearchText)
  const flags = rules.caseSensitive ? (global ? 'g' : '') : (global ? 'gi' : 'i')

  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

function toWords(value: string): string[] {
  const matches = value.match(WORD_SEGMENT_REGEX)
  return matches ? matches.filter(Boolean) : []
}

function toTitleCase(value: string): string {
  const words = toWords(value)
  if (words.length === 0) return value
  return words
    .map((word) => `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ')
}

function toSnakeCase(value: string): string {
  const words = toWords(value)
  if (words.length === 0) return value.trim()
  return words.map((word) => word.toLowerCase()).join('_')
}

function toKebabCase(value: string): string {
  const words = toWords(value)
  if (words.length === 0) return value.trim()
  return words.map((word) => word.toLowerCase()).join('-')
}

function applyCaseMode(value: string, caseMode: NameCaseMode): string {
  switch (caseMode) {
    case 'lower':
      return value.toLowerCase()
    case 'upper':
      return value.toUpperCase()
    case 'title':
      return toTitleCase(value)
    case 'snake':
      return toSnakeCase(value)
    case 'kebab':
      return toKebabCase(value)
    case 'none':
    default:
      return value
  }
}

function sanitizeNumberingValue(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.floor(value))
}

export function applyBulkRenameRules(originalName: string, rules: BulkRenameRules, index: number): string {
  let nextName = originalName

  const searchText = rules.searchText.trim()
  if (searchText && rules.replaceMatches) {
    const searchPattern = buildSearchPattern(searchText, rules, true)
    if (searchPattern) {
      nextName = nextName.replace(searchPattern, rules.replaceText)
    }
  }

  nextName = applyCaseMode(nextName, rules.caseMode)
  nextName = `${rules.prefix}${nextName}${rules.suffix}`
  nextName = nextName.replace(/\s+/g, ' ').trim()

  if (rules.numberingEnabled) {
    const start = sanitizeNumberingValue(rules.numberingStart)
    const pad = sanitizeNumberingValue(rules.numberingPad)
    const numberValue = String(start + index).padStart(pad, '0')
    const separator = rules.numberingSeparator ?? ''

    nextName = rules.numberingPosition === 'prefix'
      ? `${numberValue}${separator}${nextName}`
      : `${nextName}${separator}${numberValue}`
  }

  const trimmed = nextName.trim()
  return trimmed.length > 0 ? trimmed : originalName
}

export function matchesBulkRenameSearchText(
  sampleName: string,
  rules: Pick<BulkRenameRules, 'searchText' | 'caseSensitive' | 'matchRegex'>,
): boolean {
  const searchText = rules.searchText.trim()
  if (!searchText) return false

  const searchPattern = buildSearchPattern(searchText, rules, false)
  if (!searchPattern) return false
  return searchPattern.test(sampleName)
}

export function getBulkRenameReplacementHighlightRanges(
  nextName: string,
  rules: Pick<BulkRenameRules, 'searchText' | 'replaceText' | 'caseSensitive' | 'matchRegex' | 'replaceMatches'>,
): BulkRenameHighlightRange[] {
  const searchText = rules.searchText.trim()
  const replaceText = rules.replaceText
  if (!searchText || !rules.replaceMatches || replaceText.length === 0) return []
  if (!buildSearchPattern(searchText, rules, false)) return []

  const haystack = rules.caseSensitive ? nextName : nextName.toLowerCase()
  const needle = rules.caseSensitive ? replaceText : replaceText.toLowerCase()
  if (needle.length === 0) return []

  const ranges: BulkRenameHighlightRange[] = []
  let cursor = 0
  while (cursor < haystack.length) {
    const nextIndex = haystack.indexOf(needle, cursor)
    if (nextIndex < 0) break
    ranges.push({ start: nextIndex, end: nextIndex + replaceText.length })
    cursor = nextIndex + Math.max(1, replaceText.length)
  }

  return ranges
}

export function getBulkRenameRegexError(
  rules: Pick<BulkRenameRules, 'searchText' | 'matchRegex'>,
): string | null {
  const searchText = rules.searchText.trim()
  if (!rules.matchRegex || !searchText) return null

  try {
    new RegExp(searchText)
    return null
  } catch (error) {
    if (error instanceof Error && error.message.trim()) return error.message
    return 'Invalid regular expression'
  }
}
