import type { AudioFeatures, FeatureWeights, NormalizationMethod } from '../types'

type TagLike = { name: string }

export interface TagFeatureOptions {
  enabled?: boolean
  weight?: number
  excludeDerived?: boolean
  minTagFrequency?: number
  derivedTagNames?: string[]
  normalization?: 'none' | 'unit-l2'
}

export interface FeatureMatrixOptions {
  tags?: TagFeatureOptions
}

const DEFAULT_DERIVED_TAG_NAMES = [
  'bright',
  'brightness',
  'dark',
  'mid-range',
  'high-freq',
  'high-frequency',
  'bass-heavy',
  'aggressive',
  'ambient',
  'dynamic',
  'compressed',
  'loud',
  'quiet',
]

const DEFAULT_TAG_OPTIONS: Required<TagFeatureOptions> = {
  enabled: true,
  weight: 0.6,
  excludeDerived: true,
  minTagFrequency: 1,
  derivedTagNames: DEFAULT_DERIVED_TAG_NAMES,
  normalization: 'unit-l2',
}

// Default weights for Space View:
// subjective-first, non-redundant axes that are present in /slices/features.
export const DEFAULT_WEIGHTS: FeatureWeights = {
  spectralCentroid: 1.5,
  spectralRolloff: 0.9,
  spectralBandwidth: 0,
  spectralContrast: 1.4,
  spectralFlux: 0,
  spectralFlatness: 1.0,
  zeroCrossingRate: 0.9,
  rmsEnergy: 0.45,
  loudness: 1.0,
  dynamicRange: 0.9,
  attackTime: 0.95,
  kurtosis: 0,
  bpm: 0.2,
  onsetCount: 0.5,
  keyStrength: 1.6,
  // Phase 1: Timbral features
  dissonance: 0.55,
  inharmonicity: 0.65,
  spectralComplexity: 0.45,
  spectralCrest: 0,
  // Phase 1: Perceptual features
  brightness: 1.8,
  warmth: 1.2,
  hardness: 0,
  noisiness: 1.5,
  roughness: 1.85,
  sharpness: 1.0,
  // Phase 2: Stereo features
  stereoWidth: 0.9,
  panningCenter: 0.6,
  stereoImbalance: 0.6,
  // Phase 2: Harmonic/Percussive features
  harmonicPercussiveRatio: 1.1,
  harmonicEnergy: 0.9,
  percussiveEnergy: 0.9,
  harmonicCentroid: 0.9,
  percussiveCentroid: 0.85,
  // Phase 3: Advanced Rhythm features
  onsetRate: 0.9,
  beatStrength: 0.8,
  rhythmicRegularity: 0,
  danceability: 0.7,
  // Phase 3: ADSR Envelope features
  decayTime: 0.75,
  sustainLevel: 0.65,
  releaseTime: 0.85,
  // Phase 5: EBU R128 Loudness features
  loudnessIntegrated: 1.0,
  loudnessRange: 1.1,
  loudnessMomentaryMax: 0.9,
  truePeak: 0.75,
  // Phase 5: Sound Event Detection features
  eventCount: 0.8,
  eventDensity: 0.85,
  // New analysis features
  temporalCentroid: 0.7,
  crestFactor: 0.75,
  transientSpectralCentroid: 1.0,
  transientSpectralFlatness: 0.7,
  sampleTypeConfidence: 1.2,
}

