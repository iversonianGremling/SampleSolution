import { ChevronDown, ChevronRight, RotateCcw, Settings2 } from 'lucide-react'
import { useState, useEffect } from 'react'
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

interface Preset {
  id: string
  name: string
  description: string
  weights: FeatureWeights
}

const PRESETS: Preset[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Equal weight to all features',
    weights: DEFAULT_WEIGHTS,
  },
  {
    id: 'timbre',
    name: 'Timbre',
    description: 'Spectral characteristics',
    weights: {
      ...DEFAULT_WEIGHTS,
      spectralCentroid: 2,
      spectralRolloff: 2,
      spectralBandwidth: 1.5,
      spectralContrast: 1.5,
      spectralFlux: 1.5,
      spectralFlatness: 1.5,
      zeroCrossingRate: 1.5,
      rmsEnergy: 0.5,
      loudness: 0.5,
      bpm: 0.3,
      onsetCount: 0.3,
    },
  },
  {
    id: 'rhythm',
    name: 'Rhythm',
    description: 'Tempo and onset patterns',
    weights: {
      ...DEFAULT_WEIGHTS,
      bpm: 2,
      onsetCount: 2,
      attackTime: 1.5,
      spectralFlux: 1.5,
      spectralCentroid: 0.5,
      spectralRolloff: 0.5,
      spectralBandwidth: 0.5,
    },
  },
  {
    id: 'energy',
    name: 'Energy',
    description: 'Loudness and dynamics',
    weights: {
      ...DEFAULT_WEIGHTS,
      rmsEnergy: 2,
      loudness: 2,
      dynamicRange: 2,
      attackTime: 1.5,
      spectralCentroid: 0.5,
      spectralRolloff: 0.5,
    },
  },
]

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
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [activePreset, setActivePreset] = useState<string | null>('balanced')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

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

  const handlePresetChange = (preset: Preset) => {
    setActivePreset(preset.id)
    onWeightsChange(preset.weights)
  }

  // Detect if weights match a preset
  useEffect(() => {
    const matchingPreset = PRESETS.find((p) =>
      Object.keys(p.weights).every(
        (k) =>
          Math.abs(
            p.weights[k as keyof FeatureWeights] - weights[k as keyof FeatureWeights]
          ) < 0.01
      )
    )
    setActivePreset(matchingPreset?.id ?? null)
  }, [weights])

  return (
    <div className="space-y-3">

      {/* Presets - Always visible */}
      <div className="pt-2">
        <label className="text-xs font-semibold text-slate-300 block mb-1.5 tracking-wider uppercase">
          Feature Presets
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handlePresetChange(preset)}
              className={`px-2.5 py-2 rounded text-left transition-all ${
                activePreset === preset.id
                  ? 'bg-accent-primary/15 border border-accent-primary/50 text-white'
                  : 'bg-surface-raised border border-transparent text-slate-400 hover:text-white hover:bg-surface-base'
              }`}
            >
              <div className="text-xs font-medium">{preset.name}</div>
              <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">
                {preset.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Advanced Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full flex items-center justify-between py-2 px-2.5 bg-surface-raised rounded hover:bg-surface-base transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings2 size={14} className="text-slate-500" />
          <span className="text-xs text-slate-400">Advanced</span>
        </div>
        <ChevronDown
          size={14}
          className={`text-slate-500 transition-transform duration-200 ${
            showAdvanced ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Advanced Section - Collapsible */}
      {showAdvanced && (
        <div className="space-y-2 animate-slide-down">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-slate-500">
              Fine-tune feature weights
            </span>
            <button
              onClick={resetWeights}
              className="text-[10px] text-slate-500 hover:text-white flex items-center gap-1 transition-colors"
            >
              <RotateCcw size={10} />
              Reset
            </button>
          </div>

          {/* Projection Method */}
          <div className="border border-surface-border rounded p-2.5">
            <label className="text-xs font-medium text-slate-400 block mb-1.5">
              Projection
            </label>
            <div className="flex gap-1">
              {(['umap', 'tsne', 'pca'] as ReductionMethod[]).map((method) => (
                <button
                  key={method}
                  onClick={() => onReductionMethodChange(method)}
                  className={`flex-1 px-1.5 py-1 text-xs rounded transition-colors ${
                    reductionMethod === method
                      ? 'bg-accent-primary text-white'
                      : 'bg-surface-raised text-slate-400 hover:bg-surface-base hover:text-white'
                  }`}
                >
                  {method.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Clustering Method */}
          <div className="border border-surface-border rounded p-2.5">
            <label className="text-xs font-medium text-slate-400 block mb-1.5">
              Clustering
            </label>
            <div className="flex gap-1 mb-2">
              {(['dbscan', 'kmeans'] as ClusterMethod[]).map((method) => (
                <button
                  key={method}
                  onClick={() => onClusterMethodChange(method)}
                  className={`flex-1 px-1.5 py-1 text-xs rounded transition-colors ${
                    clusterMethod === method
                      ? 'bg-accent-primary text-white'
                      : 'bg-surface-raised text-slate-400 hover:bg-surface-base hover:text-white'
                  }`}
                >
                  {method === 'dbscan' ? 'DBSCAN' : 'K-Means'}
                </button>
              ))}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">
                {clusterMethod === 'kmeans' ? 'Clusters' : 'Density'}
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="range"
                  min={clusterMethod === 'kmeans' ? 2 : 0.05}
                  max={clusterMethod === 'kmeans' ? 12 : 0.5}
                  step={clusterMethod === 'kmeans' ? 1 : 0.01}
                  value={clusterMethod === 'kmeans' ? clusterCount : dbscanEpsilon}
                  onChange={(e) =>
                    clusterMethod === 'kmeans'
                      ? onClusterCountChange(parseInt(e.target.value))
                      : onDbscanEpsilonChange(parseFloat(e.target.value))
                  }
                  className="flex-1 h-1 accent-accent-primary"
                />
                <span className="text-xs text-slate-300 w-7 text-right font-mono">
                  {clusterMethod === 'kmeans'
                    ? clusterCount
                    : dbscanEpsilon.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {Object.entries(FEATURE_GROUPS).map(([groupKey, group]) => (
            <div
              key={groupKey}
              className="border border-surface-border rounded overflow-hidden"
            >
              <button
                onClick={() => toggleGroup(groupKey)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 bg-surface-raised hover:bg-surface-base transition-colors"
              >
                <span className="text-xs font-medium text-slate-300">
                  {group.label}
                </span>
                {expandedGroups.has(groupKey) ? (
                  <ChevronDown size={12} className="text-slate-500" />
                ) : (
                  <ChevronRight size={12} className="text-slate-500" />
                )}
              </button>
              {expandedGroups.has(groupKey) && (
                <div className="px-2.5 py-2 space-y-1.5 bg-surface-base/50">
                  {group.features.map((feature) => (
                    <div key={feature} className="flex items-center gap-2">
                      <span
                        className="text-[10px] text-slate-500 w-20 truncate"
                        title={FEATURE_LABELS[feature as keyof FeatureWeights]}
                      >
                        {FEATURE_LABELS[feature as keyof FeatureWeights]}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={weights[feature as keyof FeatureWeights]}
                        onChange={(e) =>
                          handleWeightChange(
                            feature as keyof FeatureWeights,
                            parseFloat(e.target.value)
                          )
                        }
                        className="flex-1 h-1 accent-accent-primary"
                      />
                      <span className="text-[10px] text-slate-400 w-5 text-right font-mono">
                        {weights[feature as keyof FeatureWeights].toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
