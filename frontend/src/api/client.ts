import axios from 'axios'
import type {
  Track,
  Slice,
  SliceWithTrack,
  Tag,
  YouTubeSearchResult,
  YouTubePlaylist,
  AuthStatus,
  ImportResult,
  Folder,
  Collection,
  FacetGroup,
  SplitResult,
  ExportResult,
  AudioFeatures,
  SourceTree,
  SourcesSamplesResponse,
  SyncConfig,
} from '../types'
import { getApiBaseUrl } from '../utils/api-config'

const api = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
})

type HierarchyApiMode = 'modern' | 'legacy'
let hierarchyApiModePromise: Promise<HierarchyApiMode> | null = null

async function getHierarchyApiMode(): Promise<HierarchyApiMode> {
  if (hierarchyApiModePromise) return hierarchyApiModePromise

  hierarchyApiModePromise = (async () => {
    try {
      const { data } = await api.get<Array<{ id: number }>>('/perspectives')
      if (Array.isArray(data)) return 'legacy'
      return 'modern'
    } catch {
      return 'modern'
    }
  })()

  return hierarchyApiModePromise
}

function mapLegacyPerspectiveToCollection(p: any): Collection {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    sortOrder: p.sortOrder ?? 0,
    folderCount: p.collectionCount ?? 0,
    createdAt: p.createdAt,
  }
}

function mapLegacyCollectionToFolder(c: any): Folder {
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    parentId: c.parentId ?? null,
    collectionId: c.perspectiveId ?? null,
    sliceCount: c.sliceCount ?? 0,
    createdAt: c.createdAt,
  }
}

// Interceptor to handle FormData properly
api.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    // Let the browser set the Content-Type with boundary for FormData
    delete config.headers['Content-Type']
  }
  return config
})

// Tracks
export const getTracks = () => api.get<Track[]>('/tracks').then((r) => r.data)

export const addTracks = (urls: string[]) =>
  api.post<ImportResult>('/tracks', { urls }).then((r) => r.data)

export const deleteTrack = (id: number) => api.delete(`/tracks/${id}`)

export const updateTrack = (id: number, data: { title?: string; artist?: string; album?: string; year?: number | null }) =>
  api.put<Track>(`/tracks/${id}`, data).then((r) => r.data)

export const getTrackAudioUrl = (id: number) => `${getApiBaseUrl()}/tracks/${id}/audio`

export const getTrackPeaks = (id: number) =>
  api.get<number[]>(`/tracks/${id}/peaks`).then((r) => r.data)

// Slices
export const getAllSlices = () =>
  api.get<SliceWithTrack[]>('/slices').then((r) => r.data)

export const getSlices = (trackId: number) =>
  api.get<Slice[]>(`/tracks/${trackId}/slices`).then((r) => r.data)

export const createSlice = (
  trackId: number,
  data: { name: string; startTime: number; endTime: number }
) => api.post<Slice>(`/tracks/${trackId}/slices`, data).then((r) => r.data)

export const updateSlice = (
  id: number,
  data: { name?: string; startTime?: number; endTime?: number }
) => api.put<Slice>(`/slices/${id}`, data).then((r) => r.data)

export const deleteSlice = (id: number, deleteSource = false) =>
  api.delete(`/slices/${id}`, { params: { deleteSource } }).then((r) => r.data)

export const getSliceDownloadUrl = (id: number) => `${getApiBaseUrl()}/slices/${id}/download`

export interface PersistLabRenderPayload {
  mode: 'copy' | 'overwrite'
  fileName: string
  duration: number
  hqPitchRequested?: boolean
  audioBlob: Blob
}

export interface PersistLabRenderResponse {
  mode: 'copy' | 'overwrite'
  sourceSliceId: number
  slice: Slice
  createdTrack?: Track
  hqPitchRequested?: boolean
}

export const persistLabRender = (sliceId: number, payload: PersistLabRenderPayload) => {
  const formData = new FormData()
  formData.append('mode', payload.mode)
  formData.append('fileName', payload.fileName)

  if (Number.isFinite(payload.duration)) {
    formData.append('duration', payload.duration.toString())
  }

  if (payload.hqPitchRequested !== undefined) {
    formData.append('hqPitchRequested', payload.hqPitchRequested ? 'true' : 'false')
  }

  formData.append('audio', payload.audioBlob, payload.fileName || 'lab-render.wav')

  return api
    .post<PersistLabRenderResponse>(`/slices/${sliceId}/render`, formData)
    .then((r) => r.data)
}