// Feature groups for the UI
export const FEATURE_GROUPS = {
  spectral: {
    label: 'Spectral (Timbre)',
    features: ['spectralCentroid', 'spectralRolloff', 'spectralBandwidth', 'spectralContrast', 'spectralFlux', 'spectralFlatness', 'spectralCrest'],
  },
  energy: {
    label: 'Energy/Dynamics',
    features: ['rmsEnergy', 'loudness', 'dynamicRange', 'loudnessIntegrated', 'loudnessRange', 'loudnessMomentaryMax', 'truePeak'],
  },
  texture: {
    label: 'Texture',
    features: ['zeroCrossingRate', 'kurtosis'],
  },
  rhythm: {
    label: 'Rhythm',
    features: ['bpm', 'onsetCount', 'onsetRate', 'beatStrength', 'rhythmicRegularity', 'danceability', 'eventCount', 'eventDensity', 'sampleTypeConfidence'],
  },
  tonal: {
    label: 'Tonal',
    features: ['keyStrength'],
  },
  timbral: {
    label: 'Timbral (Advanced)',
    features: ['dissonance', 'inharmonicity', 'spectralComplexity'],
  },
  perceptual: {
    label: 'Perceptual (Advanced)',
    features: ['brightness', 'warmth', 'hardness', 'noisiness', 'roughness', 'sharpness'],
  },
  stereo: {
    label: 'Stereo (Advanced)',
    features: ['stereoWidth', 'panningCenter', 'stereoImbalance'],
  },
  harmonic: {
    label: 'Harmonic/Percussive (Advanced)',
    features: ['harmonicPercussiveRatio', 'harmonicEnergy', 'percussiveEnergy', 'harmonicCentroid', 'percussiveCentroid'],
  },
  envelope: {
    label: 'Envelope (Advanced)',
    features: ['attackTime', 'decayTime', 'sustainLevel', 'releaseTime', 'temporalCentroid', 'crestFactor'],
  },
  transient: {
    label: 'Transient (Advanced)',
    features: ['transientSpectralCentroid', 'transientSpectralFlatness'],
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
  zeroCrossingRate: 'Noisiness (ZCR)',
  rmsEnergy: 'Volume',
  loudness: 'Loudness',
  dynamicRange: 'Dynamic Range',
  attackTime: 'Attack',
  kurtosis: 'Peakiness',
  bpm: 'Tempo',
  onsetCount: 'Rhythmic Density',
  keyStrength: 'Tonality (Contrast)',
  // Phase 1: Timbral features
  spectralCrest: 'Spectral Peak',
  dissonance: 'Dissonance',
  inharmonicity: 'Inharmonicity',
  spectralComplexity: 'Complexity',
  // Phase 1: Perceptual features
  brightness: 'Perceived Brightness',
  warmth: 'Warmth',
  hardness: 'Hardness',
  noisiness: 'Noisiness (Contrast)',
  roughness: 'Saturation (Composite)',
  sharpness: 'Sharpness',
  // Phase 2: Stereo features
  stereoWidth: 'Stereo Width',
  panningCenter: 'Panning',
  stereoImbalance: 'L/R Balance',
  // Phase 2: Harmonic/Percussive features
  harmonicPercussiveRatio: 'Harmonic/Percussive',
  harmonicEnergy: 'Harmonic Energy',
  percussiveEnergy: 'Percussive Energy',
  harmonicCentroid: 'Harmonic Brightness',
  percussiveCentroid: 'Percussive Brightness',
  // Phase 3: Advanced Rhythm features
  onsetRate: 'Onset Rate',
  beatStrength: 'Beat Strength',
  rhythmicRegularity: 'Rhythmic Regularity',
  danceability: 'Danceability',
  // Phase 3: ADSR Envelope features
  decayTime: 'Decay Time',
  sustainLevel: 'Sustain Level',
  releaseTime: 'Release Time',
  // Phase 5: EBU R128 Loudness features
  loudnessIntegrated: 'Integrated Loudness (LUFS)',
  loudnessRange: 'Loudness Range (LU)',
  loudnessMomentaryMax: 'Max Momentary Loudness',
  truePeak: 'True Peak (dBTP)',
  // Phase 5: Sound Event Detection features
  eventCount: 'Event Count',
  eventDensity: 'Event Density',
  // New analysis features
  temporalCentroid: 'Temporal Center',
  crestFactor: 'Crest Factor',
  transientSpectralCentroid: 'Transient Brightness',
  transientSpectralFlatness: 'Transient Noisiness',
  sampleTypeConfidence: 'Sample Type Confidence',
}

function normalizeTagName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
}

function buildTagDimensions(
  samples: Array<AudioFeatures & { tags?: TagLike[] }>,
  tagOptions?: TagFeatureOptions
): {
  activeTags: string[]
  sampleTagSets: Set<string>[]
  sampleTagValues: number[]
} {
  const opts = { ...DEFAULT_TAG_OPTIONS, ...tagOptions }
  if (!opts.enabled) {
    return { activeTags: [], sampleTagSets: [], sampleTagValues: [] }
  }

  const derivedTagSet = new Set(
    (opts.derivedTagNames || DEFAULT_DERIVED_TAG_NAMES).map(normalizeTagName)
  )

  const sampleTagSets = samples.map((sample) => {
    const normalized = (sample.tags ?? [])
      .map((t) => normalizeTagName(t.name))
      .filter(Boolean)
      .filter((tag) => !(opts.excludeDerived && derivedTagSet.has(tag)))

    return new Set(normalized)
  })

  const tagCounts = new Map<string, number>()
  for (const tagSet of sampleTagSets) {
    for (const tag of tagSet) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }

  const activeTags = [...tagCounts.entries()]
    .filter(([, count]) => count >= opts.minTagFrequency)
    .map(([tag]) => tag)
    .sort()

  const activeTagSet = new Set(activeTags)
  const sampleTagValues = sampleTagSets.map((tagSet) => {
    let activeCount = 0
    for (const tag of tagSet) {
      if (activeTagSet.has(tag)) {
        activeCount += 1
      }
    }

    if (activeCount === 0) {
      return 0
    }

    if (opts.normalization === 'unit-l2') {
      // Keep total tag-vector magnitude stable so tag quantity does not
      // dominate distances; overlap/content drives similarity instead.
      return opts.weight / Math.sqrt(activeCount)
    }

    return opts.weight
  })

  return { activeTags, sampleTagSets, sampleTagValues }
}

