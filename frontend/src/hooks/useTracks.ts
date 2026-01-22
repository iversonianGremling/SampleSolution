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

export function useUpdateTrack() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { title?: string } }) =>
      api.updateTrack(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
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

export function useAllSlices() {
  return useQuery({
    queryKey: ['allSlices'],
    queryFn: api.getAllSlices,
  })
}

export function useAddTagToSlice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ sliceId, tagId }: { sliceId: number; tagId: number }) =>
      api.addTagToSlice(sliceId, tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['slices'] })
    },
  })
}

export function useRemoveTagFromSlice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ sliceId, tagId }: { sliceId: number; tagId: number }) =>
      api.removeTagFromSlice(sliceId, tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['slices'] })
    },
  })
}

export function useCreateSlice(trackId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; startTime: number; endTime: number }) =>
      api.createSlice(trackId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slices', trackId] })
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
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
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
    },
  })
}

export function useDeleteSlice(trackId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.deleteSlice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slices', trackId] })
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
    },
  })
}

export function useDeleteSliceGlobal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.deleteSlice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['slices'] })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
    },
  })
}

export function useUpdateSliceGlobal() {
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
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['slices'] })
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
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
    },
  })
}

export function useBatchGenerateAiTags() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.batchGenerateAiTags,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['slices'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
  })
}

export function useBatchDeleteSlices() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.batchDeleteSlices,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['slices'] })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
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

// Favorites
export function useToggleFavorite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.toggleFavorite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['slices'] })
    },
  })
}

// Collections
export function useCollections() {
  return useQuery({
    queryKey: ['collections'],
    queryFn: api.getCollections,
  })
}

export function useCreateCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.createCollection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] })
    },
  })
}

export function useUpdateCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; color?: string } }) =>
      api.updateCollection(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] })
    },
  })
}

export function useDeleteCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.deleteCollection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] })
    },
  })
}

export function useAddSliceToCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ collectionId, sliceId }: { collectionId: number; sliceId: number }) =>
      api.addSliceToCollection(collectionId, sliceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
    },
  })
}

export function useRemoveSliceFromCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ collectionId, sliceId }: { collectionId: number; sliceId: number }) =>
      api.removeSliceFromCollection(collectionId, sliceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
    },
  })
}

// Export
export function useExportCollection() {
  return useMutation({
    mutationFn: ({ collectionId, exportPath }: { collectionId: number; exportPath?: string }) =>
      api.exportCollection(collectionId, exportPath),
  })
}

export function useExportSlices() {
  return useMutation({
    mutationFn: ({ favoritesOnly, exportPath }: { favoritesOnly?: boolean; exportPath?: string }) =>
      api.exportSlices(favoritesOnly, exportPath),
  })
}

// Local file import
export function useImportLocalFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ file, importType }: { file: File; importType?: 'sample' | 'track' }) =>
      api.importLocalFile(file, importType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
    },
  })
}

export function useImportLocalFiles() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ files, importType }: { files: File[]; importType?: 'sample' | 'track' }) =>
      api.importLocalFiles(files, importType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
    },
  })
}

export function useImportFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ folderPath, importType }: { folderPath: string; importType?: 'sample' | 'track' }) =>
      api.importFolder(folderPath, importType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
    },
  })
}

// Folder browsing
export function useBrowseDirectory(path?: string) {
  return useQuery({
    queryKey: ['browse', path],
    queryFn: () => api.browseDirectory(path),
  })
}