export const downloadBatchSlicesZip = (sliceIds: number[]) =>
  api
    .post<Blob>(
      '/slices/batch-download',
      { sliceIds },
      {
        responseType: 'blob',
      }
    )
    .then((r) => ({
      blob: r.data,
      contentDisposition: r.headers['content-disposition'] as string | undefined,
    }))

// YouTube
export const searchYouTube = (query: string) =>
  api
    .get<YouTubeSearchResult[]>('/youtube/search', { params: { q: query } })
    .then((r) => r.data)

export const getPlaylists = () =>
  api.get<YouTubePlaylist[]>('/youtube/playlists').then((r) => r.data)

export const getPlaylistItems = (playlistId: string) =>
  api
    .get<YouTubeSearchResult[]>(`/youtube/playlist/${playlistId}`)
    .then((r) => r.data)

export const importLinks = (text: string) =>
  api.post<ImportResult>('/youtube/import', { text }).then((r) => r.data)

// Auth
export const getAuthStatus = () =>
  api.get<AuthStatus>('/auth/status').then((r) => r.data)

export const getGoogleAuthUrl = () => `${getApiBaseUrl()}/auth/google`

export const logout = () => api.post('/auth/logout')

// Tags
export const getTags = () => api.get<Tag[]>('/tags').then((r) => r.data)

export const createTag = (data: { name: string; color: string; category?: string }) =>
  api.post<Tag>('/tags', data).then((r) => r.data)
export const updateTag = (id: number, data: { name?: string; color?: string; category?: string }) =>
  api.put<Tag>(`/tags/${id}`, data).then((r) => r.data)

export const deleteTag = (id: number) => api.delete(`/tags/${id}`)

export const createTagFromFolder = (data: { folderId: number; name?: string; color?: string }) =>
  api.post<Tag & { slicesTagged: number }>('/tags/from-folder', data).then((r) => r.data)

export const batchApplyTagToSlices = (data: { tagId?: number; name?: string; color?: string; sliceIds: number[] }) =>
  api.post<{ tag: Tag; slicesTagged: number }>('/tags/batch-apply', data).then((r) => r.data)

export const addTagToTrack = (trackId: number, tagId: number) =>
  api.post(`/tracks/${trackId}/tags`, { tagId })

export const removeTagFromTrack = (trackId: number, tagId: number) =>
  api.delete(`/tracks/${trackId}/tags/${tagId}`)

export const addTagToSlice = (sliceId: number, tagId: number) =>
  api.post(`/slices/${sliceId}/tags`, { tagId })

export const removeTagFromSlice = (sliceId: number, tagId: number) =>
  api.delete(`/slices/${sliceId}/tags/${tagId}`)

export const generateAiTagsForSlice = (sliceId: number) =>
  api
    .post<{
      tags: string[]
      warning?: {
        hadPotentialCustomState: boolean
        message: string | null
        removedTags: string[]
        addedTags: string[]
      }
      features?: {
        isOneShot: boolean
        isLoop: boolean
        bpm: number | null
        spectralCentroid: number
        analysisDurationMs: number
      }
    }>(`/slices/${sliceId}/ai-tags`)
    .then((r) => r.data)

export interface BatchAiTagsResult {
  total: number
  processed: number
  successful: number
  warnings?: {
    totalWithWarnings: number
    sliceIds: number[]
    messages: string[]
  }
  results: {
    sliceId: number
    success: boolean
    error?: string
    hadPotentialCustomState?: boolean
    warningMessage?: string
    removedTags?: string[]
    addedTags?: string[]
  }[]
}

export const batchGenerateAiTags = (sliceIds: number[]) =>
  api.post<BatchAiTagsResult>('/slices/batch-ai-tags', { sliceIds }).then((r) => r.data)

export interface BatchDeleteResult {
  total: number
  deleted: number
  results: { sliceId: number; success: boolean; error?: string }[]
}

export const batchDeleteSlices = (sliceIds: number[]) =>
  api.post<BatchDeleteResult>('/slices/batch-delete', { sliceIds }).then((r) => r.data)

// Favorites
export const toggleFavorite = (sliceId: number) =>
  api.post<{ favorite: boolean }>(`/slices/${sliceId}/favorite`).then((r) => r.data)

// Folders
export const getFolders = async (params?: { collectionId?: number; ungrouped?: boolean }) => {
  const mode = await getHierarchyApiMode()

  if (mode === 'legacy') {
    const legacyParams: { perspectiveId?: number; ungrouped?: boolean } = {}
    if (params?.collectionId !== undefined) legacyParams.perspectiveId = params.collectionId
    if (params?.ungrouped !== undefined) legacyParams.ungrouped = params.ungrouped

    const r = await api.get<any[]>('/collections', { params: legacyParams })
    return r.data.map(mapLegacyCollectionToFolder)
  }

  const r = await api.get<Folder[]>('/folders', { params })
  return r.data
}

