export type NameCaseMode = 'none' | 'lower' | 'upper' | 'title' | 'snake' | 'kebab'
export type NumberingPosition = 'prefix' | 'suffix'
export type ConversionTargetFormat = 'mp3' | 'wav' | 'flac' | 'aiff' | 'ogg' | 'm4a'

export interface BulkRenameRules {
  filterText: string
  searchText: string
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
  targetFormat: ConversionTargetFormat
}

export const DEFAULT_BULK_RENAME_RULES: BulkRenameRules = {
  filterText: '',
  searchText: '',
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
}

const WORD_SEGMENT_REGEX = /[A-Za-z0-9]+/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  if (searchText) {
    const flags = rules.caseSensitive ? 'g' : 'gi'
    const safeSearchPattern = new RegExp(escapeRegExp(searchText), flags)
    nextName = nextName.replace(safeSearchPattern, rules.replaceText)
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
