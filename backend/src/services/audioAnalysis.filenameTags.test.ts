import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExtractCategorizedTagsFromText, mockReviewSampleTagsWithOllama } = vi.hoisted(() => ({
  mockExtractCategorizedTagsFromText: vi.fn(),
  mockReviewSampleTagsWithOllama: vi.fn(),
}))

vi.mock('./ollama.js', () => ({
  extractCategorizedTagsFromText: mockExtractCategorizedTagsFromText,
  reviewSampleTagsWithOllama: mockReviewSampleTagsWithOllama,
}))

import {
  deriveInstrumentType,
  getTagMetadata,
  inferSampleTypeFromPathHint,
  parseFilenameTags,
  parseFilenameTagsSmart,
  postAnalyzeSampleTags,
} from './audioAnalysis.js'

describe('filename tag parsing', () => {
  beforeEach(() => {
    mockExtractCategorizedTagsFromText.mockReset()
    mockReviewSampleTagsWithOllama.mockReset()
  })

  it('maps obvious filename words into instrument category', () => {
    const tags = parseFilenameTags('BigClap_909.wav', null)
    const byTag = new Map(tags.map((tag) => [tag.tag, tag]))

    expect(byTag.get('clap')?.category).toBe('instrument')
    // 909 resolves to 'kick' via alias
    expect(byTag.has('kick') || byTag.has('909')).toBe(true)
  })

  it('only returns instrument tags from filename parsing', () => {
    const tags = parseFilenameTags('clap_dry_oneshot.wav', null)
    const byTag = new Map(tags.map((tag) => [tag.tag, tag]))

    expect(byTag.get('clap')?.category).toBe('instrument')
    // dry and oneshot are no longer extracted (not instrument tags)
    expect(byTag.has('dry')).toBe(false)
    expect(byTag.has('oneshot')).toBe(false)
  })

  it('infers tags from congruent filename fragments when direct token match is missing', () => {
    const tags = parseFilenameTags('clapperLayer_take2.wav', null)
    const tagNames = new Set(tags.map((tag) => tag.tag))
    expect(tagNames.has('clap')).toBe(true)
  })

  it('infers instrument tags from nested folder structure context', () => {
    const tags = parseFilenameTags('mystery_sample.wav', '/packs/one-shots/kicks/vintage')
    const tagNames = new Set(tags.map((tag) => tag.tag))
    expect(tagNames.has('kick')).toBe(true)
  })

  it('falls back to heuristic parsing when Ollama returns no tags', async () => {
    mockExtractCategorizedTagsFromText.mockResolvedValueOnce([])

    const tags = await parseFilenameTagsSmart('clap_dry_oneshot.wav', null)
    const byTag = new Map(tags.map((tag) => [tag.tag, tag]))

    expect(byTag.get('clap')?.category).toBe('instrument')
    // Non-instrument tags should not be present
    expect(byTag.has('dry')).toBe(false)
    expect(byTag.has('oneshot')).toBe(false)
  })

  it('drops generic percussion tags when specific drum tags are present', async () => {
    mockExtractCategorizedTagsFromText.mockResolvedValueOnce([
      { tag: 'percussion', category: 'instrument', confidence: 0.98 },
      { tag: 'kick', category: 'instrument', confidence: 0.92 },
      { tag: 'snare', category: 'instrument', confidence: 0.91 },
    ])

    const tags = await parseFilenameTagsSmart('KickPerc_OneShot.wav', null)
    const tagNames = new Set(tags.map((tag) => tag.tag))

    expect(tagNames.has('kick')).toBe(true)
    expect(tagNames.has('snare')).toBe(true)
    expect(tagNames.has('percussion')).toBe(false)
    expect(tagNames.has('perc')).toBe(false)
  })

  it('drops sample-type tags returned by Ollama filename parsing', async () => {
    mockExtractCategorizedTagsFromText.mockResolvedValueOnce([
      { tag: 'oneshot', category: 'type', confidence: 0.95 },
      { tag: 'loop', category: 'type', confidence: 0.9 },
      { tag: 'vocal', category: 'instrument', confidence: 0.88 },
    ])

    const tags = await parseFilenameTagsSmart('vocal_oneshot.wav', null)
    const tagNames = new Set(tags.map((tag) => tag.tag))

    expect(tagNames.has('oneshot')).toBe(false)
    expect(tagNames.has('loop')).toBe(false)
    expect(tagNames.has('vocal')).toBe(true)
  })

  it('respects allowAiTagging=false for smart filename parsing', async () => {
    mockExtractCategorizedTagsFromText.mockResolvedValueOnce([
      { tag: 'snare', category: 'instrument', confidence: 0.95 },
    ])

    const tags = await parseFilenameTagsSmart('kick_layer.wav', null, { allowAiTagging: false })
    const tagNames = new Set(tags.map((tag) => tag.tag))

    expect(mockExtractCategorizedTagsFromText).not.toHaveBeenCalled()
    expect(tagNames.has('kick')).toBe(true)
  })

  it('detects sample type from loop/one-shot path naming variations', () => {
    expect(inferSampleTypeFromPathHint('/packs/One Shots/Kicks/snare.wav')).toBe('oneshot')
    expect(inferSampleTypeFromPathHint('/packs/drum-loops/bass/riff.wav')).toBe('loop')
    expect(inferSampleTypeFromPathHint('/packs/loops/one_shots/hats/h01.wav')).toBe('oneshot')
    expect(inferSampleTypeFromPathHint('/packs/one-hits/snares/s01.wav')).toBe('oneshot')
    expect(inferSampleTypeFromPathHint('/packs/looping/percussion/l01.wav')).toBe('loop')
    expect(inferSampleTypeFromPathHint('/packs/misc/sfx/rise.wav')).toBeNull()
  })

  it('uses instrument folders as strong instrument-type hints when requested', () => {
    const inferred = deriveInstrumentType(
      [{ class: 'snare drum', confidence: 0.92 }],
      'sample.wav',
      {
        pathHint: '/packs/loops/kicks/processed',
        preferPathHint: true,
      }
    )

    expect(inferred).toBe('kick')
  })

  it('prioritizes path-derived instrument hints over conflicting model tags', async () => {
    const result = await postAnalyzeSampleTags({
      sampleName: 'mystery_take1.wav',
      folderPath: '/imports/Drum Loops/Kicks/Analog/mystery_take1.wav',
      modelTags: ['snare'],
      previousAutoTags: ['hihat'],
      features: {
        duration: 1,
        sampleRate: 44100,
        isOneShot: false,
        isLoop: true,
        onsetCount: 4,
        spectralCentroid: 0.1,
        spectralRolloff: 0.1,
        spectralBandwidth: 0.1,
        spectralContrast: 0.1,
        zeroCrossingRate: 0.1,
        mfccMean: [],
        rmsEnergy: 0.1,
        loudness: -12,
        dynamicRange: 5,
        instrumentPredictions: [],
        analysisDurationMs: 10,
      },
    })

    expect(result).toEqual([{ name: 'kick', category: 'instrument' }])
  })

  it('prefers filename evidence over model tags when model confidence is low', async () => {
    const result = await postAnalyzeSampleTags({
      sampleName: 'Garage Foley - 1.wav',
      folderPath: null,
      modelTags: ['percussion'],
      features: {
        duration: 1,
        sampleRate: 44100,
        isOneShot: true,
        isLoop: false,
        onsetCount: 1,
        spectralCentroid: 0.1,
        spectralRolloff: 0.1,
        spectralBandwidth: 0.1,
        spectralContrast: 0.1,
        zeroCrossingRate: 0.1,
        mfccMean: [],
        rmsEnergy: 0.1,
        loudness: -12,
        dynamicRange: 5,
        instrumentPredictions: [{ name: 'percussion', confidence: 0.55 }],
        analysisDurationMs: 10,
      },
    })

    expect(mockReviewSampleTagsWithOllama).not.toHaveBeenCalled()
    expect(result).toEqual([{ name: 'foley', category: 'instrument' }])
  })

  it('uses Ollama as a last resort when deterministic review yields no known tag', async () => {
    mockReviewSampleTagsWithOllama.mockResolvedValueOnce([
      { tag: 'snare', category: 'instrument', confidence: 0.9 },
    ])

    const result = await postAnalyzeSampleTags({
      sampleName: 'mystery_take1.wav',
      folderPath: null,
      modelTags: ['opaque-unknown-label'],
      features: {
        duration: 1,
        sampleRate: 44100,
        isOneShot: true,
        isLoop: false,
        onsetCount: 1,
        spectralCentroid: 0.1,
        spectralRolloff: 0.1,
        spectralBandwidth: 0.1,
        spectralContrast: 0.1,
        zeroCrossingRate: 0.1,
        mfccMean: [],
        rmsEnergy: 0.1,
        loudness: -12,
        dynamicRange: 5,
        instrumentPredictions: [{ name: 'noise', confidence: 0.2 }],
        analysisDurationMs: 10,
      },
    })

    expect(mockReviewSampleTagsWithOllama).toHaveBeenCalledTimes(1)
    expect(result).toEqual([{ name: 'snare', category: 'instrument' }])
  })

  it('uses ambience fallback for generic slice names when model confidence is weak', async () => {
    const result = await postAnalyzeSampleTags({
      sampleName: 'Slice 1',
      folderPath: 'Slice 1',
      modelTags: ['vocal'],
      previousAutoTags: ['kick'],
      features: {
        duration: 1,
        sampleRate: 44100,
        isOneShot: true,
        isLoop: false,
        onsetCount: 1,
        spectralCentroid: 0.1,
        spectralRolloff: 0.1,
        spectralBandwidth: 0.1,
        spectralContrast: 0.1,
        zeroCrossingRate: 0.1,
        mfccMean: [],
        rmsEnergy: 0.1,
        loudness: -12,
        dynamicRange: 5,
        instrumentPredictions: [{ name: 'vocal', confidence: 0.6 }],
        analysisDurationMs: 10,
      },
    })

    expect(mockReviewSampleTagsWithOllama).not.toHaveBeenCalled()
    expect(result).toEqual([{ name: 'ambience', category: 'instrument' }])
  })

  it('honors explicit category overrides for metadata colors', () => {
    const metadata = getTagMetadata('clap', 'instrument')
    expect(metadata.category).toBe('instrument')
    expect(metadata.color).toBe('#22c55e')
  })

  it('applies post-analysis coherence rules — only instrument tags survive', async () => {
    mockReviewSampleTagsWithOllama.mockResolvedValueOnce([
      { tag: 'perc-metal', category: 'instrument', confidence: 0.96 },
      { tag: 'snare', category: 'instrument', confidence: 0.9 },
    ])

    const result = await postAnalyzeSampleTags({
      sampleName: 'perc-metal-snare-02',
      folderPath: null,
      modelTags: ['perc-metal', 'snare'],
      features: {
        duration: 1,
        sampleRate: 44100,
        isOneShot: true,
        isLoop: false,
        onsetCount: 1,
        spectralCentroid: 0.1,
        spectralRolloff: 0.1,
        spectralBandwidth: 0.1,
        spectralContrast: 0.1,
        zeroCrossingRate: 0.1,
        mfccMean: [],
        rmsEnergy: 0.1,
        loudness: -12,
        dynamicRange: 5,
        instrumentPredictions: [],
        analysisDurationMs: 10,
      },
    })

    const names = new Set(result.map((tag) => tag.name))
    // perc-metal is unknown, should be rejected
    expect(names.has('perc-metal')).toBe(false)
    // snare is a known instrument, should survive
    expect(names.has('snare')).toBe(true)
    // All tags should be instrument category
    expect(result.every((tag) => tag.category === 'instrument')).toBe(true)
    // At most one instrument tag
    expect(result.filter((tag) => tag.category === 'instrument')).toHaveLength(1)
  })
})