export const createFolder = (data: { name: string; color?: string; parentId?: number; collectionId?: number }) =>
  getHierarchyApiMode().then(async (mode) => {
    if (mode === 'legacy') {
      const r = await api.post<any>('/collections', {
        name: data.name,
        color: data.color,
        parentId: data.parentId,
        perspectiveId: data.collectionId,
      })
      return mapLegacyCollectionToFolder(r.data)
    }

    const r = await api.post<Folder>('/folders', data)
    return r.data
  })

export const updateFolder = (
  id: number,
  data: { name?: string; color?: string; parentId?: number | null; collectionId?: number | null }
) =>
  getHierarchyApiMode().then(async (mode) => {
    if (mode === 'legacy') {
      const r = await api.put<any>(`/collections/${id}`, {
        name: data.name,
        color: data.color,
        parentId: data.parentId,
        perspectiveId: data.collectionId,
      })
      return mapLegacyCollectionToFolder(r.data)
    }

    const r = await api.put<Folder>(`/folders/${id}`, data)
    return r.data
  })

export const createFolderFromTag = (data: { tagId: number; name?: string; color?: string; collectionId?: number }) =>
  getHierarchyApiMode().then(async (mode) => {
    if (mode === 'legacy') {
      const r = await api.post<any>('/collections/from-tag', {
        tagId: data.tagId,
        name: data.name,
        color: data.color,
        perspectiveId: data.collectionId,
      })
      return mapLegacyCollectionToFolder(r.data)
    }

    const r = await api.post<Folder>('/folders/from-tag', data)
    return r.data
  })

export const deleteFolder = (id: number) =>
  getHierarchyApiMode().then((mode) =>
    mode === 'legacy' ? api.delete(`/collections/${id}`) : api.delete(`/folders/${id}`)
  )

export const addSliceToFolder = (folderId: number, sliceId: number) =>
  getHierarchyApiMode().then((mode) =>
    mode === 'legacy'
      ? api.post(`/collections/${folderId}/slices`, { sliceId })
      : api.post(`/folders/${folderId}/slices`, { sliceId })
  )

export const removeSliceFromFolder = (folderId: number, sliceId: number) =>
  getHierarchyApiMode().then((mode) =>
    mode === 'legacy'
      ? api.delete(`/collections/${folderId}/slices/${sliceId}`)
      : api.delete(`/folders/${folderId}/slices/${sliceId}`)
  )

export const batchAddSlicesToFolder = (folderId: number, sliceIds: number[]) =>
  getHierarchyApiMode().then(async (mode) => {
    const r = await api.post<{ success: boolean; added: number }>(
      mode === 'legacy' ? `/collections/${folderId}/slices/batch` : `/folders/${folderId}/slices/batch`,
      { sliceIds }
    )
    return r.data
  })

export interface BatchCreateFolderInput {
  tempId: string
  name: string
  color?: string
  parentTempId?: string
  parentId?: number
  sliceIds: number[]
}

export interface BatchCreateResult {
  created: Array<{ tempId: string; id: number; name: string; sliceCount: number }>
}

export const batchCreateFolders = (collectionId: number, folders: BatchCreateFolderInput[]) =>
  getHierarchyApiMode().then(async (mode) => {
    const r = await api.post<BatchCreateResult>(
      mode === 'legacy' ? '/collections/batch-create' : '/folders/batch-create',
      mode === 'legacy' ? { perspectiveId: collectionId, folders } : { collectionId, folders }
    )
    return r.data
  })

// Collections
export const getCollections = async () => {
  const mode = await getHierarchyApiMode()

  if (mode === 'legacy') {
    const r = await api.get<any[]>('/perspectives')
    return r.data.map(mapLegacyPerspectiveToCollection)
  }

  const r = await api.get<Collection[]>('/collections')
  return r.data
}

export const createCollection = (data: { name: string; color?: string }) =>
  getHierarchyApiMode().then(async (mode) => {
    if (mode === 'legacy') {
      const r = await api.post<any>('/perspectives', data)
      return mapLegacyPerspectiveToCollection(r.data)
    }

    const r = await api.post<Collection>('/collections', data)
    return r.data
  })

export const updateCollection = (id: number, data: { name?: string; color?: string; sortOrder?: number }) =>
  getHierarchyApiMode().then(async (mode) => {
    if (mode === 'legacy') {
      const r = await api.put<any>(`/perspectives/${id}`, data)
      return mapLegacyPerspectiveToCollection(r.data)
    }

    const r = await api.put<Collection>(`/collections/${id}`, data)
    return r.data
  })

