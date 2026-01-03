import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/client'

export function useTracks() {
  return useQuery({
    queryKey: ['tracks'],
    queryFn: api.getTracks,
  })
}

export function useAddTracks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.addTracks,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
    },
  })
}

export function useDeleteTrack() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.deleteTrack,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
    },
  })
}

export function useSlices(trackId: number) {
  return useQuery({
    queryKey: ['slices', trackId],
    queryFn: () => api.getSlices(trackId),
    enabled: trackId > 0,
  })
}

export function useCreateSlice(trackId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; startTime: number; endTime: number }) =>
      api.createSlice(trackId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slices', trackId] })
    },
  })
}

export function useUpdateSlice(trackId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number
      data: { name?: string; startTime?: number; endTime?: number }
    }) => api.updateSlice(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slices', trackId] })
    },
  })
}

export function useDeleteSlice(trackId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.deleteSlice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slices', trackId] })
    },
  })
}

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: api.getTags,
  })
}

export function useCreateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.createTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
  })
}

export function useGenerateAiTagsForSlice(trackId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.generateAiTagsForSlice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slices', trackId] })
    },
  })
}

export function useAuthStatus() {
  return useQuery({
    queryKey: ['auth'],
    queryFn: api.getAuthStatus,
  })
}

export function useYouTubeSearch(query: string) {
  return useQuery({
    queryKey: ['youtube-search', query],
    queryFn: () => api.searchYouTube(query),
    enabled: query.length > 2,
  })
}

export function usePlaylists() {
  return useQuery({
    queryKey: ['playlists'],
    queryFn: api.getPlaylists,
  })
}

export function usePlaylistItems(playlistId: string) {
  return useQuery({
    queryKey: ['playlist-items', playlistId],
    queryFn: () => api.getPlaylistItems(playlistId),
    enabled: !!playlistId,
  })
}

export function useImportLinks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.importLinks,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
    },
  })
}
