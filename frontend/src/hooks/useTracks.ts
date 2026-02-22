import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/client'

const HIDDEN_TAG_CATEGORIES = new Set(['tempo', 'spectral'])

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
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
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
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
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
    mutationFn: (id: number) => api.deleteSlice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slices', trackId] })
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['folders'] })
    },
  })
}

export function useDeleteSliceGlobal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteSlice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['slices'] })
      queryClient.invalidateQueries({ queryKey: ['folders'] })
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
    queryFn: async () => {
      const tags = await api.getTags()
      return tags.filter((tag) => !HIDDEN_TAG_CATEGORIES.has((tag.category || '').toLowerCase()))
    },
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

export function useUpdateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; color?: string; category?: string } }) =>
      api.updateTag(id, data),
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
      queryClient.invalidateQueries({ queryKey: ['folders'] })
    },
  })
}

export function useBatchReanalyzeSlices() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      sliceIds,
      analysisLevel,
      concurrency,
      includeFilenameTags,
    }: {
      sliceIds?: number[]
      analysisLevel?: 'advanced'
      concurrency?: number
      includeFilenameTags?: boolean
    }) => api.batchReanalyzeSamples(sliceIds, analysisLevel, concurrency, includeFilenameTags),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['slices'] })
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
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
    onMutate: async (sliceId: number) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['allSlices'] })
      await queryClient.cancelQueries({ queryKey: ['slices'] })
      await queryClient.cancelQueries({ queryKey: ['scopedSamples'] })

      // Snapshot the previous data
      const previousAllSlices = queryClient.getQueryData(['allSlices'])
      const previousSlices = queryClient.getQueryData(['slices'])
      const previousScopedSamples = queryClient.getQueriesData({ queryKey: ['scopedSamples'] })

      // Optimistically update allSlices
      queryClient.setQueryData(['allSlices'], (old: any) => {
        if (!old) return old
        return old.map((slice: any) =>
          slice.id === sliceId ? { ...slice, favorite: !slice.favorite } : slice
        )
      })

      // Optimistically update slices for all track keys
      queryClient.setQueriesData({ queryKey: ['slices'] }, (old: any) => {
        if (!old) return old
        return old.map((slice: any) =>
          slice.id === sliceId ? { ...slice, favorite: !slice.favorite } : slice
        )
      })

      // Optimistically update scopedSamples (for Sources section)
      queryClient.setQueriesData({ queryKey: ['scopedSamples'] }, (old: any) => {
        if (!old || !old.samples) return old
        return {
          ...old,
          samples: old.samples.map((sample: any) =>
            sample.id === sliceId ? { ...sample, favorite: !sample.favorite } : sample
          ),
        }
      })

      return { previousAllSlices, previousSlices, previousScopedSamples }
    },
    onError: (_err, _sliceId, context) => {
      // Rollback on error
      if (context?.previousAllSlices) {
        queryClient.setQueryData(['allSlices'], context.previousAllSlices)
      }
      if (context?.previousSlices) {
        queryClient.setQueryData(['slices'], context.previousSlices)
      }
      if (context?.previousScopedSamples && context.previousScopedSamples.length > 0) {
        context.previousScopedSamples.forEach(([key, data]) => {
          queryClient.setQueryData(key, data)
        })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['slices'] })
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
    },
  })
}

// Folders
export function useFolders(params?: { collectionId?: number; ungrouped?: boolean }) {
  return useQuery({
    queryKey: ['folders', params],
    queryFn: () => api.getFolders(params),
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
    mutationFn: ({ id, data }: { id: number; data: { name?: string; color?: string; sortOrder?: number } }) =>
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
      queryClient.invalidateQueries({ queryKey: ['folders'] })
    },
  })
}

// Facets
export function useFolderFacets(folderId: number | null) {
  return useQuery({
    queryKey: ['folder-facets', folderId],
    queryFn: () => api.getFolderFacets(folderId!),
    enabled: folderId !== null,
  })
}

export function useCollectionFacets(collectionId: number | null) {
  return useQuery({
    queryKey: ['collection-facets', collectionId],
    queryFn: () => api.getCollectionFacets(collectionId!),
    enabled: collectionId !== null,
  })
}

