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
import { getRelatedKeys, getRelatedNotes, freqToNoteName } from '../utils/musicTheory'
import AudioManager from '../services/AudioManager'
import { prepareSamplePreviewPlayback } from '../services/samplePreviewPlayback'
import type { FeatureWeights, NormalizationMethod, SamplePoint, SliceFilterState, AudioFeaturesWithMetadata } from '../types'
import type { AudioFilterState } from './SourcesAudioFilter'
import type { TunePlaybackMode } from '../utils/tunePlaybackMode'

interface SampleSpaceViewProps {
  hideFilter?: boolean
  externalFilterState?: SliceFilterState
  externalAudioFilter?: AudioFilterState
  tuneTargetNote?: string | null
  tunePlaybackMode?: TunePlaybackMode
  /**
   * Optional source-of-truth slice ids from parent (e.g. SourcesView).
   * When provided, SampleSpaceView mirrors that already-filtered sample set
   * instead of re-applying filters that may rely on fields unavailable in
   * /slices/features payloads.
   */
  externalSliceIds?: number[]
  selectedSliceId?: number | null
  onSliceSelect?: (id: number | null) => void
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
  hideFilter: _hideFilter,
  externalFilterState,
  externalAudioFilter,
  tuneTargetNote = null,
  tunePlaybackMode: _tunePlaybackMode = 'tape',
  externalSliceIds,
  selectedSliceId: externalSelectedId,
  onSliceSelect,
  externalWeights: _externalWeights,
  onWeightsChange: _onWeightsChange,
  externalReductionMethod: _externalReductionMethod,
  onReductionMethodChange: _onReductionMethodChange,
  externalClusterMethod: _externalClusterMethod,
  onClusterMethodChange: _onClusterMethodChange,
  externalClusterCount: _externalClusterCount,
  onClusterCountChange: _onClusterCountChange,
  externalDbscanEpsilon: _externalDbscanEpsilon,
  onDbscanEpsilonChange: _onDbscanEpsilonChange,
}: SampleSpaceViewProps = {}) {
  // Feature weights state
  const [weights, setWeights] = useState<FeatureWeights>(DEFAULT_WEIGHTS)
  const [reductionMethod, setReductionMethod] = useState<ReductionMethod>('umap')
  const [clusterMethod, setClusterMethod] = useState<ClusterMethod>('kmeans')
  const [clusterCount, setClusterCount] = useState(7)
  const [dbscanEpsilon, setDbscanEpsilon] = useState(0.15)
  const [normalizationMethod, setNormalizationMethod] = useState<NormalizationMethod>('robust')
  const [hdbscanMinClusterSize, setHdbscanMinClusterSize] = useState(5)

  // Selection state
  const [selectedPoint, setSelectedPoint] = useState<SamplePoint | null>(null)
  const [_selectedIds, setSelectedIds] = useState<number[]>([])

  // Sidebar state for small screens
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [isSmallScreen, setIsSmallScreen] = useState(false)

  // Audio playback
  const audioManagerRef = useRef<AudioManager>(AudioManager.getInstance())

  // Container sizing
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 600, height: 500 })

  // Fetch learned weights for ML Optimized preset
  const { data: learnedWeightsData } = useQuery({
    queryKey: ['learnedWeights'],
    queryFn: async () => {
      const res = await fetch('/api/weights/learned')
      if (!res.ok) return null
      const data = await res.json()
      return data.weights as FeatureWeights
    },
    retry: false,
  })

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
    const hasExternalSliceIds = Array.isArray(externalSliceIds)

    let filtered: AudioFeaturesWithMetadata[] = hasExternalSliceIds
      ? (() => {
          const allowed = new Set(externalSliceIds)
          return enrichedFeatures.filter((item) => allowed.has(item.id))
        })()
      : externalFilterState
        ? applySliceFilters(enrichedFeatures, externalFilterState)
        : enrichedFeatures

    // If the parent already provides the exact filtered ids, do not re-apply
    // audio filters here. Re-filtering can diverge when some optional fields
    // (e.g. fundamentalFrequency in certain backend payloads) are missing.
    if (externalAudioFilter && !hasExternalSliceIds) {
      const af = externalAudioFilter

      // Compute effective keys (selected + related levels)
      const effectiveKeys = (() => {
        const keys = [...af.selectedKeys]
        if (af.relatedKeysLevels.length > 0) {
          for (const group of getRelatedKeys(af.selectedKeys)) {
            if (af.relatedKeysLevels.includes(group.level)) keys.push(...group.keys)
          }
        }
        return keys
      })()

      // Compute effective notes (selected + related levels)
      const effectiveNotes = (() => {
        const notes = [...(af.selectedNotes || [])]
        if ((af.relatedNotesLevels || []).length > 0) {
          for (const group of getRelatedNotes(af.selectedNotes || [])) {
            if ((af.relatedNotesLevels || []).includes(group.level)) notes.push(...group.keys)
          }
        }
        return notes
      })()

      filtered = filtered.filter(item => {
        // BPM filter
        if (af.minBpm > 0 || af.maxBpm < 300) {
          if (item.bpm == null) return false
          if (item.bpm < af.minBpm || item.bpm > af.maxBpm) return false
        }

        // Key filter (scale mode) - case-insensitive to match backend behaviour
        if (af.pitchFilterMode === 'scale' && effectiveKeys.length > 0) {
          const keyLower = item.keyEstimate?.toLowerCase()
          if (!keyLower || !effectiveKeys.some(k => k.toLowerCase() === keyLower)) return false
        }

        // Note filter (fundamental frequency mode)
        if (af.pitchFilterMode === 'fundamental' && effectiveNotes.length > 0) {
          const noteName = item.fundamentalFrequency ? freqToNoteName(item.fundamentalFrequency) : null
          if (!noteName || !effectiveNotes.includes(noteName)) return false
        }

        // Envelope type filter
        if (af.selectedEnvelopeTypes.length > 0) {
          if (!item.envelopeType || !af.selectedEnvelopeTypes.includes(item.envelopeType)) return false
        }

        // Instrument filter
        if (af.selectedInstruments.length > 0) {
          const instrType = item.instrumentType || item.instrumentPrimary
          if (!instrType || !af.selectedInstruments.includes(instrType)) return false
        }

        // Genre filter
        if (af.selectedGenres.length > 0) {
          if (!item.genrePrimary || !af.selectedGenres.includes(item.genrePrimary)) return false
        }

        // Perceptual feature filters
        if (af.minBrightness > 0 || af.maxBrightness < 1) {
          if (item.brightness == null) return false
          if (item.brightness < af.minBrightness || item.brightness > af.maxBrightness) return false
        }
        if (af.minWarmth > 0 || af.maxWarmth < 1) {
          if (item.warmth == null) return false
          if (item.warmth < af.minWarmth || item.warmth > af.maxWarmth) return false
        }
        if (af.minHardness > 0 || af.maxHardness < 1) {
          if (item.hardness == null) return false
          if (item.hardness < af.minHardness || item.hardness > af.maxHardness) return false
        }

        // Date added filter
        if (af.dateAddedFrom || af.dateAddedTo) {
          const dateAdded = item.dateAdded
          if (!dateAdded) return false
          if (af.dateAddedFrom && dateAdded < af.dateAddedFrom) return false
          if (af.dateAddedTo && dateAdded > af.dateAddedTo + 'T23:59:59') return false
        }

        // Date created filter
        if (af.dateCreatedFrom || af.dateCreatedTo) {
          const dateCreated = item.dateCreated
          if (!dateCreated) return false
          if (af.dateCreatedFrom && dateCreated < af.dateCreatedFrom) return false
          if (af.dateCreatedTo && dateCreated > af.dateCreatedTo + 'T23:59:59') return false
        }

        // Date updated filter
        if (af.dateUpdatedFrom || af.dateUpdatedTo) {
          const dateUpdated = item.dateModified
          if (!dateUpdated) return false
          if (af.dateUpdatedFrom && dateUpdated < af.dateUpdatedFrom) return false
          if (af.dateUpdatedTo && dateUpdated > af.dateUpdatedTo + 'T23:59:59') return false
        }

        return true
      })
    }

    return filtered
  }, [externalFilterState, externalAudioFilter, enrichedFeatures, externalSliceIds])

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
    return buildFeatureMatrix(filteredFeatures, weights, normalizationMethod, {
      tags: {
        enabled: true,
        weight: 1.8,
        excludeDerived: true,
      },
    })
  }, [filteredFeatures, weights, normalizationMethod])

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
      minClusterSize: hdbscanMinClusterSize,
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
      const nextIsSmallScreen = window.innerWidth < 1200
      setIsSmallScreen(nextIsSmallScreen)
      if (!nextIsSmallScreen) {
        setIsPanelOpen(false)
      }
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

    const sample = allSlices?.find((slice) => slice.id === point.id)

    if (!sample) {
      audioManager.play(point.id, getSliceDownloadUrl(point.id), { playbackRate: 1 })
      return
    }

    const { url, playbackRate } = prepareSamplePreviewPlayback(sample, tuneTargetNote)
    audioManager.play(point.id, url, { playbackRate })
  }, [allSlices, tuneTargetNote])

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
      {isSmallScreen && isPanelOpen && (
        <button
          type="button"
          aria-label="Close controls panel"
          className="panel-surface absolute inset-0 z-20 bg-surface-base/20"
          onClick={() => setIsPanelOpen(false)}
          onMouseMove={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
        />
      )}

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

          {isSmallScreen && (
            <button
              type="button"
              aria-controls="sample-space-controls-panel"
              aria-expanded={isPanelOpen}
              onClick={() => setIsPanelOpen((prev) => !prev)}
              onMouseMove={(event) => event.stopPropagation()}
              onPointerMove={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="panel-surface absolute top-3 right-3 z-40 rounded-md border border-surface-border bg-surface-raised/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:text-white hover:bg-surface-overlay transition-colors"
            >
              {isPanelOpen ? 'Close Controls' : 'Open Controls'}
            </button>
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
                {(clusterMethod === 'dbscan' || clusterMethod === 'hdbscan') && samplePoints.some((p) => p.cluster < 0) && (
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

        {/* Selected Detail Panel - Below Canvas (hidden when parent handles selection) */}
        {selectedPoint && !onSliceSelect && (() => {
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
                isPanelOpen
                  ? 'translate-x-0 bg-surface-raised border-surface-border shadow-2xl pointer-events-auto'
                  : 'translate-x-full bg-surface-raised border-surface-border pointer-events-none'
              }`
            : 'w-80 relative flex-shrink-0 bg-surface-raised border-surface-border'
        } panel-surface`}
        id="sample-space-controls-panel"
        onMouseMove={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
      >
        <div className="p-4">
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
            normalizationMethod={normalizationMethod}
            onNormalizationMethodChange={setNormalizationMethod}
            hdbscanMinClusterSize={hdbscanMinClusterSize}
            onHdbscanMinClusterSizeChange={setHdbscanMinClusterSize}
            learnedWeights={learnedWeightsData ?? null}
          />
        </div>
      </div>

    </div>
  )
}
