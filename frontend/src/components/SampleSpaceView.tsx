import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Info, AlertCircle, ChevronDown } from 'lucide-react'
import { getSliceFeatures, getSliceDownloadUrl } from '../api/client'
import { WebGLScatter } from './WebGLScatter'
import { SliceFilterPanel } from './SliceFilterPanel'
import { SliceDetailPanel } from './SliceDetailPanel'
import { buildFeatureMatrix, DEFAULT_WEIGHTS } from '../utils/featureMatrix'
import { useDimensionReduction, type ReductionMethod } from '../hooks/useDimensionReduction'
import { useClustering, getClusterColor, type ClusterMethod } from '../hooks/useClustering'
import { useAllSlices, useTags, useCollections, useCreateCollection } from '../hooks/useTracks'
import { useFilteredSlices } from '../hooks/useSliceFilters'
import { enrichAudioFeatures } from '../utils/enrichAudioFeatures'
import { applySliceFilters } from '../utils/sliceFilters'
import AudioManager from '../services/AudioManager'
import type { FeatureWeights, SamplePoint, SliceFilterState } from '../types'

interface SampleSpaceViewProps {
  hideFilter?: boolean
  hideDetailPanel?: boolean
  externalFilterState?: SliceFilterState
  selectedSliceId?: number | null
  onSliceSelect?: (id: number | null) => void
  // External weights control
  externalWeights?: FeatureWeights
  onWeightsChange?: (weights: FeatureWeights) => void
  externalReductionMethod?: ReductionMethod
  onReductionMethodChange?: (method: ReductionMethod) => void
  externalClusterMethod?: ClusterMethod
  onClusterMethodChange?: (method: ClusterMethod) => void
  externalClusterCount?: number
  onClusterCountChange?: (count: number) => void
  externalDbscanEpsilon?: number
  onDbscanEpsilonChange?: (epsilon: number) => void
}

