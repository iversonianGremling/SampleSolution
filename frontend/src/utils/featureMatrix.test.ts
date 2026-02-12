import { describe, expect, it } from 'vitest'
import type { AudioFeatures, FeatureWeights } from '../types'
import { DEFAULT_WEIGHTS, buildFeatureMatrix } from './featureMatrix'

const ZERO_WEIGHTS = Object.fromEntries(
  Object.keys(DEFAULT_WEIGHTS).map((key) => [key, 0])
) as unknown as FeatureWeights

function makeSample(
  id: number,
  tags: Array<{ name: string }>
): AudioFeatures & { tags: Array<{ name: string }> } {
  return {
    id,
    name: `sample-${id}`,
    trackId: 1,
    filePath: null,
    isOneShot: 1,
    isLoop: 0,
    fundamentalFrequency: null,
    duration: 1,
    bpm: 120,
    onsetCount: 4,
    spectralCentroid: 1000,
    spectralRolloff: 2000,
    spectralBandwidth: 300,
    spectralContrast: 20,
    zeroCrossingRate: 0.1,
    mfccMean: [0.1, 0.2],
    rmsEnergy: 0.5,
    loudness: -12,
    dynamicRange: 8,
    keyEstimate: null,
    keyStrength: null,
    attackTime: 0.05,
    spectralFlux: 0.2,
    spectralFlatness: 0.1,
    kurtosis: 2,
    tags,
  }
}

describe('buildFeatureMatrix tag dimensions', () => {
  it('adds tag dimensions so tags influence projection input', () => {
    const samples = [
      makeSample(1, [{ name: 'kick' }]),
      makeSample(2, [{ name: 'snare' }]),
    ]

    const { matrix } = buildFeatureMatrix(samples, ZERO_WEIGHTS, 'robust', {
      tags: { enabled: true, weight: 2, excludeDerived: true },
    })

    expect(matrix).toEqual([
      [2, 0],
      [0, 2],
    ])
  })

  it('excludes derived tags like brightness by default', () => {
    const samples = [
      makeSample(1, [{ name: 'brightness' }, { name: 'kick' }]),
      makeSample(2, [{ name: 'bright' }, { name: 'snare' }]),
    ]

    const { matrix } = buildFeatureMatrix(samples, ZERO_WEIGHTS)

    // "bright/brightness" are excluded, so only kick and snare remain.
    expect(matrix).toEqual([
      [1.8, 0],
      [0, 1.8],
    ])
  })

  it('can include derived tags when excludeDerived is disabled', () => {
    const samples = [
      makeSample(1, [{ name: 'bright' }, { name: 'kick' }]),
      makeSample(2, [{ name: 'brightness' }, { name: 'snare' }]),
    ]

    const { matrix } = buildFeatureMatrix(samples, ZERO_WEIGHTS, 'robust', {
      tags: { enabled: true, weight: 1, excludeDerived: false },
    })

    // Active tags are: bright, brightness, kick, snare (alphabetical).
    expect(matrix).toEqual([
      [1, 0, 1, 0],
      [0, 1, 0, 1],
    ])
  })
})
