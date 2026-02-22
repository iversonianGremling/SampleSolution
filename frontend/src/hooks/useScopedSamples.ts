import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import * as api from '../api/client'
import type { SourceScope, SourcesSamplesResponse } from '../types'

function scopeToString(scope: SourceScope): string {
  switch (scope.type) {
    case 'all':
      return 'all'
    case 'youtube':
      return 'youtube'
    case 'youtube-video':
      return `youtube:${scope.trackId}`
    case 'local':
      return 'local'
    case 'folder':
      return `folder:${scope.path}`
    case 'library':
      return `library:${scope.libraryId}`
    case 'my-folder':
      return `my-folder:${scope.folderId}`
    case 'collection':
      return `collection:${scope.collectionId}`
    default:
      return 'all'
  }
}

export interface AudioFilterParams {
  sortBy?:
    | 'artist'
    | 'album'
    | 'year'
    | 'albumArtist'
    | 'genre'
    | 'composer'
    | 'trackNumber'
    | 'discNumber'
    | 'tagBpm'
    | 'musicalKey'
    | 'isrc'
    | 'bpm'
    | 'key'
    | 'note'
    | 'name'
    | 'duration'
    | 'createdAt'
    | 'similarity'
  sortOrder?: 'asc' | 'desc'
  minBpm?: number
  maxBpm?: number
  keys?: string[]
  notes?: string[]
  dateAddedFrom?: string
  dateAddedTo?: string
  dateCreatedFrom?: string
  dateCreatedTo?: string
  dateUpdatedFrom?: string
  dateUpdatedTo?: string
  similarTo?: number
  minSimilarity?: number
  brightnessMin?: number
  brightnessMax?: number
  harmonicityMin?: number
  harmonicityMax?: number
  noisinessMin?: number
  noisinessMax?: number
  attackMin?: number
  attackMax?: number
  dynamicsMin?: number
  dynamicsMax?: number
  saturationMin?: number
  saturationMax?: number
  surfaceMin?: number
  surfaceMax?: number
  densityMin?: number
  densityMax?: number
  ambienceMin?: number
  ambienceMax?: number
  stereoWidthMin?: number
  stereoWidthMax?: number
  depthMin?: number
  depthMax?: number
}

export function useScopedSamples(
  scope: SourceScope,
  tags: number[],
  search: string,
  favorites?: boolean,
  audioFilters?: AudioFilterParams
): UseQueryResult<SourcesSamplesResponse, Error>
export function useScopedSamples(
  scope: SourceScope,
  search: string,
  favorites?: boolean,
  audioFilters?: AudioFilterParams
): UseQueryResult<SourcesSamplesResponse, Error>
export function useScopedSamples(
  scope: SourceScope,
  tagsOrSearch: number[] | string,
  searchOrFavorites: string | boolean = '',
  favoritesOrAudioFilters: boolean | AudioFilterParams = false,
  maybeAudioFilters?: AudioFilterParams
): UseQueryResult<SourcesSamplesResponse, Error> {
  const usesLegacySignature = Array.isArray(tagsOrSearch)
  const tags = usesLegacySignature ? tagsOrSearch : []
  const search = usesLegacySignature
    ? (typeof searchOrFavorites === 'string' ? searchOrFavorites : '')
    : tagsOrSearch
  const favorites = usesLegacySignature
    ? (typeof favoritesOrAudioFilters === 'boolean' ? favoritesOrAudioFilters : false)
    : (typeof searchOrFavorites === 'boolean' ? searchOrFavorites : false)
  const audioFilters = usesLegacySignature
    ? (typeof favoritesOrAudioFilters === 'object' ? favoritesOrAudioFilters : maybeAudioFilters)
    : (typeof favoritesOrAudioFilters === 'object' ? favoritesOrAudioFilters : maybeAudioFilters)

  // Some backend deployments don't correctly handle scoped my-folder/collection queries.
  // For those scopes, fetch from "all" and let the UI apply precise folder-based filtering.
  const scopeString =
    scope.type === 'my-folder' || scope.type === 'collection'
      ? 'all'
      : scopeToString(scope)

  return useQuery({
    queryKey: ['scopedSamples', scopeString, tags, search, favorites, audioFilters],
    queryFn: () =>
      api.getSourcesSamples({
        scope: scopeString,
        tags: tags.length > 0 ? tags : undefined,
        search: search.trim() || undefined,
        favorites: favorites || undefined,
        sortBy: audioFilters?.sortBy,
        sortOrder: audioFilters?.sortOrder,
        minBpm: audioFilters?.minBpm,
        maxBpm: audioFilters?.maxBpm,
        keys: audioFilters?.keys,
        notes: audioFilters?.notes,
        dateAddedFrom: audioFilters?.dateAddedFrom,
        dateAddedTo: audioFilters?.dateAddedTo,
        dateCreatedFrom: audioFilters?.dateCreatedFrom,
        dateCreatedTo: audioFilters?.dateCreatedTo,
        dateUpdatedFrom: audioFilters?.dateUpdatedFrom,
        dateUpdatedTo: audioFilters?.dateUpdatedTo,
        similarTo: audioFilters?.similarTo,
        minSimilarity: audioFilters?.minSimilarity,
        brightnessMin: audioFilters?.brightnessMin,
        brightnessMax: audioFilters?.brightnessMax,
        harmonicityMin: audioFilters?.harmonicityMin,
        harmonicityMax: audioFilters?.harmonicityMax,
        noisinessMin: audioFilters?.noisinessMin,
        noisinessMax: audioFilters?.noisinessMax,
        attackMin: audioFilters?.attackMin,
        attackMax: audioFilters?.attackMax,
        dynamicsMin: audioFilters?.dynamicsMin,
        dynamicsMax: audioFilters?.dynamicsMax,
        saturationMin: audioFilters?.saturationMin,
        saturationMax: audioFilters?.saturationMax,
        surfaceMin: audioFilters?.surfaceMin,
        surfaceMax: audioFilters?.surfaceMax,
        densityMin: audioFilters?.densityMin,
        densityMax: audioFilters?.densityMax,
        ambienceMin: audioFilters?.ambienceMin,
        ambienceMax: audioFilters?.ambienceMax,
        stereoWidthMin: audioFilters?.stereoWidthMin,
        stereoWidthMax: audioFilters?.stereoWidthMax,
        depthMin: audioFilters?.depthMin,
        depthMax: audioFilters?.depthMax,
      }),
  })
}

export function useInvalidateScopedSamples() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
    queryClient.invalidateQueries({ queryKey: ['sourceTree'] })
  }
}