// Normalize a value to 0-1 range using min-max scaling
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5
  return (value - min) / (max - min)
}

function robustNormalize(value: number, median: number, iqr: number): number {
  if (iqr === 0) return 0.5
  // Logistic squash around median to reduce outlier-driven spreading.
  const scaled = (value - median) / (iqr * 1.5)
  const logistic = 1 / (1 + Math.exp(-scaled))
  return 0.05 + logistic * 0.9
}

function zscoreNormalize(value: number, mean: number, std: number): number {
  if (std === 0) return 0.5
  return Math.max(0, Math.min(1, 0.5 + (value - mean) / (std * 6)))
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value))
}

function contrastScore(primary: number, opposing: number, sharpness = 6): number {
  return logistic((primary - opposing) * sharpness)
}

function getNoiseEvidence(sample: AudioFeatures): number | null {
  let weightedSum = 0
  let totalWeight = 0

  const add = (value: number | null | undefined, weight: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    weightedSum += clamp01(value) * weight
    totalWeight += weight
  }

  // Prioritize subjective noisiness but stabilize with neighboring proxies.
  add(sample.noisiness, 0.45)
  add(sample.roughness, 0.2)
  add(sample.spectralFlatness, 0.2)
  add(sample.zeroCrossingRate, 0.15)

  return totalWeight > 0 ? weightedSum / totalWeight : null
}

function getTonalEvidence(sample: AudioFeatures): number | null {
  const cues: number[] = []

  if (typeof sample.keyStrength === 'number' && Number.isFinite(sample.keyStrength)) {
    cues.push(clamp01(sample.keyStrength))
  }

  if (
    typeof sample.harmonicPercussiveRatio === 'number' &&
    Number.isFinite(sample.harmonicPercussiveRatio)
  ) {
    const hpr = Math.max(0, sample.harmonicPercussiveRatio)
    cues.push(clamp01(hpr / (1 + hpr)))
  }

  if (
    typeof sample.harmonicEnergy === 'number' &&
    Number.isFinite(sample.harmonicEnergy) &&
    typeof sample.percussiveEnergy === 'number' &&
    Number.isFinite(sample.percussiveEnergy)
  ) {
    const harmonic = Math.max(0, sample.harmonicEnergy)
    const percussive = Math.max(0, sample.percussiveEnergy)
    const total = harmonic + percussive
    if (total > 0) {
      cues.push(clamp01(harmonic / total))
    }
  }

  if (cues.length === 0) return null
  return cues.reduce((sum, value) => sum + value, 0) / cues.length
}

function getSaturationEvidence(sample: AudioFeatures): number | null {
  let weightedSum = 0
  let totalWeight = 0

  const add = (value: number | null | undefined, weight: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    weightedSum += clamp01(value) * weight
    totalWeight += weight
  }

  // Saturation/texture cues: roughness first, reinforced by harmonic impurity.
  add(sample.roughness, 0.5)
  add(sample.dissonance, 0.2)
  add(sample.inharmonicity, 0.2)
  add(sample.spectralComplexity, 0.1)

  return totalWeight > 0 ? weightedSum / totalWeight : null
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
      {
        const tonalEvidence = getTonalEvidence(sample)
        if (tonalEvidence === null) return null
        const noiseEvidence = getNoiseEvidence(sample) ?? 0
        return contrastScore(tonalEvidence, noiseEvidence)
      }
    // Phase 1: Timbral features
    case 'spectralCrest':
      return sample.spectralCrest ?? null
    case 'dissonance':
      return sample.dissonance ?? null
    case 'inharmonicity':
      return sample.inharmonicity ?? null
    case 'spectralComplexity':
      return sample.spectralComplexity ?? null
    // Phase 1: Perceptual features (already 0-1 normalized)
    case 'brightness':
      return sample.brightness ?? null
    case 'warmth':
      return sample.warmth ?? null
    case 'hardness':
      return sample.hardness ?? null
    case 'noisiness':
      {
        const noiseEvidence = getNoiseEvidence(sample)
        if (noiseEvidence === null) return null
        const tonalEvidence = getTonalEvidence(sample) ?? 0
        return contrastScore(noiseEvidence, tonalEvidence)
      }
    case 'roughness':
      return getSaturationEvidence(sample)
    case 'sharpness':
      return sample.sharpness ?? null
    // Phase 2: Stereo features
    case 'stereoWidth':
      return sample.stereoWidth ?? null
    case 'panningCenter':
      return sample.panningCenter ?? null
    case 'stereoImbalance':
      return sample.stereoImbalance ?? null
    // Phase 2: Harmonic/Percussive features
    case 'harmonicPercussiveRatio':
      return sample.harmonicPercussiveRatio ?? null
    case 'harmonicEnergy':
      return sample.harmonicEnergy ?? null
    case 'percussiveEnergy':
      return sample.percussiveEnergy ?? null
    case 'harmonicCentroid':
      return sample.harmonicCentroid ?? null
    case 'percussiveCentroid':
      return sample.percussiveCentroid ?? null
    // Phase 3: Advanced Rhythm features
    case 'onsetRate':
      return sample.onsetRate ?? null
    case 'beatStrength':
      return sample.beatStrength ?? null
    case 'rhythmicRegularity':
      return sample.rhythmicRegularity ?? null
    case 'danceability':
      return sample.danceability ?? null
    // Phase 3: ADSR Envelope features
    case 'decayTime':
      return sample.decayTime ?? null
    case 'sustainLevel':
      return sample.sustainLevel ?? null
    case 'releaseTime':
      return sample.releaseTime ?? null
    // Phase 5: EBU R128 Loudness features
    case 'loudnessIntegrated':
      return sample.loudnessIntegrated ?? null
    case 'loudnessRange':
      return sample.loudnessRange ?? null
    case 'loudnessMomentaryMax':
      return sample.loudnessMomentaryMax ?? null
    case 'truePeak':
      return sample.truePeak ?? null
    // Phase 5: Sound Event Detection features
    case 'eventCount':
      return sample.eventCount ?? null
    case 'eventDensity':
      return sample.eventDensity ?? null
    // New analysis features
    case 'temporalCentroid':
      return sample.temporalCentroid ?? null
    case 'crestFactor':
      return sample.crestFactor ?? null
    case 'transientSpectralCentroid':
      return sample.transientSpectralCentroid ?? null
    case 'transientSpectralFlatness':
      return sample.transientSpectralFlatness ?? null
    case 'sampleTypeConfidence':
      return sample.sampleTypeConfidence ?? null
    default:
      return null
  }
}

