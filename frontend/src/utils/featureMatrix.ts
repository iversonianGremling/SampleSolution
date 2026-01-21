import type { AudioFeatures, FeatureWeights } from '../types'

// Default weights - all features equally weighted
export const DEFAULT_WEIGHTS: FeatureWeights = {
  spectralCentroid: 1,
  spectralRolloff: 1,
  spectralBandwidth: 1,
  spectralContrast: 1,
  spectralFlux: 1,
  spectralFlatness: 1,
  zeroCrossingRate: 1,
  rmsEnergy: 1,
  loudness: 1,
  dynamicRange: 1,
  attackTime: 1,
  kurtosis: 1,
  bpm: 1,
  onsetCount: 1,
  keyStrength: 1,
}

// Feature groups for the UI
export const FEATURE_GROUPS = {
  spectral: {
    label: 'Spectral (Timbre)',
    features: ['spectralCentroid', 'spectralRolloff', 'spectralBandwidth', 'spectralContrast', 'spectralFlux', 'spectralFlatness'],
  },
  energy: {
    label: 'Energy/Dynamics',
    features: ['rmsEnergy', 'loudness', 'dynamicRange', 'attackTime'],
  },
  texture: {
    label: 'Texture',
    features: ['zeroCrossingRate', 'kurtosis'],
  },
  rhythm: {
    label: 'Rhythm',
    features: ['bpm', 'onsetCount'],
  },
  tonal: {
    label: 'Tonal',
    features: ['keyStrength'],
  },
} as const

// Human-readable feature names
export const FEATURE_LABELS: Record<keyof FeatureWeights, string> = {
  spectralCentroid: 'Brightness',
  spectralRolloff: 'High Freq Content',
  spectralBandwidth: 'Freq Spread',
  spectralContrast: 'Tonal/Noisy',
  spectralFlux: 'Spectral Change',
  spectralFlatness: 'Noise-like',
  zeroCrossingRate: 'Noisiness',
  rmsEnergy: 'Volume',
  loudness: 'Loudness',
  dynamicRange: 'Dynamic Range',
  attackTime: 'Attack',
  kurtosis: 'Peakiness',
  bpm: 'Tempo',
  onsetCount: 'Rhythmic Density',
  keyStrength: 'Tonality',
}

// Normalize a value to 0-1 range using min-max scaling
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5
  return (value - min) / (max - min)
}

// Extract a single feature value from AudioFeatures
function getFeatureValue(sample: AudioFeatures, feature: keyof FeatureWeights): number | null {
  switch (feature) {
    case 'spectralCentroid':
      return sample.spectralCentroid
    case 'spectralRolloff':
      return sample.spectralRolloff
    case 'spectralBandwidth':
      return sample.spectralBandwidth
    case 'spectralContrast':
      return sample.spectralContrast
    case 'spectralFlux':
      return sample.spectralFlux
    case 'spectralFlatness':
      return sample.spectralFlatness
    case 'zeroCrossingRate':
      return sample.zeroCrossingRate
    case 'rmsEnergy':
      return sample.rmsEnergy
    case 'loudness':
      return sample.loudness
    case 'dynamicRange':
      return sample.dynamicRange
    case 'attackTime':
      return sample.attackTime
    case 'kurtosis':
      return sample.kurtosis
    case 'bpm':
      return sample.bpm
    case 'onsetCount':
      return sample.onsetCount
    case 'keyStrength':
      return sample.keyStrength
    default:
      return null
  }
}

// Build a normalized, weighted feature matrix for dimensionality reduction
export function buildFeatureMatrix(
  samples: AudioFeatures[],
  weights: FeatureWeights
): { matrix: number[][]; validIndices: number[] } {
  const featureKeys = Object.keys(weights) as (keyof FeatureWeights)[]

  // Only use features with non-zero weights
  const activeFeatures = featureKeys.filter((k) => weights[k] > 0)

  if (activeFeatures.length === 0) {
    return { matrix: [], validIndices: [] }
  }

  // First pass: collect all values to find min/max for normalization
  const featureRanges: Record<string, { min: number; max: number; values: (number | null)[] }> = {}

  for (const feature of activeFeatures) {
    const values = samples.map((s) => getFeatureValue(s, feature))
    const validValues = values.filter((v): v is number => v !== null)

    featureRanges[feature] = {
      min: validValues.length > 0 ? Math.min(...validValues) : 0,
      max: validValues.length > 0 ? Math.max(...validValues) : 1,
      values,
    }
  }

  // Second pass: build normalized, weighted matrix
  // Only include samples that have at least some valid features
  const matrix: number[][] = []
  const validIndices: number[] = []

  for (let i = 0; i < samples.length; i++) {
    const row: number[] = []
    let hasAnyValue = false

    for (const feature of activeFeatures) {
      const value = featureRanges[feature].values[i]
      const weight = weights[feature]

      if (value !== null) {
        const normalized = normalize(value, featureRanges[feature].min, featureRanges[feature].max)
        row.push(normalized * weight)
        hasAnyValue = true
      } else {
        // Use 0.5 (middle) for missing values
        row.push(0.5 * weight)
      }
    }

    if (hasAnyValue) {
      matrix.push(row)
      validIndices.push(i)
    }
  }

  return { matrix, validIndices }
}

// Calculate feature statistics for display
export function getFeatureStats(samples: AudioFeatures[]): Record<keyof FeatureWeights, { min: number; max: number; avg: number; count: number }> {
  const featureKeys = Object.keys(DEFAULT_WEIGHTS) as (keyof FeatureWeights)[]
  const stats: Record<string, { min: number; max: number; avg: number; count: number }> = {}

  for (const feature of featureKeys) {
    const values = samples.map((s) => getFeatureValue(s, feature)).filter((v): v is number => v !== null)

    stats[feature] = {
      min: values.length > 0 ? Math.min(...values) : 0,
      max: values.length > 0 ? Math.max(...values) : 0,
      avg: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
      count: values.length,
    }
  }

  return stats as Record<keyof FeatureWeights, { min: number; max: number; avg: number; count: number }>
}