// Split folder
export function useSplitFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ folderId, data }: { folderId: number; data: { facetType: 'tag-category' | 'metadata'; facetKey: string; selectedValues?: string[] } }) =>
      api.splitFolder(folderId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      queryClient.invalidateQueries({ queryKey: ['folder-facets'] })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
    },
  })
}

export function useSplitCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ collectionId, data }: { collectionId: number; data: { facetType: 'tag-category' | 'metadata'; facetKey: string; selectedValues?: string[] } }) =>
      api.splitCollection(collectionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      queryClient.invalidateQueries({ queryKey: ['collection-facets'] })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
    },
  })
}

export function useCreateFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.createFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] })
    },
  })
}

export function useCreateFolderFromTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.createFolderFromTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
    },
    onError: (error) => {
      console.error('Failed to create folder from tag:', error)
    },
  })
}

export function useCreateTagFromFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.createTagFromFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['sources-samples'] })
    },
  })
}

export function useUpdateFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number
      data: { name?: string; color?: string; parentId?: number | null; collectionId?: number | null }
    }) =>
      api.updateFolder(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] })
    },
  })
}

export function useDeleteFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.deleteFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] })
    },
  })
}

export function useAddSliceToFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ folderId, sliceId }: { folderId: number; sliceId: number }) =>
      api.addSliceToFolder(folderId, sliceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['folders'] })
    },
  })
}

export function useBatchAddSlicesToFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ folderId, sliceIds }: { folderId: number; sliceIds: number[] }) =>
      api.batchAddSlicesToFolder(folderId, sliceIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
    },
  })
}

export function useBatchCreateFolders() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ collectionId, folders }: { collectionId: number; folders: api.BatchCreateFolderInput[] }) =>
      api.batchCreateFolders(collectionId, folders),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
    },
  })
}

export function useBatchApplyTagToSlices() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { tagId?: number; name?: string; color?: string; sliceIds: number[] }) =>
      api.batchApplyTagToSlices(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
    },
  })
}

export function useRemoveSliceFromFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ folderId, sliceId }: { folderId: number; sliceId: number }) =>
      api.removeSliceFromFolder(folderId, sliceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['folders'] })
    },
  })
}

// Export
export function useExportFolder() {
  return useMutation({
    mutationFn: ({ folderId, exportPath }: { folderId: number; exportPath?: string }) =>
      api.exportFolder(folderId, exportPath),
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

export function useCreateImportedFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ parentPath, name }: { parentPath: string; name: string }) =>
      api.createImportedFolder(parentPath, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sourceTree'] })
    },
  })
}

export function useDeleteSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ scope }: { scope: string }) =>
      api.deleteSource(scope),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
      queryClient.invalidateQueries({ queryKey: ['sourceTree'] })
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      queryClient.invalidateQueries({ queryKey: ['folder-facets'] })
      queryClient.invalidateQueries({ queryKey: ['collection-facets'] })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
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

// Spotify
export function useSpotifyStatus() {
  return useQuery({
    queryKey: ['spotify-status'],
    queryFn: api.getSpotifyStatus,
    refetchOnWindowFocus: false,
  })
}

export function useSpotifyPlaylists() {
  return useQuery({
    queryKey: ['spotify-playlists'],
    queryFn: api.getSpotifyPlaylists,
    enabled: false,
  })
}

export function useDisconnectSpotify() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.disconnectSpotify,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spotify-status'] })
      queryClient.removeQueries({ queryKey: ['spotify-playlists'] })
    },
  })
}

export function useImportSpotify() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.importSpotify,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
    },
  })
}

// SoundCloud
export function useImportSoundCloud() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.importSoundCloud,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
    },
  })
}

// Tools
export function useToolVersions() {
  return useQuery({
    queryKey: ['tool-versions'],
    queryFn: api.getToolVersions,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  })
}

export function useUpdateYtdlp() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.streamYtdlpUpdate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tool-versions'] })
    },
  })
}

export function useUpdateSpotdl() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.streamSpotdlUpdate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tool-versions'] })
    },
  })
}