export const deleteCollection = (id: number) =>
  getHierarchyApiMode().then((mode) =>
    mode === 'legacy' ? api.delete(`/perspectives/${id}`) : api.delete(`/collections/${id}`)
  )

// Facets
export const getFolderFacets = (folderId: number) =>
  getHierarchyApiMode().then(async (mode) => {
    const r = await api.get<FacetGroup>(mode === 'legacy' ? `/collections/${folderId}/facets` : `/folders/${folderId}/facets`)
    return r.data
  })

export const getCollectionFacets = (collectionId: number) =>
  getHierarchyApiMode().then(async (mode) => {
    const r = await api.get<FacetGroup>(mode === 'legacy' ? `/perspectives/${collectionId}/facets` : `/collections/${collectionId}/facets`)
    return r.data
  })

// Split
export const splitFolder = (folderId: number, data: { facetType: 'tag-category' | 'metadata'; facetKey: string; selectedValues?: string[] }) =>
  getHierarchyApiMode().then(async (mode) => {
    const r = await api.post<SplitResult>(mode === 'legacy' ? `/collections/${folderId}/split` : `/folders/${folderId}/split`, data)
    return r.data
  })

export const splitCollection = (collectionId: number, data: { facetType: 'tag-category' | 'metadata'; facetKey: string; selectedValues?: string[] }) =>
  getHierarchyApiMode().then(async (mode) => {
    const r = await api.post<SplitResult>(mode === 'legacy' ? `/perspectives/${collectionId}/split` : `/collections/${collectionId}/split`, data)
    return r.data
  })

// Export
export const exportFolder = (folderId: number, exportPath?: string) =>
  getHierarchyApiMode().then(async (mode) => {
    const r = await api.post<ExportResult>(mode === 'legacy' ? `/collections/${folderId}/export` : `/folders/${folderId}/export`, { exportPath })
    return r.data
  })

export const exportSlices = (favoritesOnly?: boolean, exportPath?: string) =>
  api.post<ExportResult>('/slices/export', { favoritesOnly, exportPath }).then((r) => r.data)

// Local file import
export interface LocalImportResult {
  success: boolean
  track?: { id: number; title: string; duration: number; source: string }
  slice?: { id: number; name: string; duration: number }
}

export interface BatchImportResult {
  total: number
  successful: number
  failed: number
  results: { filename: string; success: boolean; sliceId?: number; error?: string }[]
}

export interface FolderImportResult extends BatchImportResult {
  folderPath: string
}

export const importLocalFile = async (
  file: File,
  importType?: 'sample' | 'track',
  analysisLevel?: 'quick' | 'standard' | 'advanced'
): Promise<LocalImportResult> => {
  const formData = new FormData()
  formData.append('file', file)
  const params = new URLSearchParams()
  if (importType) params.append('importType', importType)
  if (analysisLevel) params.append('analysisLevel', analysisLevel)
  const url = `/import/file${params.toString() ? `?${params.toString()}` : ''}`
  const response = await api.post<LocalImportResult>(url, formData)
  return response.data
}

export const importLocalFiles = async (
  files: File[],
  importType?: 'sample' | 'track',
  analysisLevel?: 'quick' | 'standard' | 'advanced'
): Promise<BatchImportResult> => {
  const formData = new FormData()
  files.forEach((file) => formData.append('files', file))
  const params = new URLSearchParams()
  if (importType) params.append('importType', importType)
  if (analysisLevel) params.append('analysisLevel', analysisLevel)
  const url = `/import/files${params.toString() ? `?${params.toString()}` : ''}`
  const response = await api.post<BatchImportResult>(url, formData)
  return response.data
}

export const importFolder = (
  folderPath: string,
  importType?: 'sample' | 'track',
  analysisLevel?: 'quick' | 'standard' | 'advanced'
) =>
  api.post<FolderImportResult>('/import/folder', { folderPath, importType, analysisLevel }).then((r) => r.data)

// Folder browsing
export interface BrowseResult {
  currentPath: string
  parentPath: string | null
  directories: { name: string; path: string }[]
  audioFileCount: number
}

export const browseDirectory = (path?: string) =>
  api.get<BrowseResult>('/import/browse', { params: { path } }).then((r) => r.data)

// Full library transfer
export interface LibraryExportResult {
  success: boolean
  exportPath: string
  manifest: {
    version: number
    exportedAt: string
    includes: {
      database: string
      directories: string[]
      optionalFiles: string[]
    }
  }
}

