import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Info, AlertCircle } from 'lucide-react'
import { getSliceFeatures, getSliceDownloadUrl } from '../api/client'
import { WebGLScatter } from './WebGLScatter'
import { FeatureWeightsPanel } from './FeatureWeightsPanel'
import { SliceDetailPanel } from './SliceDetailPanel'
import { buildFeatureMatrix, DEFAULT_WEIGHTS } from '../utils/featureMatrix'
import { useDimensionReduction, type ReductionMethod } from '../hooks/useDimensionReduction'
import { useClustering, getClusterColor, type ClusterMethod } from '../hooks/useClustering'
import { useAllSlices } from '../hooks/useTracks'
import { enrichAudioFeatures } from '../utils/enrichAudioFeatures'
import { applySliceFilters } from '../utils/sliceFilters'
import AudioManager from '../services/AudioManager'
import type { FeatureWeights, SamplePoint, SliceFilterState } from '../types'

interface SampleSpaceViewProps {
  externalFilterState?: SliceFilterState
  selectedSliceId?: number | null
  onSliceSelect?: (id: number | null) => void
}

export function SampleSpaceView({
  externalFilterState,
  selectedSliceId: externalSelectedId,
  onSliceSelect,
}: SampleSpaceViewProps = {}) {
  // Feature weights state
  const [weights, setWeights] = useState<FeatureWeights>(DEFAULT_WEIGHTS)
  const [reductionMethod, setReductionMethod] = useState<ReductionMethod>('umap')
  const [clusterMethod, setClusterMethod] = useState<ClusterMethod>('kmeans')
  const [clusterCount, setClusterCount] = useState(7)
  const [dbscanEpsilon, setDbscanEpsilon] = useState(0.15)

  // Selection state
  const [selectedPoint, setSelectedPoint] = useState<SamplePoint | null>(null)
  const [_selectedIds, setSelectedIds] = useState<number[]>([])

  // Sidebar hover state for small screens
  const [isPanelHovered, setIsPanelHovered] = useState(false)
  const [isSmallScreen, setIsSmallScreen] = useState(false)

  // Audio playback
  const audioManagerRef = useRef<AudioManager>(AudioManager.getInstance())

  // Container sizing
  const containerRef = useRef<HTMLDivElement>(null)
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

  // Apply external filter state
  const rawFilteredFeatures = useMemo(() => {
    if (externalFilterState) {
      return applySliceFilters(enrichedFeatures, externalFilterState)
    }
    return enrichedFeatures
  }, [externalFilterState, enrichedFeatures])

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

  // Handle container resize and screen size detection
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setDimensions({
          width: Math.max(400, rect.width),
          height: Math.max(400, rect.height),
        })
      }
      // Check if screen is small (less than 2/3rds of typical desktop width)
      setIsSmallScreen(window.innerWidth < 1200)
    }

    updateDimensions()
    const observer = new ResizeObserver(updateDimensions)
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    // Listen for window resize
    window.addEventListener('resize', updateDimensions)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateDimensions)
    }
  }, [])



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
    <div className="relative w-full h-full flex overflow-hidden">
      {/* Main Canvas Container */}
      <div className="flex-1 relative overflow-hidden min-h-0">
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
            selectedId={selectedPoint?.id ?? null}
            width={dimensions.width}
            height={dimensions.height}
          />


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

        {/* Selected Detail Panel - Below Canvas */}
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
              onClose={() => handlePointSelect(null)}
            />
          )
        })()}
      </div>

      {/* Right Sidebar - Controls Panel */}
      <div
        className={`border-l overflow-y-auto transition-all duration-300 ${
          isSmallScreen
            ? `absolute right-0 top-0 bottom-0 z-30 w-80 ${
                isPanelHovered
                  ? 'translate-x-0 bg-surface-raised border-surface-border'
                  : 'translate-x-72 bg-transparent border-transparent'
              }`
            : 'w-80 relative flex-shrink-0 bg-surface-raised border-surface-border'
        }`}
        onMouseEnter={() => isSmallScreen && setIsPanelHovered(true)}
        onMouseLeave={() => isSmallScreen && setIsPanelHovered(false)}
      >
        {/* Toggle indicator for small screens */}
        {isSmallScreen && !isPanelHovered && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M7 15l5-5-5-5v10z"/>
            </svg>
          </div>
        )}

        <div className={`p-4 ${isSmallScreen && !isPanelHovered ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}>
          <FeatureWeightsPanel
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
      </div>

    </div>
  )
}
