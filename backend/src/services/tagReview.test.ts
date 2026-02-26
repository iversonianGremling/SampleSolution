import { describe, expect, it } from 'vitest'
import { reviewTagsLocally } from './tagReview.js'

describe('reviewTagsLocally congruence fallback', () => {
  it('rescues missing tags from congruent sample-name fragments', () => {
    const result = reviewTagsLocally({
      sampleName: 'clapperBoom_take03.wav',
      modelTags: [],
      previousAutoTags: [],
      filenameTags: [],
      maxTags: 10,
    })

    expect(result.map((tag) => tag.name)).toContain('clap')
  })

  it('drops low-confidence filename tags that are not congruent with name or folder', () => {
    const result = reviewTagsLocally({
      sampleName: 'mysterygrainfile_07.wav',
      folderPath: 'imports/new-pack',
      modelTags: [],
      previousAutoTags: [],
      filenameTags: [
        { tag: 'snare', confidence: 0.2, category: 'instrument' },
      ],
      maxTags: 10,
    })

    expect(result).toEqual([])
  })

  it('keeps low-confidence filename tags when name is congruent', () => {
    const result = reviewTagsLocally({
      sampleName: 'snareRoom_take1.wav',
      modelTags: [],
      previousAutoTags: [],
      filenameTags: [
        { tag: 'snare', confidence: 0.2, category: 'instrument' },
      ],
      maxTags: 10,
    })

    expect(result.map((tag) => tag.name)).toContain('snare')
  })

  it('treats path-derived instrument hints as highest-priority evidence', () => {
    const result = reviewTagsLocally({
      sampleName: 'mystery_take1.wav',
      folderPath: '/imports/Drum Loops/Kicks/Analog',
      instrumentType: 'kick',
      modelTags: ['snare'],
      previousAutoTags: ['hihat'],
      filenameTags: [
        { tag: 'snare', confidence: 0.95, category: 'instrument' },
      ],
      maxTags: 10,
    })

    expect(result).toEqual([{ name: 'kick', category: 'instrument' }])
  })

  it('prioritizes filename/path evidence when model confidence is low', () => {
    const result = reviewTagsLocally({
      sampleName: 'Garage Foley - 1.wav',
      modelTags: ['percussion'],
      modelConfidence: 0.55,
      previousAutoTags: [],
      filenameTags: [
        { tag: 'foley', confidence: 0.9, category: 'instrument' },
      ],
      maxTags: 10,
    })

    expect(result).toEqual([{ name: 'foley', category: 'instrument' }])
  })

  it('keeps model-first ordering when model confidence is strong', () => {
    const result = reviewTagsLocally({
      sampleName: 'Garage Foley - 1.wav',
      modelTags: ['percussion'],
      modelConfidence: 0.9,
      previousAutoTags: [],
      filenameTags: [
        { tag: 'foley', confidence: 0.9, category: 'instrument' },
      ],
      maxTags: 10,
    })

    expect(result).toEqual([{ name: 'percussion', category: 'instrument' }])
  })

  it('falls back to ambience for generic slice names when model confidence is low', () => {
    const result = reviewTagsLocally({
      sampleName: 'Slice 1',
      folderPath: 'Slice 1',
      modelTags: ['vocal'],
      modelConfidence: 0.6,
      previousAutoTags: ['kick'],
      filenameTags: [],
      maxTags: 10,
    })

    expect(result).toEqual([{ name: 'ambience', category: 'instrument' }])
  })
})
