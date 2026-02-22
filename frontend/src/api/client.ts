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
const DEFAULT_CREATE_COLOR = '#3b82f6'

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

export const updateTrack = (id: number, data: {
  title?: string
  artist?: string | null
  album?: string | null
  year?: number | null
  albumArtist?: string | null
  genre?: string | null
  composer?: string | null
  trackNumber?: number | null
  discNumber?: number | null
  trackComment?: string | null
  musicalKey?: string | null
  tagBpm?: number | null
  isrc?: string | null
  metadataRaw?: string | null
}) =>
  api.put<Track>(`/tracks/${id}`, data).then((r) => r.data)

export const getTrackAudioUrl = (id: number) => `${getApiBaseUrl()}/tracks/${id}/audio`

export const getTrackPeaks = (id: number) =>
  api.get<number[]>(`/tracks/${id}/peaks`).then((r) => r.data)

// Slices
export const getAllSlices = () =>
  api.get<SliceWithTrack[]>('/slices').then((r) => r.data)

export const getSliceCount = () =>
  api.get<{ total: number }>('/slices/count').then((r) => r.data.total)

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

export type BatchConvertTargetFormat = 'mp3' | 'wav' | 'flac' | 'aiff' | 'ogg' | 'm4a'

export interface BatchConvertResultEntry {
  sliceId: number
  success: boolean
  skipped: boolean
  outputPath?: string
  format?: string | null
  error?: string
}

export interface BatchConvertResponse {
  targetFormat: BatchConvertTargetFormat
  total: number
  converted: number
  skipped: number
  failed: number
  results: BatchConvertResultEntry[]
}

export const batchConvertSlices = (sliceIds: number[], targetFormat: BatchConvertTargetFormat) =>
  api
    .post<BatchConvertResponse>('/slices/batch-convert', { sliceIds, targetFormat })
    .then((r) => r.data)

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
    const payload = { ...data, color: data.color ?? DEFAULT_CREATE_COLOR }

    if (mode === 'legacy') {
      const r = await api.post<any>('/collections', {
        name: payload.name,
        color: payload.color,
        parentId: payload.parentId,
        perspectiveId: payload.collectionId,
      })
      return mapLegacyCollectionToFolder(r.data)
    }

    const r = await api.post<Folder>('/folders', payload)
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
    const payload = { ...data, color: data.color ?? DEFAULT_CREATE_COLOR }

    if (mode === 'legacy') {
      const r = await api.post<any>('/perspectives', payload)
      return mapLegacyPerspectiveToCollection(r.data)
    }

    const r = await api.post<Collection>('/collections', payload)
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

type LocalFileWithPath = File & {
  path?: string
  webkitRelativePath?: string
}

