import type { AudioFilterState } from './SourcesAudioFilter'

export type DimensionCategory = 'spectral' | 'energy' | 'texture' | 'space'

type DimensionFieldKey =
  | 'minBrightness'
  | 'maxBrightness'
  | 'minNoisiness'
  | 'maxNoisiness'
  | 'minAttack'
  | 'maxAttack'
  | 'minDynamics'
  | 'maxDynamics'
  | 'minSaturation'
  | 'maxSaturation'
  | 'minSurface'
  | 'maxSurface'
  | 'minRhythmic'
  | 'maxRhythmic'
  | 'minDensity'
  | 'maxDensity'
  | 'minAmbience'
  | 'maxAmbience'
  | 'minStereoWidth'
  | 'maxStereoWidth'
  | 'minDepth'
  | 'maxDepth'

type DimensionFieldPair = {
  label: string
  minKey: DimensionFieldKey
  maxKey: DimensionFieldKey
}

const DIMENSIONS_BY_CATEGORY: Record<DimensionCategory, DimensionFieldPair[]> = {
  spectral: [
    { label: 'Brightness', minKey: 'minBrightness', maxKey: 'maxBrightness' },
    { label: 'Noisiness', minKey: 'minNoisiness', maxKey: 'maxNoisiness' },
  ],
  energy: [
    { label: 'Attack', minKey: 'minAttack', maxKey: 'maxAttack' },
    { label: 'Dynamics', minKey: 'minDynamics', maxKey: 'maxDynamics' },
    { label: 'Saturation', minKey: 'minSaturation', maxKey: 'maxSaturation' },
  ],
  texture: [
    { label: 'Surface', minKey: 'minSurface', maxKey: 'maxSurface' },
    { label: 'Rhythmic', minKey: 'minRhythmic', maxKey: 'maxRhythmic' },
    { label: 'Density', minKey: 'minDensity', maxKey: 'maxDensity' },
  ],
  space: [
    { label: 'Ambience', minKey: 'minAmbience', maxKey: 'maxAmbience' },
    { label: 'Stereo Width', minKey: 'minStereoWidth', maxKey: 'maxStereoWidth' },
    { label: 'Depth', minKey: 'minDepth', maxKey: 'maxDepth' },
  ],
}

interface SourcesDimensionFilterProps {
  category: DimensionCategory
  filterState: AudioFilterState
  onChange: (next: AudioFilterState) => void
}

const HANDLE_OVERLAP_THRESHOLD = 0.02

const toRangeValue = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : fallback

function getMinValue(state: AudioFilterState, key: DimensionFieldKey): number {
  return toRangeValue(state[key] as number | undefined, 0)
}

function getMaxValue(state: AudioFilterState, key: DimensionFieldKey): number {
  return toRangeValue(state[key] as number | undefined, 1)
}

export function SourcesDimensionFilter({
  category,
  filterState,
  onChange,
}: SourcesDimensionFilterProps) {
  const dimensions = DIMENSIONS_BY_CATEGORY[category]

  const setRangeValue = (
    minKey: DimensionFieldKey,
    maxKey: DimensionFieldKey,
    which: 'min' | 'max',
    value: number,
  ) => {
    const clamped = Math.max(0, Math.min(1, value))
    const currentMin = getMinValue(filterState, minKey)
    const currentMax = getMaxValue(filterState, maxKey)
    const nextMin = which === 'min' ? Math.min(clamped, currentMax) : currentMin
    const nextMax = which === 'max' ? Math.max(clamped, currentMin) : currentMax

    onChange({
      ...filterState,
      [minKey]: nextMin,
      [maxKey]: nextMax,
    })
  }

  const resetCategory = () => {
    const next: AudioFilterState = { ...filterState }
    for (const dimension of dimensions) {
      next[dimension.minKey] = 0
      next[dimension.maxKey] = 1
    }
    if (category === 'space') {
      next.stereoChannelMode = 'all'
    }
    onChange(next)
  }

  const hasActiveFilters = dimensions.some((dimension) => {
    const min = getMinValue(filterState, dimension.minKey)
    const max = getMaxValue(filterState, dimension.maxKey)
    return min > 0 || max < 1
  }) || (category === 'space' && (filterState.stereoChannelMode ?? 'all') !== 'all')

  return (
    <div className="space-y-3">
      {dimensions.map((dimension) => {
        const min = getMinValue(filterState, dimension.minKey)
        const max = getMaxValue(filterState, dimension.maxKey)
        const handlesOverlap = max - min <= HANDLE_OVERLAP_THRESHOLD
        const prioritizeMinHandle = handlesOverlap && min > 0.5
        const minHandleZIndex = prioritizeMinHandle ? 5 : 3
        const maxHandleZIndex = handlesOverlap && !prioritizeMinHandle ? 5 : 4
        return (
          <div key={dimension.label} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-300">{dimension.label}:</span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">
                  {min.toFixed(2)} - {max.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="relative h-5 flex items-center">
              <div className="absolute left-0 right-0 h-0.5 bg-surface-border rounded-full" />
              <div
                className="absolute h-0.5 bg-accent-primary rounded-full pointer-events-none"
                style={{
                  left: `${min * 100}%`,
                  right: `${(1 - max) * 100}%`,
                }}
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={min}
                onChange={(event) =>
                  setRangeValue(
                    dimension.minKey,
                    dimension.maxKey,
                    'min',
                    Number.parseFloat(event.target.value),
                  )
                }
                className="absolute w-full h-5 appearance-none bg-transparent cursor-pointer slider-thumb"
                style={{ zIndex: minHandleZIndex }}
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={max}
                onChange={(event) =>
                  setRangeValue(
                    dimension.minKey,
                    dimension.maxKey,
                    'max',
                    Number.parseFloat(event.target.value),
                  )
                }
                className="absolute w-full h-5 appearance-none bg-transparent cursor-pointer slider-thumb"
                style={{ zIndex: maxHandleZIndex }}
              />
            </div>
          </div>
        )
      })}

      {hasActiveFilters && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={resetCategory}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Reset {category}
          </button>
        </div>
      )}
    </div>
  )
}
