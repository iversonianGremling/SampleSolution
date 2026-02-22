import type { Collection, Folder, SliceWithTrackExtended } from '../types'

export type FilterRuleFieldType = 'number' | 'text' | 'enum' | 'multi_enum'
export type FilterRuleJoin = 'AND' | 'OR'

export type FilterRuleNumberOperator = 'gt' | 'gte' | 'eq' | 'lte' | 'lt' | 'neq'
export type FilterRuleTextOperator = 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with'
export type FilterRuleEnumOperator = 'is' | 'is_not'
export type FilterRuleMultiEnumOperator = 'has' | 'not_has'
export type FilterRuleOperator =
  | FilterRuleNumberOperator
  | FilterRuleTextOperator
  | FilterRuleEnumOperator
  | FilterRuleMultiEnumOperator

export type FilterRuleFieldId =
  | 'bpm'
  | 'duration'
  | 'loudness'
  | 'brightness'
  | 'warmth'
  | 'hardness'
  | 'artist'
  | 'sample_name'
  | 'track_title'
  | 'instrument'
  | 'genre'
  | 'key'
  | 'source'
  | 'tag'
  | 'folder'
  | 'collection'

export interface FilterRule {
  id: string
  joinWithPrevious: FilterRuleJoin
  field: FilterRuleFieldId
  operator: FilterRuleOperator
  value: string
}

export interface FilterRuleFieldOption {
  id: FilterRuleFieldId
  label: string
  type: FilterRuleFieldType
  unit?: string
  min?: number
  max?: number
  step?: number
  fixedSuggestions?: string[]
}

interface FilterRuleFieldConfig extends FilterRuleFieldOption {
  getValue: (sample: SliceWithTrackExtended, context: FilterRuleEvaluationContext) => number | string | string[] | null
}

export interface FilterRuleEvaluationContext {
  foldersById?: Record<number, Folder>
  collectionsById?: Record<number, Collection>
}

export type FilterRuleSuggestionMap = Partial<Record<FilterRuleFieldId, string[]>>

const DEFAULT_NUMERIC_SUGGESTIONS: Record<FilterRuleFieldId, string[]> = {
  bpm: ['70', '80', '90', '100', '110', '120', '130', '140', '160'],
  duration: ['0.25', '0.5', '1', '2', '4', '8', '16', '30', '60'],
  loudness: ['-24', '-18', '-14', '-12', '-9', '-6', '-3'],
  brightness: ['0', '0.25', '0.5', '0.75', '1'],
  warmth: ['0', '0.25', '0.5', '0.75', '1'],
  hardness: ['0', '0.25', '0.5', '0.75', '1'],
  artist: [],
  sample_name: [],
  track_title: [],
  instrument: [],
  genre: [],
  key: [],
  source: ['local', 'youtube'],
  tag: [],
  folder: [],
  collection: [],
}

function normalizeSource(sample: SliceWithTrackExtended): string {
  if (sample.track.source === 'youtube') return 'youtube'
  if (sample.track.source === 'local') return 'local'
  if (sample.track.youtubeId) return 'youtube'
  return 'local'
}

function getFolderNames(sample: SliceWithTrackExtended, context: FilterRuleEvaluationContext): string[] {
  const byId = context.foldersById || {}
  const names = (sample.folderIds || [])
    .map((id) => byId[id]?.name)
    .filter((value): value is string => Boolean(value && value.trim()))
  return Array.from(new Set(names))
}

function getCollectionNames(sample: SliceWithTrackExtended, context: FilterRuleEvaluationContext): string[] {
  const foldersById = context.foldersById || {}
  const collectionsById = context.collectionsById || {}
  const names = (sample.folderIds || [])
    .map((folderId) => foldersById[folderId]?.collectionId ?? null)
    .map((collectionId) => {
      if (collectionId === null) return 'Ungrouped'
      return collectionsById[collectionId]?.name || null
    })
    .filter((value): value is string => Boolean(value && value.trim()))
  return Array.from(new Set(names))
}

function getTagNames(sample: SliceWithTrackExtended): string[] {
  const names = (sample.tags || [])
    .map((tag) => tag.name)
    .filter((value): value is string => Boolean(value && value.trim()))
  return Array.from(new Set(names))
}