export const importLocalFile = async (
  file: File,
  importType?: 'sample' | 'track',
  analysisLevel?: 'advanced'
): Promise<LocalImportResult> => {
  const formData = new FormData()
  const localFile = file as LocalFileWithPath
  formData.append('file', file)
  formData.append('relativePath', localFile.webkitRelativePath || '')
  if (typeof localFile.path === 'string' && localFile.path.trim()) {
    formData.append('absolutePath', localFile.path)
  }
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
  analysisLevel?: 'advanced'
): Promise<BatchImportResult> => {
  const formData = new FormData()
  files.forEach((file) => {
    const localFile = file as LocalFileWithPath
    formData.append('files', file)
    formData.append('relativePaths', localFile.webkitRelativePath || '')
    formData.append('absolutePaths', typeof localFile.path === 'string' ? localFile.path : '')
  })
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
  analysisLevel?: 'advanced'
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

export interface CreateImportedFolderResult {
  success: boolean
  path: string
  parentPath: string
  name: string
}

export const createImportedFolder = (parentPath: string, name: string) =>
  api
    .post<CreateImportedFolderResult>('/import/folders', { parentPath, name })
    .then((r) => r.data)

export interface DeleteSourceResult {
  success: boolean
  scope: string
  deletedTracks: number
}

function normalizeSourcePathIdentity(value: string): string {
  return value
    .replace(/\\+/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

function getPosixDirname(value: string): string {
  const normalized = value.replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  if (idx < 0) return '.'
  if (idx === 0) return '/'
  return normalized.slice(0, idx)
}

function isPathInFolderScope(candidatePath: string | null, scopePath: string): boolean {
  if (!candidatePath) return false
  const normalizedCandidate = normalizeSourcePathIdentity(candidatePath)
  const normalizedScope = normalizeSourcePathIdentity(scopePath)
  if (!normalizedCandidate || !normalizedScope) return false
  return normalizedCandidate === normalizedScope || normalizedCandidate.startsWith(`${normalizedScope}/`)
}

function getImportedTrackFolderScopePath(
  folderPath: string | null | undefined,
  relativePath: string | null | undefined,
  originalPath: string | null | undefined
): string | null {
  if (!folderPath || !folderPath.trim()) return null
  const normalizedFolderPath = normalizeSourcePathIdentity(folderPath)
  if (!normalizedFolderPath) return null

  if (relativePath && relativePath.trim()) {
    const normalizedRelative = normalizeSourcePathIdentity(relativePath)
    if (normalizedRelative) {
      const relativeDir = getPosixDirname(normalizedRelative)
      if (!relativeDir || relativeDir === '.') return normalizedFolderPath
      return normalizeSourcePathIdentity(`${normalizedFolderPath}/${relativeDir}`)
    }
  }

  if (originalPath && originalPath.trim()) {
    const normalizedOriginal = normalizeSourcePathIdentity(originalPath)
    if (isPathInFolderScope(normalizedOriginal, normalizedFolderPath)) {
      const prefix = `${normalizedFolderPath}/`
      const relativeToRoot = normalizedOriginal === normalizedFolderPath
        ? ''
        : normalizedOriginal.startsWith(prefix)
          ? normalizedOriginal.slice(prefix.length)
          : ''
      if (relativeToRoot) {
        const relativeDir = getPosixDirname(relativeToRoot)
        if (relativeDir && relativeDir !== '.') {
          return normalizeSourcePathIdentity(`${normalizedFolderPath}/${relativeDir}`)
        }
      }
    }
  }

  return normalizedFolderPath
}

async function deleteSourceLegacyFallback(scope: string): Promise<DeleteSourceResult> {
  const tracks = await getTracks()
  let targetTracks = tracks

  if (scope === 'youtube') {
    targetTracks = tracks.filter((track) => track.source === 'youtube')
  } else if (scope.startsWith('youtube:')) {
    const youtubeScopeValue = scope.slice('youtube:'.length).trim()
    const parsedTrackId = Number.parseInt(youtubeScopeValue, 10)
    targetTracks = tracks.filter((track) => {
      if (Number.isInteger(parsedTrackId) && String(parsedTrackId) === youtubeScopeValue) {
        return track.id === parsedTrackId
      }
      return track.youtubeId === youtubeScopeValue
    })
  } else if (scope === 'local') {
    targetTracks = tracks.filter((track) => track.source === 'local' && !track.folderPath)
  } else if (scope.startsWith('folder:')) {
    const folderScopeValue = normalizeSourcePathIdentity(scope.slice('folder:'.length).trim())
    targetTracks = tracks.filter((track) => {
      if (track.source !== 'local' || !track.folderPath) return false
      const trackFolderScopePath = getImportedTrackFolderScopePath(
        track.folderPath,
        track.relativePath,
        track.originalPath
      )
      return isPathInFolderScope(trackFolderScopePath, folderScopeValue)
    })
  } else {
    throw new Error(`Unsupported source scope: ${scope}`)
  }

  for (const track of targetTracks) {
    await deleteTrack(track.id)
  }

  return {
    success: true,
    scope,
    deletedTracks: targetTracks.length,
  }
}

export const deleteSource = async (scope: string): Promise<DeleteSourceResult> => {
  const payload = { params: { scope }, data: { scope } }

  try {
    const response = await api.delete<DeleteSourceResult>('/sources', payload)
    return response.data
  } catch (error) {
    if (!(axios.isAxiosError(error) && error.response?.status === 404)) {
      throw error
    }
  }

  try {
    const response = await api.delete<DeleteSourceResult>('/tracks/sources', payload)
    return response.data
  } catch (error) {
    if (!(axios.isAxiosError(error) && error.response?.status === 404)) {
      throw error
    }
  }

  return deleteSourceLegacyFallback(scope)
}

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
  resolvedLibraryPath?: string
  extractedFromZip?: boolean
  mode?: LibraryImportMode
  sourceId?: string
  sourceName?: string
  importedCollections?: string[]
}

export type LibraryImportMode = 'replace' | 'source'

export interface LibraryImportOptions {
  mode?: LibraryImportMode
  importCollections?: boolean
  collectionNames?: string[]
  collectionNameSuffix?: string
}

export const exportLibrary = (exportPath?: string) =>
  api.post<LibraryExportResult>('/library/export', { exportPath }).then((r) => r.data)

export const importLibrary = (libraryPath: string, options?: LibraryImportOptions) => {
  const payload: Record<string, unknown> = { libraryPath }

  if (options?.mode) payload.mode = options.mode
  if (options?.importCollections !== undefined) payload.importCollections = options.importCollections
  if (options?.collectionNames) payload.collectionNames = options.collectionNames
  if (options?.collectionNameSuffix !== undefined) payload.collectionNameSuffix = options.collectionNameSuffix

  return api.post<LibraryImportResult>('/library/import', payload).then((r) => r.data)
}

// Sample Space - Audio Features
export const getSliceFeatures = () =>
  api.get<AudioFeatures[]>('/slices/features').then((r) => r.data)

// Sources feature
export const getSourceTree = () =>
  api.get<SourceTree>('/sources/tree').then((r) => r.data)

export interface SourcesSamplesParams {
  scope?: string  // 'youtube' | 'youtube:{trackId}' | 'local' | 'folder:{path}' | 'folder:{id}' | 'library:{id}' | 'all'
  tags?: number[]
  search?: string
  favorites?: boolean
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
  if (params.dateUpdatedFrom) queryParams.dateUpdatedFrom = params.dateUpdatedFrom
  if (params.dateUpdatedTo) queryParams.dateUpdatedTo = params.dateUpdatedTo
  if (params.similarTo !== undefined) queryParams.similarTo = params.similarTo.toString()
  if (params.minSimilarity !== undefined) queryParams.minSimilarity = params.minSimilarity.toString()
  if (params.brightnessMin !== undefined) queryParams.brightnessMin = params.brightnessMin.toString()
  if (params.brightnessMax !== undefined) queryParams.brightnessMax = params.brightnessMax.toString()
  if (params.harmonicityMin !== undefined) queryParams.harmonicityMin = params.harmonicityMin.toString()
  if (params.harmonicityMax !== undefined) queryParams.harmonicityMax = params.harmonicityMax.toString()
  if (params.noisinessMin !== undefined) queryParams.noisinessMin = params.noisinessMin.toString()
  if (params.noisinessMax !== undefined) queryParams.noisinessMax = params.noisinessMax.toString()
  if (params.attackMin !== undefined) queryParams.attackMin = params.attackMin.toString()
  if (params.attackMax !== undefined) queryParams.attackMax = params.attackMax.toString()
  if (params.dynamicsMin !== undefined) queryParams.dynamicsMin = params.dynamicsMin.toString()
  if (params.dynamicsMax !== undefined) queryParams.dynamicsMax = params.dynamicsMax.toString()
  if (params.saturationMin !== undefined) queryParams.saturationMin = params.saturationMin.toString()
  if (params.saturationMax !== undefined) queryParams.saturationMax = params.saturationMax.toString()
  if (params.surfaceMin !== undefined) queryParams.surfaceMin = params.surfaceMin.toString()
  if (params.surfaceMax !== undefined) queryParams.surfaceMax = params.surfaceMax.toString()
  if (params.densityMin !== undefined) queryParams.densityMin = params.densityMin.toString()
  if (params.densityMax !== undefined) queryParams.densityMax = params.densityMax.toString()
  if (params.ambienceMin !== undefined) queryParams.ambienceMin = params.ambienceMin.toString()
  if (params.ambienceMax !== undefined) queryParams.ambienceMax = params.ambienceMax.toString()
  if (params.stereoWidthMin !== undefined) queryParams.stereoWidthMin = params.stereoWidthMin.toString()
  if (params.stereoWidthMax !== undefined) queryParams.stereoWidthMax = params.stereoWidthMax.toString()
  if (params.depthMin !== undefined) queryParams.depthMin = params.depthMin.toString()
  if (params.depthMax !== undefined) queryParams.depthMax = params.depthMax.toString()

  return api.get<SourcesSamplesResponse>('/sources/samples', { params: queryParams }).then((r) => r.data)
}

export interface DuplicateGroup {
  matchType: 'exact' | 'content' | 'file'
  hashSimilarity: number
  samples: Array<{
    id: number
    name: string
    filePath?: string | null
    trackTitle: string
    favorite?: boolean
    createdAt?: string | null
    sampleRate?: number | null
    channels?: number | null
    format?: string | null
    tagsCount?: number
    folderCount?: number
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
  analysisLevel?: 'advanced',
  concurrency?: number,
  includeFilenameTags?: boolean,
  options?: { signal?: AbortSignal }
) =>
  api
    .post<BatchReanalyzeResponse>(
      '/slices/batch-reanalyze',
      { sliceIds, analysisLevel, concurrency, includeFilenameTags },
      { signal: options?.signal },
    )
    .then((r) => r.data)

// Sync configs
export const getSyncConfigs = () =>
  api.get<SyncConfig[]>('/sync-configs').then((r) => r.data)

export const createSyncConfig = (data: { tagId: number; folderId: number; direction: string }) =>
  api.post<SyncConfig>('/sync-configs', data).then((r) => r.data)

export const deleteSyncConfig = (id: number) =>
  api.delete(`/sync-configs/${id}`)

// Spotify
export interface SpotifyStatus {
  configured: boolean
  connected: boolean
}

export interface SpotifyPlaylist {
  id: string
  name: string
  trackCount: number
  thumbnailUrl: string | null
}

export const getSpotifyStatus = () =>
  api.get<SpotifyStatus>('/spotify/status').then((r) => r.data)

export const getSpotifyAuthUrl = () => `${getApiBaseUrl()}/api/spotify/auth`

export const disconnectSpotify = () =>
  api.post('/spotify/disconnect').then((r) => r.data)

export const getSpotifyPlaylists = () =>
  api.get<SpotifyPlaylist[]>('/spotify/playlists').then((r) => r.data)

export const importSpotify = (text: string) =>
  api.post<ImportResult>('/spotify/import', { text }).then((r) => r.data)

// SoundCloud
export const importSoundCloud = (text: string) =>
  api.post<ImportResult>('/soundcloud/import', { text }).then((r) => r.data)

// Tools
export interface ToolVersions {
  ytdlp: { current: string | null; latest: string | null }
  spotdl: { current: string | null; latest: string | null }
}

export const getToolVersions = () =>
  api.get<ToolVersions>('/tools/versions').then((r) => r.data)

export interface RcloneShareStatus {
  available: boolean
  frontendDir: string | null
  scriptPath: string | null
  configPath: string | null
  scriptExists: boolean
  configExists: boolean
  rcloneVersion: string | null
  message?: string
}

export interface RcloneShareVersionInfo {
  version: string
  publishedAt: string
  remotePath: string
  fileCount: number
  totalBytes: number
  note?: string | null
}

export interface RcloneShareLibraryInfo {
  latest: string | null
  versions: RcloneShareVersionInfo[]
}

export type RcloneShareLibraries = Record<string, RcloneShareLibraryInfo>

export interface RcloneShareCommandResult {
  success: boolean
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
}

export interface RcloneShareListResult extends RcloneShareCommandResult {
  libraries: RcloneShareLibraries
}

export const getRcloneShareStatus = () =>
  api.get<RcloneShareStatus>('/tools/rclone-share/status').then((r) => r.data)

export const initRcloneShare = () =>
  api.post<RcloneShareCommandResult>('/tools/rclone-share/init').then((r) => r.data)

export const listRcloneShareLibraries = (name?: string) =>
  api.get<RcloneShareListResult>('/tools/rclone-share/list', {
    params: name ? { name } : undefined,
  }).then((r) => r.data)

export const publishRcloneShareLibrary = (payload: {
  name: string
  source: string
  version?: string
  note?: string
}) => api.post<RcloneShareCommandResult>('/tools/rclone-share/publish', payload).then((r) => r.data)

export const pullRcloneShareLibrary = (payload: {
  name: string
  version?: string
  target?: string
}) => api.post<RcloneShareCommandResult>('/tools/rclone-share/pull', payload).then((r) => r.data)

export const syncRcloneShareLibraries = (payload?: { targetRoot?: string }) =>
  api.post<RcloneShareCommandResult>('/tools/rclone-share/sync', payload ?? {}).then((r) => r.data)

export interface ToolUpdateOptions {
  onChunk?: (chunk: string) => void
  signal?: AbortSignal
}

async function streamToolUpdate(
  tool: 'ytdlp' | 'spotdl',
  options: ToolUpdateOptions = {},
): Promise<string> {
  const response = await fetch(`${getApiBaseUrl()}/tools/update/${tool}`, {
    method: 'POST',
    credentials: 'include',
    signal: options.signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `Failed to update ${tool}`)
  }

  if (!response.body) {
    const text = await response.text()
    if (text) options.onChunk?.(text)
    return text
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let output = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    if (!chunk) continue

    output += chunk
    options.onChunk?.(chunk)
  }

  const finalChunk = decoder.decode()
  if (finalChunk) {
    output += finalChunk
    options.onChunk?.(finalChunk)
  }

  return output
}

export const streamYtdlpUpdate = (options: ToolUpdateOptions): Promise<string> =>
  streamToolUpdate('ytdlp', options)

export const streamSpotdlUpdate = (options: ToolUpdateOptions): Promise<string> =>
  streamToolUpdate('spotdl', options)

export const updateYtdlp = (): Promise<string> =>
  streamToolUpdate('ytdlp')

export const updateSpotdl = (): Promise<string> =>
  streamToolUpdate('spotdl')

export type DependencyUpdateTarget = 'web' | 'electron' | 'all'

export interface FrontendOutdatedDependency {
  name: string
  current: string | null
  wanted: string | null
  latest: string | null
  dependencyType: 'dependencies' | 'devDependencies' | 'unknown'
  group: 'web' | 'electron'
}

export interface FrontendDependencyGroupStatus {
  total: number
  outdated: number
  upToDate: boolean
  packages: FrontendOutdatedDependency[]
}

export interface FrontendDependencyStatus {
  available: boolean
  frontendDir: string | null
  checkedAt: string
  message?: string
  groups: {
    web: FrontendDependencyGroupStatus
    electron: FrontendDependencyGroupStatus
    all: FrontendDependencyGroupStatus
  }
}

export interface FrontendDependencyUpdateResult {
  target: DependencyUpdateTarget
  updatedPackages: FrontendOutdatedDependency[]
  output: string
  status: FrontendDependencyStatus
}

export const getFrontendDependencyStatus = () =>
  api.get<FrontendDependencyStatus>('/tools/dependencies/status').then((r) => r.data)

export const updateFrontendDependencies = (target: DependencyUpdateTarget) =>
  api.post<FrontendDependencyUpdateResult>(`/tools/dependencies/update/${target}`).then((r) => r.data)

// ── Backup ─────────────────────────────────────────────────────────────────

export type BackupType = 'gdrive' | 'webdav' | 's3' | 'sftp' | 'local'
export type BackupSchedule = 'manual' | 'hourly' | 'daily' | 'weekly'

export interface BackupConfigSummary {
  id: number
  name: string
  type: BackupType
  enabled: number
  remote_path: string
  schedule: BackupSchedule
  last_backup_at: string | null
  last_backup_status: string | null
  last_backup_error: string | null
  params: Record<string, unknown>
}

export interface BackupLog {
  id: number
  config_id: number
  started_at: string
  completed_at: string | null
  status: 'running' | 'success' | 'failed'
  bytes_transferred: number
  files_transferred: number
  error_message: string | null
  details_json: string | null
  created_at: string
}

export interface BackupStatus {
  configs: BackupConfigSummary[]
  rcloneAvailable: boolean
}

export interface BackupResult {
  success: boolean
  bytesTransferred: number
  filesTransferred: number
  errorMessage?: string
  details: Record<string, unknown>
}

export const getBackupStatus = () =>
  api.get<BackupStatus>('/backup/status').then((r) => r.data)

export const getBackupConfigs = () =>
  api.get<BackupConfigSummary[]>('/backup/configs').then((r) => r.data)

export const createBackupConfig = (payload: {
  name: string
  type: BackupType
  params: Record<string, unknown>
  remote_path?: string
  schedule?: BackupSchedule
}) => api.post<BackupConfigSummary>('/backup/configs', payload).then((r) => r.data)

export const updateBackupConfig = (
  id: number,
  payload: Partial<{ name: string; params: Record<string, unknown>; remote_path: string; schedule: BackupSchedule; enabled: boolean }>,
) => api.put<BackupConfigSummary>(`/backup/configs/${id}`, payload).then((r) => r.data)

export const deleteBackupConfig = (id: number) =>
  api.delete(`/backup/configs/${id}`).then((r) => r.data)

export const runBackup = (id: number) =>
  api.post<BackupResult>(`/backup/run/${id}`).then((r) => r.data)

export const runAllBackups = () =>
  api.post<{ message: string }>('/backup/run').then((r) => r.data)

export const getBackupLogs = (configId?: number, limit = 50) =>
  api.get<BackupLog[]>('/backup/logs', { params: { configId, limit } }).then((r) => r.data)

export const getGdriveAuthUrl = (configId?: number) =>
  api.get<{ authUrl: string }>('/backup/gdrive/auth', { params: { configId } }).then((r) => r.data)

export const getBackupDownloadUrl = (includeAudio = false) =>
  `${api.defaults.baseURL}/backup/download?includeAudio=${includeAudio}`

export interface RecoveryKey {
  name: string
  repoPassword: string
  repoUrl: string
  restoreCommand: string
  listCommand: string
  warning: string
}

export const getRecoveryKey = (id: number) =>
  api.get<RecoveryKey>(`/backup/configs/${id}/recovery-key`).then((r) => r.data)
