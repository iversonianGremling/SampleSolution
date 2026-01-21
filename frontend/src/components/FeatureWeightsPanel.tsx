import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { FeatureWeights } from '../types'
import { FEATURE_GROUPS, FEATURE_LABELS, DEFAULT_WEIGHTS } from '../utils/featureMatrix'
import type { ReductionMethod } from '../hooks/useDimensionReduction'
import type { ClusterMethod } from '../hooks/useClustering'

interface FeatureWeightsPanelProps {
  weights: FeatureWeights
  onWeightsChange: (weights: FeatureWeights) => void
  reductionMethod: ReductionMethod
  onReductionMethodChange: (method: ReductionMethod) => void
  clusterMethod: ClusterMethod
  onClusterMethodChange: (method: ClusterMethod) => void
  clusterCount: number
  onClusterCountChange: (count: number) => void
  dbscanEpsilon: number
  onDbscanEpsilonChange: (epsilon: number) => void
}

export function FeatureWeightsPanel({
  weights,
  onWeightsChange,
  reductionMethod,
  onReductionMethodChange,
  clusterMethod,
  onClusterMethodChange,
  clusterCount,
  onClusterCountChange,
  dbscanEpsilon,
  onDbscanEpsilonChange,
}: FeatureWeightsPanelProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['spectral', 'energy']))

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) {
        next.delete(group)
      } else {
        next.add(group)
      }
      return next
    })
  }

  const handleWeightChange = (feature: keyof FeatureWeights, value: number) => {
    onWeightsChange({ ...weights, [feature]: value })
  }

  const resetWeights = () => {
    onWeightsChange(DEFAULT_WEIGHTS)
  }

  const setAllWeights = (value: number) => {
    const newWeights = { ...weights }
    for (const key of Object.keys(weights) as (keyof FeatureWeights)[]) {
      newWeights[key] = value
    }
    onWeightsChange(newWeights)
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">
      {/* Reduction Method */}
      <div>
        <label className="text-sm font-medium text-gray-300 block mb-2">
          Projection Method
        </label>
        <div className="flex gap-2">
          {(['umap', 'tsne', 'pca'] as ReductionMethod[]).map((method) => (
            <button
              key={method}
              onClick={() => onReductionMethodChange(method)}
              className={`px-3 py-1.5 text-sm rounded transition-colors ${
                reductionMethod === method
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {method.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Clustering */}
      <div>
        <label className="text-sm font-medium text-gray-300 block mb-2">
          Clustering
        </label>
        <div className="flex gap-2 mb-2">
          {(['dbscan', 'kmeans'] as ClusterMethod[]).map((method) => (
            <button
              key={method}
              onClick={() => onClusterMethodChange(method)}
              className={`px-3 py-1.5 text-sm rounded transition-colors ${
                clusterMethod === method
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {method === 'dbscan' ? 'DBSCAN' : 'K-Means'}
            </button>
          ))}
        </div>
        {clusterMethod === 'kmeans' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Clusters:</span>
            <input
              type="range"
              min={2}
              max={12}
              value={clusterCount}
              onChange={(e) => onClusterCountChange(parseInt(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs text-gray-300 w-6">{clusterCount}</span>
          </div>
        )}
        {clusterMethod === 'dbscan' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Density:</span>
            <input
              type="range"
              min={0.05}
              max={0.5}
              step={0.01}
              value={dbscanEpsilon}
              onChange={(e) => onDbscanEpsilonChange(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs text-gray-300 w-10">{dbscanEpsilon.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Feature Weights Header */}
      <div className="flex items-center justify-between border-t border-gray-700 pt-4">
        <h3 className="text-sm font-medium text-gray-300">Feature Weights</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setAllWeights(0)}
            className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700"
          >
            All Off
          </button>
          <button
            onClick={() => setAllWeights(1)}
            className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700"
          >
            All On
          </button>
          <button
            onClick={resetWeights}
            className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700"
            title="Reset to defaults"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {/* Feature Groups */}
      {Object.entries(FEATURE_GROUPS).map(([groupKey, group]) => (
        <div key={groupKey} className="border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleGroup(groupKey)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-750 hover:bg-gray-700 transition-colors"
          >
            <span className="text-sm font-medium text-gray-200">{group.label}</span>
            {expandedGroups.has(groupKey) ? (
              <ChevronDown size={16} className="text-gray-400" />
            ) : (
              <ChevronRight size={16} className="text-gray-400" />
            )}
          </button>
          {expandedGroups.has(groupKey) && (
            <div className="px-3 py-2 space-y-2 bg-gray-800/50">
              {group.features.map((feature) => (
                <div key={feature} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-28 truncate" title={FEATURE_LABELS[feature as keyof FeatureWeights]}>
                    {FEATURE_LABELS[feature as keyof FeatureWeights]}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={weights[feature as keyof FeatureWeights]}
                    onChange={(e) =>
                      handleWeightChange(feature as keyof FeatureWeights, parseFloat(e.target.value))
                    }
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-300 w-8 text-right">
                    {weights[feature as keyof FeatureWeights].toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