const FILTER_RULE_FIELD_CONFIGS: FilterRuleFieldConfig[] = [
  {
    id: 'bpm',
    label: 'BPM',
    type: 'number',
    unit: 'BPM',
    min: 0,
    max: 300,
    step: 0.1,
    getValue: (sample) => sample.bpm ?? null,
  },
  {
    id: 'duration',
    label: 'Duration',
    type: 'number',
    unit: 'sec',
    min: 0,
    max: 600,
    step: 0.1,
    getValue: (sample) => Math.max(0, sample.endTime - sample.startTime),
  },
  {
    id: 'loudness',
    label: 'Loudness',
    type: 'number',
    unit: 'dB',
    min: -80,
    max: 12,
    step: 0.1,
    getValue: (sample) => sample.loudness ?? null,
  },
  {
    id: 'brightness',
    label: 'Brightness',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    getValue: (sample) => sample.brightness ?? null,
  },
  {
    id: 'warmth',
    label: 'Warmth',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    getValue: (sample) => sample.warmth ?? null,
  },
  {
    id: 'hardness',
    label: 'Hardness',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    getValue: (sample) => sample.hardness ?? null,
  },
  {
    id: 'artist',
    label: 'Artist',
    type: 'text',
    getValue: (sample) => sample.track.artist || '',
  },
  {
    id: 'sample_name',
    label: 'Sample Name',
    type: 'text',
    getValue: (sample) => sample.name || '',
  },
  {
    id: 'track_title',
    label: 'Track Title',
    type: 'text',
    getValue: (sample) => sample.track.title || '',
  },
  {
    id: 'instrument',
    label: 'Instrument',
    type: 'text',
    getValue: (sample) => sample.instrumentType || sample.instrumentPrimary || '',
  },
  {
    id: 'genre',
    label: 'Genre',
    type: 'text',
    getValue: (sample) => sample.genrePrimary || '',
  },
  {
    id: 'key',
    label: 'Key',
    type: 'text',
    getValue: (sample) => sample.keyEstimate || '',
  },
  {
    id: 'source',
    label: 'Source',
    type: 'enum',
    fixedSuggestions: ['local', 'youtube'],
    getValue: (sample) => normalizeSource(sample),
  },
  {
    id: 'tag',
    label: 'Tag',
    type: 'multi_enum',
    getValue: (sample) => getTagNames(sample),
  },
  {
    id: 'folder',
    label: 'Folder',
    type: 'multi_enum',
    getValue: (sample, context) => getFolderNames(sample, context),
  },
  {
    id: 'collection',
    label: 'Collection',
    type: 'multi_enum',
    getValue: (sample, context) => getCollectionNames(sample, context),
  },
]

const FIELD_BY_ID = new Map(FILTER_RULE_FIELD_CONFIGS.map((field) => [field.id, field]))

export const FILTER_RULE_FIELDS: FilterRuleFieldOption[] = FILTER_RULE_FIELD_CONFIGS.map((field) => ({
  id: field.id,
  label: field.label,
  type: field.type,
  unit: field.unit,
  min: field.min,
  max: field.max,
  step: field.step,
  fixedSuggestions: field.fixedSuggestions,
}))

export const FILTER_RULE_NUMERIC_OPERATORS: Array<{ id: FilterRuleNumberOperator; label: string }> = [
  { id: 'gt', label: '>' },
  { id: 'gte', label: '>=' },
  { id: 'eq', label: '=' },
  { id: 'lte', label: '<=' },
  { id: 'lt', label: '<' },
  { id: 'neq', label: '!=' },
]

export const FILTER_RULE_TEXT_OPERATORS: Array<{ id: FilterRuleTextOperator; label: string }> = [
  { id: 'contains', label: 'contains' },
  { id: 'not_contains', label: 'does not contain' },
  { id: 'equals', label: 'equals' },
  { id: 'not_equals', label: 'does not equal' },
  { id: 'starts_with', label: 'starts with' },
  { id: 'ends_with', label: 'ends with' },
]

export const FILTER_RULE_ENUM_OPERATORS: Array<{ id: FilterRuleEnumOperator; label: string }> = [
  { id: 'is', label: 'is' },
  { id: 'is_not', label: 'is not' },
]

export const FILTER_RULE_MULTI_ENUM_OPERATORS: Array<{ id: FilterRuleMultiEnumOperator; label: string }> = [
  { id: 'has', label: 'includes' },
  { id: 'not_has', label: 'does not include' },
]

const NUMERIC_OPERATOR_IDS = new Set(FILTER_RULE_NUMERIC_OPERATORS.map((operator) => operator.id))
const TEXT_OPERATOR_IDS = new Set(FILTER_RULE_TEXT_OPERATORS.map((operator) => operator.id))
const ENUM_OPERATOR_IDS = new Set(FILTER_RULE_ENUM_OPERATORS.map((operator) => operator.id))
const MULTI_ENUM_OPERATOR_IDS = new Set(FILTER_RULE_MULTI_ENUM_OPERATORS.map((operator) => operator.id))

