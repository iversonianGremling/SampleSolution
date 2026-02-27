import type { Collection, Folder, SliceWithTrackExtended } from '../types'

export type SampleSearchScope = 'all' | 'name' | 'tags' | 'custom' | 'artists' | 'collections'

export type SampleSearchCustomField =
  | 'sample_name'
  | 'track_title'
  | 'tags'
  | 'artist'
  | 'album'
  | 'album_artist'
  | 'genre'
  | 'composer'
  | 'collection'
  | 'path'

export const SAMPLE_SEARCH_SCOPE_OPTIONS: Array<{ value: SampleSearchScope; label: string }> = [
  { value: 'all', label: 'All fields' },
  { value: 'name', label: 'Name + title' },
  { value: 'tags', label: 'Instruments' },
  { value: 'custom', label: 'Custom' },
]

export const SAMPLE_SEARCH_CUSTOM_FIELD_OPTIONS: Array<{ value: SampleSearchCustomField; label: string }> = [
  { value: 'sample_name', label: 'Sample name' },
  { value: 'track_title', label: 'Track title' },
  { value: 'tags', label: 'Instruments' },
  { value: 'artist', label: 'Artist' },
  { value: 'album', label: 'Album' },
  { value: 'album_artist', label: 'Album artist' },
  { value: 'genre', label: 'Genre' },
  { value: 'composer', label: 'Composer' },
  { value: 'collection', label: 'Collection' },
  { value: 'path', label: 'Path' },
]

const CUSTOM_FIELD_LABELS = new Map<SampleSearchCustomField, string>(
  SAMPLE_SEARCH_CUSTOM_FIELD_OPTIONS.map((option) => [option.value, option.label]),
)

export const DEFAULT_SAMPLE_SEARCH_CUSTOM_FIELDS: SampleSearchCustomField[] = [
  'sample_name',
  'tags',
  'path',
]

interface SampleSearchContext {
  folderCollectionNameById?: Map<number, string>
  fallbackCollectionName?: string | null
  customFields?: SampleSearchCustomField[]
}

export function buildFolderCollectionNameMap(
  folders: Folder[],
  collections: Collection[],
): Map<number, string> {
  const collectionNameById = new Map<number, string>(
    collections.map((collection) => [collection.id, collection.name]),
  )
  const folderCollectionNameById = new Map<number, string>()

  for (const folder of folders) {
    if (folder.collectionId == null) continue
    const collectionName = collectionNameById.get(folder.collectionId)
    if (collectionName) {
      folderCollectionNameById.set(folder.id, collectionName)
    }
  }

  return folderCollectionNameById
}

export function normalizeSampleSearchTerm(query: string): string {
  return query.trim().toLowerCase()
}

function normalizeCustomFields(fields?: SampleSearchCustomField[]): SampleSearchCustomField[] {
  if (!fields || fields.length === 0) return []
  const seen = new Set<SampleSearchCustomField>()
  const normalized: SampleSearchCustomField[] = []
  for (const field of fields) {
    if (seen.has(field)) continue
    seen.add(field)
    normalized.push(field)
  }
  return normalized
}

function formatCustomFieldLabelList(fields?: SampleSearchCustomField[]): string {
  const normalizedFields = normalizeCustomFields(fields)
  if (normalizedFields.length === 0) return ''
  return normalizedFields
    .map((field) => CUSTOM_FIELD_LABELS.get(field) || field)
    .join(', ')
}

function getSamplePathCandidates(sample: SliceWithTrackExtended): string[] {
  return [
    sample.pathDisplay,
    sample.filePath,
    sample.track.relativePath,
    sample.track.originalPath,
    sample.track.fullPathHint,
    sample.track.folderPath,
  ].filter((value): value is string => Boolean(value && value.trim()))
}

function matchesPath(sample: SliceWithTrackExtended, term: string): boolean {
  return getSamplePathCandidates(sample).some((value) => includesTerm(value, term))
}

export function getSampleSearchScopeDescriptor(
  scope: SampleSearchScope,
  customFields: SampleSearchCustomField[] = [],
): string {
  const selectedCustomFieldCount = normalizeCustomFields(customFields).length
  switch (scope) {
    case 'name':
      return 'sample names and track titles'
    case 'tags':
      return 'instruments'
    case 'custom':
      return selectedCustomFieldCount > 0
        ? `${selectedCustomFieldCount} custom field${selectedCustomFieldCount === 1 ? '' : 's'}`
        : 'custom fields'
    case 'artists':
      return 'artist metadata'
    case 'collections':
      return 'collection names'
    case 'all':
    default:
      return 'all fields'
  }
}

