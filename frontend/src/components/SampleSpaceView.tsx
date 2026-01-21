import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Play, Pause, Info, AlertCircle } from 'lucide-react'
import { getSliceFeatures, getSliceDownloadUrl } from '../api/client'
import { WebGLScatter } from './WebGLScatter'
import { FeatureWeightsPanel } from './FeatureWeightsPanel'
import { buildFeatureMatrix, DEFAULT_WEIGHTS } from '../utils/featureMatrix'
import { useDimensionReduction, type ReductionMethod } from '../hooks/useDimensionReduction'
import { useClustering, getClusterColor, type ClusterMethod } from '../hooks/useClustering'
import type { FeatureWeights, SamplePoint } from '../types'

export function SampleSpaceView() {
  // Feature weights state
  const [weights, setWeights] = useState<FeatureWeights>(DEFAULT_WEIGHTS)

  // Reduction settings
  const [reductionMethod, setReductionMethod] = useState<ReductionMethod>('umap')

  // Clustering settings
  const [clusterMethod, setClusterMethod] = useState<ClusterMethod>('dbscan')
  const [clusterCount, setClusterCount] = useState(5)
  const [dbscanEpsilon, setDbscanEpsilon] = useState(0.15)

  // Hover/selection state
  const [hoveredPoint, setHoveredPoint] = useState<SamplePoint | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  // Audio playback
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Container sizing
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 600, height: 500 })

  // Fetch audio features
  const { data: features, isLoading, error } = useQuery({
    queryKey: ['sliceFeatures'],
    queryFn: getSliceFeatures,
  })

  // Build feature matrix from data
  const { matrix, validIndices } = useMemo(() => {
    if (!features || features.length === 0) {
      return { matrix: [], validIndices: [] }
    }
    return buildFeatureMatrix(features, weights)
  }, [features, weights])

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
    if (!features || reducedPoints.length === 0) return []

    return reducedPoints.map((point, idx) => {
      const originalIdx = validIndices[idx]
      const feature = features[originalIdx]
      return {
        id: feature.id,
        name: feature.name,
        x: point[0],
        y: point[1],
        cluster: clusters[idx] ?? 0,
        features: feature,
      }
    })
  }, [features, reducedPoints, validIndices, clusters])

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

  // Play sample
  const playPoint = useCallback((point: SamplePoint) => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    if (playingId === point.id) {
      setPlayingId(null)
      return
    }

    const audio = new Audio(getSliceDownloadUrl(point.id))
    audio.onended = () => setPlayingId(null)
    audio.onerror = () => setPlayingId(null)
    audio.play().catch(() => setPlayingId(null))
    audioRef.current = audio
    setPlayingId(point.id)
  }, [playingId])

  // Cleanup audio
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
      }
    }
  }, [])

  // Render loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-800 rounded-lg">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
        <span className="ml-3 text-gray-400">Loading audio features...</span>
      </div>
    )
  }

  // Render error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-800 rounded-lg">
        <AlertCircle className="text-red-500" size={32} />
        <span className="ml-3 text-red-400">Failed to load audio features</span>
      </div>
    )
  }

  // Render empty state
  if (!features || features.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 bg-gray-800 rounded-lg text-gray-400">
        <Info size={48} className="mb-4 opacity-50" />
        <p className="text-lg">No analyzed samples found</p>
        <p className="text-sm mt-2">Create slices and run audio analysis to visualize them here</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      {/* Left Panel - Controls */}
      <div className="lg:col-span-1">
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

        {/* Stats */}
        <div className="mt-4 bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Statistics</h3>
          <div className="space-y-1 text-xs text-gray-400">
            <div className="flex justify-between">
              <span>Samples:</span>
              <span className="text-white">{samplePoints.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Clusters:</span>
              <span className="text-white">{actualClusterCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Selected:</span>
              <span className="text-white">{selectedIds.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Visualization */}
      <div className="lg:col-span-3 space-y-4">
        {/* Scatter Plot */}
        <div
          ref={containerRef}
          className="bg-gray-800 rounded-lg overflow-hidden relative"
          style={{ minHeight: 500 }}
        >
          {isReducing && (
            <div className="absolute inset-0 bg-gray-900/50 flex items-center justify-center z-10">
              <Loader2 className="animate-spin text-indigo-500" size={32} />
              <span className="ml-3 text-gray-300">Computing projection...</span>
            </div>
          )}
          {reduceError && (
            <div className="absolute top-4 left-4 bg-red-900/80 text-red-200 px-3 py-2 rounded text-sm z-10">
              {reduceError}
            </div>
          )}
          <WebGLScatter
            points={samplePoints}
            onPointHover={setHoveredPoint}
            onPointClick={playPoint}
            onSelectionChange={setSelectedIds}
            width={dimensions.width}
            height={dimensions.height}
          />
        </div>

        {/* Hover Info Panel */}
        {hoveredPoint && (
          <div className="bg-gray-800 rounded-lg p-4 flex items-center gap-4">
            <button
              onClick={() => playPoint(hoveredPoint)}
              className={`p-3 rounded-full transition-colors ${
                playingId === hoveredPoint.id
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {playingId === hoveredPoint.id ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <div className="flex-1">
              <div className="font-medium text-white">{hoveredPoint.name}</div>
              <div className="text-sm text-gray-400 flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getClusterColor(hoveredPoint.cluster) }}
                />
                Cluster {hoveredPoint.cluster + 1}
                {hoveredPoint.features.bpm && (
                  <span className="ml-4">{Math.round(hoveredPoint.features.bpm)} BPM</span>
                )}
                {hoveredPoint.features.duration && (
                  <span className="ml-4">{hoveredPoint.features.duration.toFixed(2)}s</span>
                )}
              </div>
            </div>
            <div className="text-xs text-gray-500 grid grid-cols-2 gap-x-4 gap-y-1">
              {hoveredPoint.features.spectralCentroid && (
                <>
                  <span>Brightness:</span>
                  <span>{Math.round(hoveredPoint.features.spectralCentroid)} Hz</span>
                </>
              )}
              {hoveredPoint.features.rmsEnergy && (
                <>
                  <span>Energy:</span>
                  <span>{hoveredPoint.features.rmsEnergy.toFixed(3)}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Clusters</h3>
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: actualClusterCount }, (_, i) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getClusterColor(i) }}
                />
                <span className="text-xs text-gray-400">
                  Cluster {i + 1} ({samplePoints.filter((p) => p.cluster === i).length})
                </span>
              </div>
            ))}
            {clusterMethod === 'dbscan' && samplePoints.some((p) => p.cluster < 0) && (
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getClusterColor(-1) }}
                />
                <span className="text-xs text-gray-400">
                  Noise ({samplePoints.filter((p) => p.cluster < 0).length})
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
