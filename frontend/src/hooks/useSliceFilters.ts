import { useState, useMemo } from 'react'
import { applySliceFilters, getMaxDuration, DEFAULT_FILTER_STATE } from '../utils/sliceFilters'
import type { SliceFilterState, FilterableSlice } from '../types'

export interface UseSliceFiltersOptions {
  initialState?: Partial<SliceFilterState>
  autoCalculateMaxDuration?: boolean
}

export interface UseSliceFiltersResult<T extends FilterableSlice> {
  filterState: SliceFilterState
  setSearchQuery: (query: string) => void
  setSelectedTags: (tags: number[]) => void
  setMinDuration: (duration: number) => void
  setMaxDuration: (duration: number) => void
  setShowFavoritesOnly: (show: boolean) => void
  setSelectedCollectionId: (id: number | null) => void
  setSelectedTrackId: (id: number | null) => void
  setFilterState: (state: Partial<SliceFilterState>) => void
  resetFilters: () => void
  applyFilters: (items: T[]) => T[]
  maxSliceDuration: number
}

export function useSliceFilters<T extends FilterableSlice>(
  allItems: T[] | undefined,
  options: UseSliceFiltersOptions = {}
): UseSliceFiltersResult<T> {
  const {
    initialState = {},
    autoCalculateMaxDuration = true
  } = options

  const [filterState, setFilterStateInternal] = useState<SliceFilterState>({
    ...DEFAULT_FILTER_STATE,
    ...initialState,
  })

  // Calculate max duration from data
  const maxSliceDuration = useMemo(() => {
    if (!autoCalculateMaxDuration || !allItems) return 60
    const calculated = getMaxDuration(allItems)
    if (filterState.maxDuration === DEFAULT_FILTER_STATE.maxDuration && calculated !== 60) {
      setFilterStateInternal(prev => ({ ...prev, maxDuration: calculated }))
    }
    return calculated
  }, [allItems, autoCalculateMaxDuration, filterState.maxDuration])

  // Individual setters (for backwards compatibility with SliceBrowser)
  const setSearchQuery = (searchQuery: string) =>
    setFilterStateInternal(prev => ({ ...prev, searchQuery }))

  const setSelectedTags = (selectedTags: number[]) =>
    setFilterStateInternal(prev => ({ ...prev, selectedTags }))

  const setMinDuration = (minDuration: number) =>
    setFilterStateInternal(prev => ({ ...prev, minDuration }))

  const setMaxDuration = (maxDuration: number) =>
    setFilterStateInternal(prev => ({ ...prev, maxDuration }))

  const setShowFavoritesOnly = (showFavoritesOnly: boolean) =>
    setFilterStateInternal(prev => ({ ...prev, showFavoritesOnly }))

  const setSelectedCollectionId = (selectedCollectionId: number | null) =>
    setFilterStateInternal(prev => ({ ...prev, selectedCollectionId }))

  const setSelectedTrackId = (selectedTrackId: number | null) =>
    setFilterStateInternal(prev => ({ ...prev, selectedTrackId }))

  const setFilterState = (partial: Partial<SliceFilterState>) =>
    setFilterStateInternal(prev => ({ ...prev, ...partial }))

  const resetFilters = () => setFilterStateInternal(DEFAULT_FILTER_STATE)

  // Memoized filter function
  const applyFilters = useMemo(() => {
    return (items: T[]) => applySliceFilters(items, filterState)
  }, [filterState])

  return {
    filterState,
    setSearchQuery,
    setSelectedTags,
    setMinDuration,
    setMaxDuration,
    setShowFavoritesOnly,
    setSelectedCollectionId,
    setSelectedTrackId,
    setFilterState,
    resetFilters,
    applyFilters,
    maxSliceDuration,
  }
}

// Convenience hook with auto-filtering
export function useFilteredSlices<T extends FilterableSlice>(
  allItems: T[] | undefined,
  options: UseSliceFiltersOptions = {}
) {
  const filterControls = useSliceFilters(allItems, options)

  const filteredItems = useMemo(() => {
    if (!allItems) return []
    return filterControls.applyFilters(allItems)
  }, [allItems, filterControls.applyFilters])

  return {
    ...filterControls,
    filteredItems,
  }
}