// Build a normalized, weighted feature matrix for dimensionality reduction
export function buildFeatureMatrix(
  samples: Array<AudioFeatures & { tags?: TagLike[] }>,
  weights: FeatureWeights,
  normalization: NormalizationMethod = 'robust',
  options: FeatureMatrixOptions = {}
): { matrix: number[][]; validIndices: number[] } {
  const featureKeys = Object.keys(weights) as (keyof FeatureWeights)[]

  // Only use features with non-zero weights
  const activeFeatures = featureKeys.filter((k) => weights[k] > 0)
  const { activeTags, sampleTagSets, sampleTagValues } = buildTagDimensions(samples, options.tags)

  if (activeFeatures.length === 0 && activeTags.length === 0) {
    return { matrix: [], validIndices: [] }
  }

  // First pass: collect all values and compute statistics for normalization
  const featureRanges: Record<string, { min: number; max: number; median: number; q1: number; q3: number; iqr: number; mean: number; std: number; values: (number | null)[] }> = {}

  for (const feature of activeFeatures) {
    const values = samples.map((s) => getFeatureValue(s, feature))
    const validValues = values.filter((v): v is number => v !== null)
    const sorted = [...validValues].sort((a, b) => a - b)
    const n = sorted.length

    const q1 = n > 0 ? sorted[Math.floor(n * 0.25)] : 0
    const median = n > 0 ? sorted[Math.floor(n * 0.5)] : 0
    const q3 = n > 0 ? sorted[Math.floor(n * 0.75)] : 0
    const mean = n > 0 ? validValues.reduce((a, b) => a + b, 0) / n : 0
    const std = n > 1 ? Math.sqrt(validValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1)) : 0

    featureRanges[feature] = {
      min: n > 0 ? sorted[0] : 0,
      max: n > 0 ? sorted[n - 1] : 1,
      median,
      q1,
      q3,
      iqr: q3 - q1,
      mean,
      std,
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
        let normalized: number
        const range = featureRanges[feature]
        switch (normalization) {
          case 'robust':
            normalized = robustNormalize(value, range.median, range.iqr)
            break
          case 'zscore':
            normalized = zscoreNormalize(value, range.mean, range.std)
            break
          case 'minmax':
          default:
            normalized = normalize(value, range.min, range.max)
            break
        }
        row.push(normalized * weight)
        hasAnyValue = true
      } else {
        // Use 0.5 (middle) for missing values
        row.push(0.5 * weight)
      }
    }

    if (activeTags.length > 0) {
      const tagSet = sampleTagSets[i] ?? new Set<string>()
      const tagValue = sampleTagValues[i] ?? 0
      for (const tag of activeTags) {
        const hasTag = tagSet.has(tag)
        row.push(hasTag ? tagValue : 0)
        if (hasTag) hasAnyValue = true
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