export interface LibraryImportResult {
  success: boolean
  importedFrom: string
  backupPath: string
}

export const exportLibrary = (exportPath?: string) =>
  api.post<LibraryExportResult>('/library/export', { exportPath }).then((r) => r.data)

export const importLibrary = (libraryPath: string) =>
  api.post<LibraryImportResult>('/library/import', { libraryPath }).then((r) => r.data)

// Sample Space - Audio Features
export const getSliceFeatures = () =>
  api.get<AudioFeatures[]>('/slices/features').then((r) => r.data)

// Sources feature
export const getSourceTree = () =>
  api.get<SourceTree>('/sources/tree').then((r) => r.data)

export interface SourcesSamplesParams {
  scope?: string  // 'youtube' | 'youtube:{trackId}' | 'local' | 'folder:{path}' | 'folder:{id}' | 'all'
  tags?: number[]
  search?: string
  favorites?: boolean
  sortBy?: 'bpm' | 'key' | 'note' | 'name' | 'duration' | 'createdAt' | 'similarity'
  sortOrder?: 'asc' | 'desc'
  minBpm?: number
  maxBpm?: number
  keys?: string[]
  notes?: string[]
  dateAddedFrom?: string
  dateAddedTo?: string
  dateCreatedFrom?: string
  dateCreatedTo?: string
  similarTo?: number
  minSimilarity?: number
}

export const getSourcesSamples = (params: SourcesSamplesParams) => {
  const queryParams: Record<string, string> = {}
  if (params.scope) queryParams.scope = params.scope
  if (params.tags && params.tags.length > 0) queryParams.tags = params.tags.join(',')
  if (params.search) queryParams.search = params.search
  if (params.favorites) queryParams.favorites = 'true'
  if (params.sortBy) queryParams.sortBy = params.sortBy
  if (params.sortOrder) queryParams.sortOrder = params.sortOrder
  if (params.minBpm !== undefined) queryParams.minBpm = params.minBpm.toString()
  if (params.maxBpm !== undefined) queryParams.maxBpm = params.maxBpm.toString()
  if (params.keys && params.keys.length > 0) queryParams.keys = params.keys.join(',')
  if (params.notes && params.notes.length > 0) queryParams.notes = params.notes.join(',')
  if (params.dateAddedFrom) queryParams.dateAddedFrom = params.dateAddedFrom
  if (params.dateAddedTo) queryParams.dateAddedTo = params.dateAddedTo
  if (params.dateCreatedFrom) queryParams.dateCreatedFrom = params.dateCreatedFrom
  if (params.dateCreatedTo) queryParams.dateCreatedTo = params.dateCreatedTo
  if (params.similarTo !== undefined) queryParams.similarTo = params.similarTo.toString()
  if (params.minSimilarity !== undefined) queryParams.minSimilarity = params.minSimilarity.toString()

  return api.get<SourcesSamplesResponse>('/sources/samples', { params: queryParams }).then((r) => r.data)
}

export interface DuplicateGroup {
  matchType: 'exact' | 'file'
  hashSimilarity: number
  samples: Array<{
    id: number
    name: string
    trackTitle: string
  }>
}

export const getDuplicateSlices = () =>
  api.get<{ groups: DuplicateGroup[]; total: number }>('/slices/duplicates').then((r) => r.data)

// Batch re-analyze samples
export interface BatchReanalyzeResponse {
  total: number
  analyzed: number
  failed: number
  warnings?: {
    totalWithWarnings: number
    sliceIds: number[]
    messages: string[]
  }
  results: Array<{
    sliceId: number
    success: boolean
    error?: string
    hadPotentialCustomState?: boolean
    warningMessage?: string
    removedTags?: string[]
    addedTags?: string[]
  }>
}

export const batchReanalyzeSamples = (
  sliceIds?: number[],
  analysisLevel?: 'quick' | 'standard' | 'advanced',
  concurrency?: number,
  includeFilenameTags?: boolean
) =>
  api.post<BatchReanalyzeResponse>('/slices/batch-reanalyze', { sliceIds, analysisLevel, concurrency, includeFilenameTags }).then((r) => r.data)

// Sync configs
export const getSyncConfigs = () =>
  api.get<SyncConfig[]>('/sync-configs').then((r) => r.data)

export const createSyncConfig = (data: { tagId: number; folderId: number; direction: string }) =>
  api.post<SyncConfig>('/sync-configs', data).then((r) => r.data)

export const deleteSyncConfig = (id: number) =>
  api.delete(`/sync-configs/${id}`)
