import type { SliceFilterState, FilterableSlice } from '../types'

export const DEFAULT_FILTER_STATE: SliceFilterState = {
  searchQuery: '',
  selectedTags: [],
  minDuration: 0,
  maxDuration: 60,
  showFavoritesOnly: false,
  selectedCollectionIds: [],
  selectedTrackId: null,
}

// Individual filter predicates (composable, testable)
export const filterPredicates = {
  favorites: (item: FilterableSlice, state: SliceFilterState) => {
    if (!state.showFavoritesOnly) return true
    return item.favorite === true
  },

  collection: (item: FilterableSlice, state: SliceFilterState) => {
    if (state.selectedCollectionIds.length === 0) return true
    const itemCollectionIds = item.collectionIds ?? []
    return state.selectedCollectionIds.every(collectionId => itemCollectionIds.includes(collectionId)) // AND logic
  },

  track: (item: FilterableSlice, state: SliceFilterState) => {
    if (state.selectedTrackId === null) return true
    return item.trackId === state.selectedTrackId
  },

  search: (item: FilterableSlice, state: SliceFilterState) => {
    if (!state.searchQuery) return true
    const query = state.searchQuery.toLowerCase()
    const matchesName = item.name.toLowerCase().includes(query)
    const matchesTrack = item.track?.title.toLowerCase().includes(query) ?? false
    return matchesName || matchesTrack // OR logic
  },

  tags: (item: FilterableSlice, state: SliceFilterState) => {
    if (state.selectedTags.length === 0) return true
    const itemTagIds = item.tags?.map(t => t.id) ?? []
    return state.selectedTags.every(tagId => itemTagIds.includes(tagId)) // AND logic
  },

  duration: (item: FilterableSlice, state: SliceFilterState) => {
    const duration = item.duration ?? (
      item.startTime !== undefined && item.endTime !== undefined
        ? item.endTime - item.startTime
        : null
    )
    if (duration === null) return true
    return duration >= state.minDuration && duration <= state.maxDuration
  },
}

// Main filter function - applies all predicates in sequence (same order as SliceBrowser)
export function applySliceFilters<T extends FilterableSlice>(
  items: T[],
  state: SliceFilterState
): T[] {
  return items.filter(item => {
    return (
      filterPredicates.favorites(item, state) &&
      filterPredicates.collection(item, state) &&
      filterPredicates.track(item, state) &&
      filterPredicates.search(item, state) &&
      filterPredicates.tags(item, state) &&
      filterPredicates.duration(item, state)
    )
  })
}

// Utility to calculate max duration from data
export function getMaxDuration<T extends FilterableSlice>(items: T[]): number {
  if (items.length === 0) return 60

  const durations = items
    .map(item => {
      if (item.duration !== undefined && item.duration !== null) return item.duration
      if (item.startTime !== undefined && item.endTime !== undefined) {
        return item.endTime - item.startTime
      }
      return 0
    })
    .filter((d): d is number => d > 0 && d != null)

  return durations.length > 0 ? Math.ceil(Math.max(...durations)) : 60
}
