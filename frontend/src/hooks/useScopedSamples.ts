import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/client'
import type { SourceScope } from '../types'

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
    case 'my-folder':
      return `collection:${scope.collectionId}`
    default:
      return 'all'
  }
}

export function useScopedSamples(
  scope: SourceScope,
  tagIds: number[],
  search: string,
  favorites: boolean = false
) {
  const scopeString = scopeToString(scope)

  return useQuery({
    queryKey: ['scopedSamples', scopeString, tagIds, search, favorites],
    queryFn: () =>
      api.getSourcesSamples({
        scope: scopeString,
        tags: tagIds.length > 0 ? tagIds : undefined,
        search: search.trim() || undefined,
        favorites: favorites || undefined,
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
