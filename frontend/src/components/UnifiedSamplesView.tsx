import { useState, useMemo, useEffect } from 'react'
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAllSlices, useTags, useCollections, useCreateCollection } from '../hooks/useTracks'
import { useFilteredSlices } from '../hooks/useSliceFilters'
import { SliceFilterPanel } from './SliceFilterPanel'
import { SampleListPanel } from './SampleListPanel'
import { SampleSpaceView } from './SampleSpaceView'
import { DEFAULT_WEIGHTS } from '../utils/featureMatrix'
import type { FeatureWeights } from '../types'
import type { ReductionMethod } from '../hooks/useDimensionReduction'
import type { ClusterMethod } from '../hooks/useClustering'

export function UnifiedSamplesView() {
  // Panel visibility state for medium screens
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [showListPanel, setShowListPanel] = useState(false)
  const [isMediumScreen, setIsMediumScreen] = useState(false)

  // Detect medium screen (< 1280px, which is xl breakpoint - half HD is ~960px)
  useEffect(() => {
    const checkScreenSize = () => {
      setIsMediumScreen(window.innerWidth < 1280)
    }
    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])
  // Data fetching
  const { data: allSlices, isLoading: slicesLoading } = useAllSlices()
  const { data: allTags } = useTags()
  const { data: collections } = useCollections()
  const createCollection = useCreateCollection()

  // Filter controls (shared between list and space)
  const {
    filterState,
    setSearchQuery,
    setSelectedTags,
    setMinDuration,
    setMaxDuration,
    setShowFavoritesOnly,
    setSelectedCollectionIds,
    setSelectedTrackId,
    filteredItems: filteredSlices,
    maxSliceDuration,
  } = useFilteredSlices(allSlices)

  // Calculate sample counts for filter panel
  const { totalSampleCount, favoriteSampleCount } = useMemo(() => {
    if (!allSlices || allSlices.length === 0) {
      return { totalSampleCount: 0, favoriteSampleCount: 0 }
    }
    return {
      totalSampleCount: allSlices.length,
      favoriteSampleCount: allSlices.filter(s => s.favorite === true).length,
    }
  }, [allSlices])

  // View state
  const [isEditMode, setIsEditMode] = useState(false)
  const [selectedSliceId, setSelectedSliceId] = useState<number | null>(null)

  // Feature weights state (shared with SampleSpaceView)
  const [weights, setWeights] = useState<FeatureWeights>(DEFAULT_WEIGHTS)
  const [reductionMethod, setReductionMethod] = useState<ReductionMethod>('umap')
  const [clusterMethod, setClusterMethod] = useState<ClusterMethod>('kmeans')
  const [clusterCount, setClusterCount] = useState(7)
  const [dbscanEpsilon, setDbscanEpsilon] = useState(0.15)

  // Selection handlers
  const handleListSelect = (id: number) => {
    setSelectedSliceId(id)
  }

  const handleSpaceSelect = (id: number | null) => {
    setSelectedSliceId(id)
  }

  // Loading state
  if (slicesLoading) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-800 rounded-lg">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
        <span className="ml-3 text-gray-400">Loading samples...</span>
      </div>
    )
  }

  return (
    <div className="relative flex h-[calc(100vh-180px)] gap-4 overflow-hidden">
      {/* Left: Filter Panel - fixed on large screens, overlay on medium */}
      <div
        className={`
          panel-surface
          ${isMediumScreen
            ? `absolute left-0 top-0 bottom-0 z-40 transition-transform duration-300 ease-out bg-gray-900 shadow-2xl ${
                showFilterPanel ? 'translate-x-0' : '-translate-x-full'
              }`
            : 'relative'
          }
          w-[280px] flex-shrink-0 overflow-y-auto scrollbar-hide
        `}
      >
        <div className="h-full">
          {(!isMediumScreen || showFilterPanel) && (
            <SliceFilterPanel
              filterState={filterState}
              onSearchChange={setSearchQuery}
              onFavoritesChange={setShowFavoritesOnly}
              onTrackFilterChange={setSelectedTrackId}
              onTagFilterChange={setSelectedTags}
              onDurationChange={(min, max) => {
                setMinDuration(min)
                setMaxDuration(max)
              }}
              onCollectionChange={setSelectedCollectionIds}
              onCreateCollection={(name) => createCollection.mutate({ name })}
              allTags={allTags}
              collections={collections}
              maxDuration={maxSliceDuration}
              totalSampleCount={totalSampleCount}
              favoriteSampleCount={favoriteSampleCount}
              vertical
              weights={weights}
              onWeightsChange={setWeights}
              reductionMethod={reductionMethod}
              onReductionMethodChange={setReductionMethod}
              clusterMethod={clusterMethod}
              onClusterMethodChange={setClusterMethod}
              clusterCount={clusterCount}
              onClusterCountChange={setClusterCount}
              dbscanEpsilon={dbscanEpsilon}
              onDbscanEpsilonChange={setDbscanEpsilon}
            />
          )}
        </div>
      </div>

      {/* Middle: Sample Space */}
      <div className="flex-1 min-w-0 min-h-0 bg-gray-800 rounded-lg overflow-hidden relative">
        <SampleSpaceView
          hideFilter={true}
          externalFilterState={filterState}
          selectedSliceId={selectedSliceId}
          onSliceSelect={handleSpaceSelect}
          externalWeights={weights}
          onWeightsChange={setWeights}
          externalReductionMethod={reductionMethod}
          onReductionMethodChange={setReductionMethod}
          externalClusterMethod={clusterMethod}
          onClusterMethodChange={setClusterMethod}
          externalClusterCount={clusterCount}
          onClusterCountChange={setClusterCount}
          externalDbscanEpsilon={dbscanEpsilon}
          onDbscanEpsilonChange={setDbscanEpsilon}
        />

        {/* Toggle buttons for medium screens - pushed by panels */}
        {isMediumScreen && (
          <>
            {/* Left toggle - Filter Panel (arrow points right, rotates when open) */}
            <button
              onClick={() => setShowFilterPanel(!showFilterPanel)}
              className="absolute top-1/2 -translate-y-1/2 z-50 p-2 rounded-lg bg-gray-800/80 text-gray-400 hover:text-white hover:bg-gray-700/90 backdrop-blur-sm transition-all duration-300 ease-out"
              style={{
                left: showFilterPanel ? 'calc(280px + 0.5rem)' : '0.5rem',
              }}
              title="Toggle filters"
            >
              <ChevronRight
                size={18}
                className={`transition-transform duration-300 ${showFilterPanel ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Right toggle - Sample List (arrow points left, rotates when open) */}
            <button
              onClick={() => setShowListPanel(!showListPanel)}
              className="absolute top-1/2 -translate-y-1/2 z-50 p-2 rounded-lg bg-gray-800/80 text-gray-400 hover:text-white hover:bg-gray-700/90 backdrop-blur-sm transition-all duration-300 ease-out"
              style={{
                right: showListPanel ? 'calc(320px + 0.5rem)' : '0.5rem',
              }}
              title="Toggle sample list"
            >
              <ChevronLeft
                size={18}
                className={`transition-transform duration-300 ${showListPanel ? 'rotate-180' : ''}`}
              />
            </button>
          </>
        )}

        {/* Backdrop overlay when panels are open on medium screens - click to close */}
        {isMediumScreen && (showFilterPanel || showListPanel) && (
          <div
            className="absolute inset-0 bg-black/20 z-20 transition-opacity duration-300 cursor-pointer"
            onClick={() => {
              setShowFilterPanel(false)
              setShowListPanel(false)
            }}
          />
        )}
      </div>

      {/* Right: Sample List - fixed on large screens, overlay on medium */}
      <div
        className={`
          panel-surface
          ${isMediumScreen
            ? `absolute right-0 top-0 bottom-0 z-40 transition-transform duration-300 ease-out bg-gray-900 shadow-2xl ${
                showListPanel ? 'translate-x-0' : 'translate-x-full'
              }`
            : 'relative'
          }
          w-[320px] flex-shrink-0 min-h-0
        `}
      >
        <div className="h-full">
          {(!isMediumScreen || showListPanel) && (
            <SampleListPanel
              slices={filteredSlices}
              isLoading={slicesLoading}
              isEditMode={isEditMode}
              selectedSliceId={selectedSliceId}
              onSliceSelect={handleListSelect}
              onToggleEditMode={() => setIsEditMode(!isEditMode)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