export function SampleSpaceView({
  hideFilter = false,
  externalFilterState,
  selectedSliceId: externalSelectedId,
  onSliceSelect,
  externalWeights,
  onWeightsChange,
  externalReductionMethod,
  onReductionMethodChange,
  externalClusterMethod,
  onClusterMethodChange,
  externalClusterCount,
  onClusterCountChange,
  externalDbscanEpsilon,
  onDbscanEpsilonChange,
}: SampleSpaceViewProps = {}) {
  // Feature weights state (internal fallback)
  const [internalWeights, setInternalWeights] = useState<FeatureWeights>(DEFAULT_WEIGHTS)
  const [internalReductionMethod, setInternalReductionMethod] = useState<ReductionMethod>('umap')
  const [internalClusterMethod, setInternalClusterMethod] = useState<ClusterMethod>('kmeans')
  const [internalClusterCount, setInternalClusterCount] = useState(7)
  const [internalDbscanEpsilon, setInternalDbscanEpsilon] = useState(0.15)

  // Use external or internal state
  const weights = externalWeights ?? internalWeights
  const setWeights = onWeightsChange ?? setInternalWeights
  const reductionMethod = externalReductionMethod ?? internalReductionMethod
  const setReductionMethod = onReductionMethodChange ?? setInternalReductionMethod
  const clusterMethod = externalClusterMethod ?? internalClusterMethod
  const setClusterMethod = onClusterMethodChange ?? setInternalClusterMethod
  const clusterCount = externalClusterCount ?? internalClusterCount
  const setClusterCount = onClusterCountChange ?? setInternalClusterCount
  const dbscanEpsilon = externalDbscanEpsilon ?? internalDbscanEpsilon
  const setDbscanEpsilon = onDbscanEpsilonChange ?? setInternalDbscanEpsilon

  // Selection state
  const [selectedPoint, setSelectedPoint] = useState<SamplePoint | null>(null)
  const [_selectedIds, setSelectedIds] = useState<number[]>([])

  // Panel collapse state
  const [openPanel, setOpenPanel] = useState<'filter' | null>(null)
  const [filterAnimState, setFilterAnimState] = useState<'none' | 'in' | 'out'>('none')

  // Audio playback
  const audioManagerRef = useRef<AudioManager>(AudioManager.getInstance())

  // Container sizing
  const containerRef = useRef<HTMLDivElement>(null)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 600, height: 500 })

  // Fetch audio features
  const { data: features, isLoading, error } = useQuery({
    queryKey: ['sliceFeatures'],
    queryFn: getSliceFeatures,
  })

  // Fetch all slices for detail panel
  const { data: allSlices } = useAllSlices()

  // Enrich features with slice metadata for filtering
  const enrichedFeatures = useMemo(() => {
    if (!features || !allSlices) return []
    return enrichAudioFeatures(features, allSlices)
  }, [features, allSlices])

  // Filter controls (only used when not using external filter state)
  const {
    filterState: internalFilterState,
    setSearchQuery,
    setShowFavoritesOnly,
    setSelectedTags,
    setMinDuration,
    setMaxDuration,
    setSelectedCollectionIds,
    maxSliceDuration,
    filteredItems: internalFilteredFeatures,
  } = useFilteredSlices(enrichedFeatures)

  // Use external filter state if provided, otherwise use internal
  const filterState = externalFilterState ?? internalFilterState
  const rawFilteredFeatures = useMemo(() => {
    if (externalFilterState) {
      return applySliceFilters(enrichedFeatures, externalFilterState)
    }
    return internalFilteredFeatures
  }, [externalFilterState, enrichedFeatures, internalFilteredFeatures])

  // Debounced filtered features to avoid rapid updates causing crashes
  const [filteredFeatures, setFilteredFeatures] = useState(rawFilteredFeatures)
  const [isFilteringInProgress, setIsFilteringInProgress] = useState(false)

  useEffect(() => {
    setIsFilteringInProgress(true)
    const timer = setTimeout(() => {
      setFilteredFeatures(rawFilteredFeatures)
      setIsFilteringInProgress(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [rawFilteredFeatures])

  // Fetch tags and collections for filtering
  const { data: allTags } = useTags()
  const { data: allCollections } = useCollections()
  const createCollectionMutation = useCreateCollection()

  // Calculate sample counts for category filters
  const { totalSampleCount, favoriteSampleCount } = useMemo(() => {
    if (!enrichedFeatures || enrichedFeatures.length === 0) {
      return { totalSampleCount: 0, favoriteSampleCount: 0 }
    }
    return {
      totalSampleCount: enrichedFeatures.length,
      favoriteSampleCount: enrichedFeatures.filter(f => f.favorite === true).length,
    }
  }, [enrichedFeatures])

  // Build feature matrix from filtered data
  const { matrix, validIndices } = useMemo(() => {
    if (!filteredFeatures || filteredFeatures.length === 0) {
      return { matrix: [], validIndices: [] }
    }
    // Cast back to AudioFeatures for buildFeatureMatrix
    return buildFeatureMatrix(filteredFeatures as any, weights)
  }, [filteredFeatures, weights])

  // Run dimensionality reduction
  const { points: reducedPoints, isComputing: isReducing, error: reduceError } = useDimensionReduction(
    matrix,
    { method: reductionMethod }
  )

  // Run clustering
  const { clusters, clusterCount: actualClusterCount } = useClustering(
    reducedPoints,
    {
      method: clusterMethod,
      k: clusterCount,
      epsilon: dbscanEpsilon,
    }
  )

  // Combine all data into SamplePoints
  const samplePoints: SamplePoint[] = useMemo(() => {
    if (!filteredFeatures || reducedPoints.length === 0) return []

    return reducedPoints.map((point, idx) => {
      const originalIdx = validIndices[idx]
      const feature = filteredFeatures[originalIdx]
      // Skip if feature is undefined (can happen during filter updates)
      if (!feature) return null as any
      return {
        id: feature.id,
        name: feature.name,
        x: point[0],
        y: point[1],
        cluster: clusters[idx] ?? 0,
        features: feature as any, // Cast to AudioFeatures for compatibility
      }
    }).filter(Boolean) as SamplePoint[]
  }, [filteredFeatures, reducedPoints, validIndices, clusters])

  // Handle container resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setDimensions({
          width: Math.max(400, rect.width),
          height: Math.max(400, rect.height),
        })
      }
    }

    updateDimensions()
    const observer = new ResizeObserver(updateDimensions)
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => observer.disconnect()
  }, [])

  // Handle filter panel animation
  useEffect(() => {
    if (openPanel === 'filter') {
      setFilterAnimState('in')
    } else if (filterAnimState === 'in') {
      setFilterAnimState('out')
      const timer = setTimeout(() => setFilterAnimState('none'), 300)
      return () => clearTimeout(timer)
    }
  }, [openPanel])


  // Play sample
  const playPoint = useCallback((point: SamplePoint) => {
    const audioManager = audioManagerRef.current

    // If already playing this audio, pause it
    if (audioManager.isPlayingId(point.id)) {
      audioManager.pause()
      return
    }

    // If this audio is paused, resume it
    if (audioManager.getCurrentAudioId() === point.id && audioManager.isPaused()) {
      audioManager.resume()
      return
    }

    // Play the audio
    audioManager.play(point.id, getSliceDownloadUrl(point.id))
  }, [])

  // Cleanup audio
  useEffect(() => {
    return () => {
      audioManagerRef.current.stopAll()
    }
  }, [])

  // Sync selection with external state
  useEffect(() => {
    if (externalSelectedId !== undefined) {
      if (externalSelectedId === null) {
        setSelectedPoint(null)
      } else {
        const point = samplePoints.find(p => p.id === externalSelectedId)
        if (point && selectedPoint?.id !== externalSelectedId) {
          setSelectedPoint(point)
        }
      }
    }
  }, [externalSelectedId, samplePoints])

  // Handle point selection - update local state and notify parent
  const handlePointSelect = useCallback((point: SamplePoint | null) => {
    setSelectedPoint(point)
    onSliceSelect?.(point?.id ?? null)
  }, [onSliceSelect])

  // Render loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96 bg-surface-raised rounded-lg">
        <Loader2 className="animate-spin text-accent-primary" size={32} />
        <span className="ml-3 text-slate-400">Loading audio features...</span>
      </div>
    )
  }

  // Render error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-96 bg-surface-raised rounded-lg">
        <AlertCircle className="text-red-400" size={32} />
        <span className="ml-3 text-red-300">Failed to load audio features</span>
      </div>
    )
  }

  // Render empty state
  if (!features || features.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 bg-surface-raised rounded-lg text-slate-400">
        <Info size={48} className="mb-4 opacity-50" />
        <p className="text-lg">No analyzed samples found</p>
        <p className="text-sm mt-2 text-slate-500">Create slices and run audio analysis to visualize them here</p>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden">
      {/* Main Canvas Container */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        {/* Canvas */}
        <div
          ref={containerRef}
          className="w-full h-full bg-surface-base relative"
        >
          {(isReducing || isFilteringInProgress) && (
            <div className="absolute inset-0 bg-surface-base/60 flex items-center justify-center z-20">
              <Loader2 className="animate-spin text-accent-primary" size={32} />
              <span className="ml-3 text-slate-300">
                {isReducing ? 'Computing projection...' : 'Applying filters...'}
              </span>
            </div>
          )}
          {reduceError && (
            <div className="absolute top-4 left-4 bg-red-900/80 text-red-200 px-3 py-2 rounded text-sm z-20">
              {reduceError}
            </div>
          )}
          <WebGLScatter
            points={samplePoints}
            onPointHover={() => {}}
            onPointClick={playPoint}
            onPointSelect={handlePointSelect}
            onSelectionChange={setSelectedIds}
            width={dimensions.width}
            height={dimensions.height}
          />

          {/* Blur overlay when panels are open - with animated transition */}
          <div
            className={`absolute inset-0 pointer-events-none z-20 transition-all duration-300 ease-out ${
              openPanel
                ? 'bg-black/10 backdrop-blur-xs opacity-100'
                : 'bg-transparent backdrop-blur-none opacity-0'
            }`}
          />

          {/* Top Filter Panel - Collapsible (hidden when using external filter) */}
          {!hideFilter && (
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 z-30 pointer-events-none"
              onMouseEnter={() => setOpenPanel('filter')}
              onMouseLeave={() => setOpenPanel(null)}
            >
              {/* Toggle Bar */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 h-6 w-20 flex items-center justify-center cursor-pointer pointer-events-auto z-10">
                <ChevronDown
                  className={`w-4 h-4 text-slate-600/40 hover:text-slate-500/60 transition-all duration-300 ${
                    openPanel === 'filter' ? 'rotate-180' : ''
                  }`}
                  strokeWidth={2}
                />
              </div>

              {/* Filter Panel */}
              {filterAnimState !== 'none' && (
                <div
                  ref={filterPanelRef}
                  className={`panel-surface rounded-b-lg p-3 pt-6 shadow-2xl transition-all duration-300 z-20 pointer-events-auto overflow-y-auto ${
                    filterAnimState === 'in'
                      ? 'opacity-100'
                      : 'opacity-0 pointer-events-none'
                  }`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    width: 'calc(100vw - 2.6rem)',
                    maxHeight: 'calc(100vh - 4rem)',
                    transform: `translateX(-50%) translateY(${filterAnimState === 'in' ? '0' : '-0.5rem'})`,
                  }}
                >
                  <SliceFilterPanel
                    filterState={filterState}
                    onSearchChange={setSearchQuery}
                    onFavoritesChange={setShowFavoritesOnly}
                    onTagFilterChange={setSelectedTags}
                    onDurationChange={(min, max) => {
                      setMinDuration(min)
                      setMaxDuration(max)
                    }}
                    onCollectionChange={setSelectedCollectionIds}
                    onCreateCollection={(name) => createCollectionMutation.mutate({ name })}
                    allTags={allTags}
                    collections={allCollections}
                    maxDuration={maxSliceDuration}
                    totalSampleCount={totalSampleCount}
                    favoriteSampleCount={favoriteSampleCount}
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
                </div>
              )}
            </div>
          )}

          {/* Bottom Information Row - On top of canvas with minimal opacity */}
          <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-surface-base/40 via-surface-base/20 to-transparent p-2.5 pl-4 pr-2">
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="font-mono">
                <span className="text-slate-500">Samples</span>{' '}
                <span className="text-slate-200">{samplePoints.length}</span>
              </span>
              <span className="font-mono">
                <span className="text-slate-500">Clusters</span>{' '}
                <span className="text-slate-200">{actualClusterCount}</span>
              </span>
              <div className="flex items-center gap-2 ml-auto overflow-x-auto max-w-[50%] scrollbar-hide">
                {Array.from({ length: Math.min(actualClusterCount, 8) }, (_, i) => (
                  <div key={i} className="flex items-center gap-1 flex-shrink-0">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getClusterColor(i) }}
                    />
                    <span className="text-slate-400 text-xs whitespace-nowrap">C{i + 1}</span>
                  </div>
                ))}
                {actualClusterCount > 8 && (
                  <span className="text-slate-500 text-xs whitespace-nowrap">+{actualClusterCount - 8}</span>
                )}
                {clusterMethod === 'dbscan' && samplePoints.some((p) => p.cluster < 0) && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getClusterColor(-1) }}
                    />
                    <span className="text-slate-400 text-xs">Noise</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Selected Detail Panel - Outside Canvas */}
      <div className="min-h-0 overflow-y-auto max-h-[40vh]">
        {selectedPoint && (() => {
          const sliceData = allSlices?.find(s => s.id === selectedPoint.id)
          if (!sliceData) {
            return (
              <div className="bg-surface-overlay border-t border-surface-border p-3 text-slate-400 text-sm">
                Loading slice details...
              </div>
            )
          }
          return (
            <SliceDetailPanel
              key={selectedPoint.id * sliceData.id}
              selectedPoint={selectedPoint}
              sliceData={sliceData}
              onClose={() => setSelectedPoint(null)}
            />
          )
        })()}
      </div>
    </div>
  )
}
