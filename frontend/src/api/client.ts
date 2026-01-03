import axios from 'axios'
import type {
  Track,
  Slice,
  Tag,
  YouTubeSearchResult,
  YouTubePlaylist,
  AuthStatus,
  ImportResult,
} from '../types'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

// Tracks
export const getTracks = () => api.get<Track[]>('/tracks').then((r) => r.data)

export const addTracks = (urls: string[]) =>
  api.post<ImportResult>('/tracks', { urls }).then((r) => r.data)

export const deleteTrack = (id: number) => api.delete(`/tracks/${id}`)

export const getTrackAudioUrl = (id: number) => `/api/tracks/${id}/audio`

export const getTrackPeaks = (id: number) =>
  api.get<number[]>(`/tracks/${id}/peaks`).then((r) => r.data)

// Slices
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