export function getSampleSearchScopeHint(
  scope: SampleSearchScope,
  customFields: SampleSearchCustomField[] = [],
): string {
  switch (scope) {
    case 'name':
      return 'Only matches sample names and track titles.'
    case 'tags':
      return 'Only matches instrument names.'
    case 'custom': {
      const selectedFieldsLabel = formatCustomFieldLabelList(customFields)
      if (!selectedFieldsLabel) {
        return 'Select one or more text columns to enable custom search.'
      }
      return `Only matches selected text columns: ${selectedFieldsLabel}.`
    }
    case 'artists':
      return 'Only matches artist metadata.'
    case 'collections':
      return 'Only matches collection names linked by folder.'
    case 'all':
    default:
      return 'Matches names, instruments, artist metadata, and collection names.'
  }
}

function includesTerm(value: string | null | undefined, term: string): boolean {
  if (!value) return false
  return value.toLowerCase().includes(term)
}

function matchesCollection(
  sample: SliceWithTrackExtended,
  term: string,
  context: SampleSearchContext,
): boolean {
  let hadMappedCollection = false

  for (const folderId of sample.folderIds ?? []) {
    const collectionName = context.folderCollectionNameById?.get(folderId)
    if (!collectionName) continue
    hadMappedCollection = true
    if (includesTerm(collectionName, term)) {
      return true
    }
  }

  if (!hadMappedCollection && includesTerm(context.fallbackCollectionName, term)) {
    return true
  }

  return false
}

function matchesCustomField(
  sample: SliceWithTrackExtended,
  term: string,
  field: SampleSearchCustomField,
  context: SampleSearchContext,
): boolean {
  switch (field) {
    case 'sample_name':
      return includesTerm(sample.name, term)
    case 'track_title':
      return includesTerm(sample.track.title, term)
    case 'tags':
      return sample.tags?.some((tag) => includesTerm(tag.name, term)) ?? false
    case 'artist':
      return includesTerm(sample.track.artist, term)
    case 'album':
      return includesTerm(sample.track.album, term)
    case 'album_artist':
      return includesTerm(sample.track.albumArtist, term)
    case 'genre':
      return includesTerm(sample.track.genre, term) || includesTerm(sample.genrePrimary, term)
    case 'composer':
      return includesTerm(sample.track.composer, term)
    case 'collection':
      return matchesCollection(sample, term, context)
    case 'path':
      return matchesPath(sample, term)
    default:
      return false
  }
}

export function matchesSampleSearchTerm(
  sample: SliceWithTrackExtended,
  normalizedSearchTerm: string,
  scope: SampleSearchScope,
  context: SampleSearchContext = {},
): boolean {
  if (!normalizedSearchTerm) return true

  const matchesName =
    includesTerm(sample.name, normalizedSearchTerm) ||
    includesTerm(sample.track.title, normalizedSearchTerm)
  const matchesTags =
    sample.tags?.some((tag) => includesTerm(tag.name, normalizedSearchTerm)) ?? false
  const matchesArtist = includesTerm(sample.track.artist, normalizedSearchTerm)
  const matchesAlbum = includesTerm(sample.track.album, normalizedSearchTerm)
  const matchesAlbumArtist = includesTerm(sample.track.albumArtist, normalizedSearchTerm)
  const matchesGenre =
    includesTerm(sample.track.genre, normalizedSearchTerm) ||
    includesTerm(sample.genrePrimary, normalizedSearchTerm)
  const matchesComposer = includesTerm(sample.track.composer, normalizedSearchTerm)
  const matchesCollectionName = matchesCollection(sample, normalizedSearchTerm, context)
  const effectiveCustomFields = normalizeCustomFields(
    context.customFields?.length ? context.customFields : DEFAULT_SAMPLE_SEARCH_CUSTOM_FIELDS,
  )
  const matchesCustom = effectiveCustomFields.some((field) =>
    matchesCustomField(sample, normalizedSearchTerm, field, context),
  )

  switch (scope) {
    case 'name':
      return matchesName
    case 'tags':
      return matchesTags
    case 'custom':
      return matchesCustom
    case 'artists':
      return matchesArtist
    case 'collections':
      return matchesCollectionName
    case 'all':
    default:
      return (
        matchesName ||
        matchesTags ||
        matchesArtist ||
        matchesAlbum ||
        matchesAlbumArtist ||
        matchesGenre ||
        matchesComposer ||
        matchesCollectionName
      )
  }
}