export function getFilterRuleField(fieldId: FilterRuleFieldId): FilterRuleFieldOption {
  const field = FIELD_BY_ID.get(fieldId) || FILTER_RULE_FIELD_CONFIGS[0]
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    unit: field.unit,
    min: field.min,
    max: field.max,
    step: field.step,
    fixedSuggestions: field.fixedSuggestions,
  }
}

function getFilterRuleFieldConfig(fieldId: FilterRuleFieldId): FilterRuleFieldConfig {
  return FIELD_BY_ID.get(fieldId) || FILTER_RULE_FIELD_CONFIGS[0]
}

export function isFilterRuleNumericField(fieldId: FilterRuleFieldId): boolean {
  return getFilterRuleFieldConfig(fieldId).type === 'number'
}

export function getFilterRuleOperators(fieldId: FilterRuleFieldId): Array<{ id: FilterRuleOperator; label: string }> {
  const field = getFilterRuleFieldConfig(fieldId)
  if (field.type === 'number') return FILTER_RULE_NUMERIC_OPERATORS
  if (field.type === 'enum') return FILTER_RULE_ENUM_OPERATORS
  if (field.type === 'multi_enum') return FILTER_RULE_MULTI_ENUM_OPERATORS
  return FILTER_RULE_TEXT_OPERATORS
}

export function getDefaultOperatorForField(fieldId: FilterRuleFieldId): FilterRuleOperator {
  return getFilterRuleOperators(fieldId)[0].id
}

export function normalizeOperatorForField(fieldId: FilterRuleFieldId, operator: FilterRuleOperator): FilterRuleOperator {
  const field = getFilterRuleFieldConfig(fieldId)

  if (field.type === 'number' && NUMERIC_OPERATOR_IDS.has(operator as FilterRuleNumberOperator)) return operator
  if (field.type === 'text' && TEXT_OPERATOR_IDS.has(operator as FilterRuleTextOperator)) return operator
  if (field.type === 'enum' && ENUM_OPERATOR_IDS.has(operator as FilterRuleEnumOperator)) return operator
  if (field.type === 'multi_enum' && MULTI_ENUM_OPERATOR_IDS.has(operator as FilterRuleMultiEnumOperator)) return operator

  return getDefaultOperatorForField(fieldId)
}

export function createDefaultFilterRule(index: number): FilterRule {
  const defaultField = FILTER_RULE_FIELDS[0]
  return {
    id: `rule-${Date.now()}-${index}`,
    joinWithPrevious: 'AND',
    field: defaultField.id,
    operator: getDefaultOperatorForField(defaultField.id),
    value: '',
  }
}

export function buildFilterRuleEvaluationContext(folders: Folder[], collections: Collection[]): FilterRuleEvaluationContext {
  const foldersById: Record<number, Folder> = {}
  const collectionsById: Record<number, Collection> = {}

  for (const folder of folders) {
    foldersById[folder.id] = folder
  }
  for (const collection of collections) {
    collectionsById[collection.id] = collection
  }

  return { foldersById, collectionsById }
}

function dedupeValues(values: string[], limit = 120): string[] {
  const unique = Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  )
  unique.sort((a, b) => a.localeCompare(b))
  return unique.slice(0, limit)
}

export function getFilterRuleSuggestions(fieldId: FilterRuleFieldId, dynamicSuggestions: string[] = []): string[] {
  const field = getFilterRuleField(fieldId)
  const base = DEFAULT_NUMERIC_SUGGESTIONS[fieldId] || []
  const fixed = field.fixedSuggestions || []
  const rangeAnchors: string[] = []

  if (typeof field.min === 'number') rangeAnchors.push(String(field.min))
  if (typeof field.max === 'number') rangeAnchors.push(String(field.max))

  return dedupeValues([...fixed, ...base, ...rangeAnchors, ...dynamicSuggestions])
}

