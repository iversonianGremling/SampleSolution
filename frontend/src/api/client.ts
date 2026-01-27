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
  Collection,
  ExportResult,
  AudioFeatures,
  SourceTree,
  SourcesSamplesResponse,
} from '../types'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

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

export const updateTrack = (id: number, data: { title?: string }) =>
  api.put<Track>(`/tracks/${id}`, data).then((r) => r.data)

export const getTrackAudioUrl = (id: number) => `/api/tracks/${id}/audio`

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

export const deleteSlice = (id: number) => api.delete(`/slices/${id}`)

export const getSliceDownloadUrl = (id: number) => `/api/slices/${id}/download`

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

export const getGoogleAuthUrl = () => '/api/auth/google'

export const logout = () => api.post('/auth/logout')

// Tags
export const getTags = () => api.get<Tag[]>('/tags').then((r) => r.data)

export const createTag = (data: { name: string; color: string }) =>
  api.post<Tag>('/tags', data).then((r) => r.data)

export const deleteTag = (id: number) => api.delete(`/tags/${id}`)

export const addTagToTrack = (trackId: number, tagId: number) =>
  api.post(`/tracks/${trackId}/tags`, { tagId })

export const removeTagFromTrack = (trackId: number, tagId: number) =>
  api.delete(`/tracks/${trackId}/tags/${tagId}`)

export const addTagToSlice = (sliceId: number, tagId: number) =>
  api.post(`/slices/${sliceId}/tags`, { tagId })

export const removeTagFromSlice = (sliceId: number, tagId: number) =>
  api.delete(`/slices/${sliceId}/tags/${tagId}`)

export const generateAiTagsForSlice = (sliceId: number) =>
  api.post<{ tags: string[] }>(`/slices/${sliceId}/ai-tags`).then((r) => r.data)

export interface BatchAiTagsResult {
  total: number
  processed: number
  successful: number
  results: { sliceId: number; success: boolean; error?: string }[]
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

// Collections
export const getCollections = () =>
  api.get<Collection[]>('/collections').then((r) => r.data)

export const createCollection = (data: { name: string; color?: string; parentId?: number }) =>
  api.post<Collection>('/collections', data).then((r) => r.data)

export const updateCollection = (id: number, data: { name?: string; color?: string; parentId?: number | null }) =>
  api.put<Collection>(`/collections/${id}`, data).then((r) => r.data)

export const createCollectionFromTag = (data: { tagId: number; name?: string; color?: string }) =>
  api.post<Collection>('/collections/from-tag', data).then((r) => r.data)

export const deleteCollection = (id: number) =>
  api.delete(`/collections/${id}`)

export const addSliceToCollection = (collectionId: number, sliceId: number) =>
  api.post(`/collections/${collectionId}/slices`, { sliceId })

export const removeSliceFromCollection = (collectionId: number, sliceId: number) =>
  api.delete(`/collections/${collectionId}/slices/${sliceId}`)

// Export
export const exportCollection = (collectionId: number, exportPath?: string) =>
  api.post<ExportResult>(`/collections/${collectionId}/export`, { exportPath }).then((r) => r.data)

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

export const importLocalFile = async (file: File, importType?: 'sample' | 'track'): Promise<LocalImportResult> => {
  const formData = new FormData()
  formData.append('file', file)
  const url = `/import/file${importType ? `?importType=${importType}` : ''}`
  const response = await api.post<LocalImportResult>(url, formData)
  return response.data
}

export const importLocalFiles = async (files: File[], importType?: 'sample' | 'track'): Promise<BatchImportResult> => {
  const formData = new FormData()
  files.forEach((file) => formData.append('files', file))
  const url = `/import/files${importType ? `?importType=${importType}` : ''}`
  const response = await api.post<BatchImportResult>(url, formData)
  return response.data
}

export const importFolder = (folderPath: string, importType?: 'sample' | 'track') =>
  api.post<FolderImportResult>('/import/folder', { folderPath, importType }).then((r) => r.data)

// Folder browsing
export interface BrowseResult {
  currentPath: string
  parentPath: string | null
  directories: { name: string; path: string }[]
  audioFileCount: number
}

export const browseDirectory = (path?: string) =>
  api.get<BrowseResult>('/import/browse', { params: { path } }).then((r) => r.data)

// Sample Space - Audio Features
export const getSliceFeatures = () =>
  api.get<AudioFeatures[]>('/slices/features').then((r) => r.data)

// Sources feature
export const getSourceTree = () =>
  api.get<SourceTree>('/sources/tree').then((r) => r.data)

export interface SourcesSamplesParams {
  scope?: string  // 'youtube' | 'youtube:{trackId}' | 'local' | 'folder:{path}' | 'collection:{id}' | 'all'
  tags?: number[]
  search?: string
  favorites?: boolean
}

export const getSourcesSamples = (params: SourcesSamplesParams) => {
  const queryParams: Record<string, string> = {}
  if (params.scope) queryParams.scope = params.scope
  if (params.tags && params.tags.length > 0) queryParams.tags = params.tags.join(',')
  if (params.search) queryParams.search = params.search
  if (params.favorites) queryParams.favorites = 'true'

  return api.get<SourcesSamplesResponse>('/sources/samples', { params: queryParams }).then((r) => r.data)
}