export function getFilterRuleRangeLabel(fieldId: FilterRuleFieldId): string | null {
  const field = getFilterRuleField(fieldId)
  if (field.type !== 'number') return null
  if (typeof field.min !== 'number' && typeof field.max !== 'number') return null

  const min = typeof field.min === 'number' ? field.min : '-∞'
  const max = typeof field.max === 'number' ? field.max : '∞'
  const unit = field.unit ? ` ${field.unit}` : ''
  return `Range: ${min} to ${max}${unit}`
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function parseQueryTerms(value: string): string[] {
  return value
    .split(',')
    .map((term) => normalizeText(term))
    .filter((term) => term.length > 0)
}

function evaluateNumericRule(sampleValue: number, operator: FilterRuleNumberOperator, queryValue: number): boolean {
  if (operator === 'gt') return sampleValue > queryValue
  if (operator === 'gte') return sampleValue >= queryValue
  if (operator === 'eq') return sampleValue === queryValue
  if (operator === 'lte') return sampleValue <= queryValue
  if (operator === 'lt') return sampleValue < queryValue
  return sampleValue !== queryValue
}

function evaluateTextRule(sampleValue: string, operator: FilterRuleTextOperator, queryValue: string): boolean {
  const sampleText = normalizeText(sampleValue)
  const queryText = normalizeText(queryValue)

  if (operator === 'contains') return sampleText.includes(queryText)
  if (operator === 'not_contains') return !sampleText.includes(queryText)
  if (operator === 'equals') return sampleText === queryText
  if (operator === 'not_equals') return sampleText !== queryText
  if (operator === 'starts_with') return sampleText.startsWith(queryText)
  return sampleText.endsWith(queryText)
}

function evaluateEnumRule(sampleValue: string, operator: FilterRuleEnumOperator, queryValue: string): boolean {
  const normalizedSample = normalizeText(sampleValue)
  const normalizedQuery = normalizeText(queryValue)
  if (operator === 'is') return normalizedSample === normalizedQuery
  return normalizedSample !== normalizedQuery
}

function evaluateMultiEnumRule(sampleValues: string[], operator: FilterRuleMultiEnumOperator, queryValue: string): boolean {
  const normalizedSampleValues = new Set(sampleValues.map((value) => normalizeText(value)))
  const queryTerms = parseQueryTerms(queryValue)
  if (queryTerms.length === 0) return true

  if (operator === 'has') {
    return queryTerms.every((term) => normalizedSampleValues.has(term))
  }
  return queryTerms.every((term) => !normalizedSampleValues.has(term))
}

export function evaluateFilterRule(
  sample: SliceWithTrackExtended,
  rule: FilterRule,
  context: FilterRuleEvaluationContext = {}
): boolean {
  const field = getFilterRuleFieldConfig(rule.field)
  const rawQueryValue = rule.value.trim()

  if (!rawQueryValue) return true

  if (field.type === 'number') {
    const numericValue = Number.parseFloat(rawQueryValue)
    if (!Number.isFinite(numericValue)) return true
    const sampleValue = field.getValue(sample, context)
    if (typeof sampleValue !== 'number' || !Number.isFinite(sampleValue)) return false
    return evaluateNumericRule(
      sampleValue,
      normalizeOperatorForField(rule.field, rule.operator) as FilterRuleNumberOperator,
      numericValue
    )
  }

  if (field.type === 'text') {
    const sampleValue = field.getValue(sample, context)
    const sampleText = typeof sampleValue === 'string' ? sampleValue : ''
    return evaluateTextRule(
      sampleText,
      normalizeOperatorForField(rule.field, rule.operator) as FilterRuleTextOperator,
      rawQueryValue
    )
  }

  if (field.type === 'enum') {
    const sampleValue = field.getValue(sample, context)
    const sampleText = typeof sampleValue === 'string' ? sampleValue : ''
    return evaluateEnumRule(
      sampleText,
      normalizeOperatorForField(rule.field, rule.operator) as FilterRuleEnumOperator,
      rawQueryValue
    )
  }

  const sampleValue = field.getValue(sample, context)
  const sampleValues = Array.isArray(sampleValue)
    ? sampleValue.filter((value): value is string => typeof value === 'string')
    : typeof sampleValue === 'string'
      ? [sampleValue]
      : []

  return evaluateMultiEnumRule(
    sampleValues,
    normalizeOperatorForField(rule.field, rule.operator) as FilterRuleMultiEnumOperator,
    rawQueryValue
  )
}

export function matchesFilterRuleQuery(
  sample: SliceWithTrackExtended,
  rules: FilterRule[],
  context: FilterRuleEvaluationContext = {}
): boolean {
  if (!rules.length) return true

  const activeRules = rules.filter((rule) => rule.value.trim().length > 0)
  if (activeRules.length === 0) return true

  // Evaluate as AND groups separated by OR.
  // Example: A AND B OR C AND D => (A && B) || (C && D)
  let currentAndGroup = true
  let hasCurrentAndGroup = false
  const orGroups: boolean[] = []

  for (let index = 0; index < activeRules.length; index++) {
    const rule = activeRules[index]
    const result = evaluateFilterRule(sample, rule, context)

    if (index === 0 || rule.joinWithPrevious === 'OR') {
      if (hasCurrentAndGroup) {
        orGroups.push(currentAndGroup)
      }
      currentAndGroup = result
      hasCurrentAndGroup = true
      continue
    }

    currentAndGroup = currentAndGroup && result
    hasCurrentAndGroup = true
  }

  if (hasCurrentAndGroup) {
    orGroups.push(currentAndGroup)
  }

  return orGroups.some(Boolean)
}
