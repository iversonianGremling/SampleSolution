import { describe, expect, it } from 'vitest'
import { normalizeReviewedTagsForWrite } from './slices.js'

describe('normalizeReviewedTagsForWrite', () => {
  it('rejects non-instrument tags even when they come from reviewed output', () => {
    const result = normalizeReviewedTagsForWrite([
      { name: 'lofi', category: 'character' },
      { name: 'vinyl', category: 'instrument' },
      { name: 'snare', category: 'instrument' },
    ])

    expect(result).toEqual([{ name: 'snare', category: 'instrument' }])
  })

  it('canonicalizes aliases and enforces a single instrument', () => {
    const result = normalizeReviewedTagsForWrite([
      { name: '808', category: 'instrument' },
      { name: 'snare', category: 'instrument' },
    ])

    expect(result).toEqual([{ name: 'kick', category: 'instrument' }])
  })

  it('returns an empty set when no known instrument tag survives', () => {
    const result = normalizeReviewedTagsForWrite([
      { name: 'lofi', category: 'character' },
      { name: 'hiphop', category: 'general' },
      { name: 'vinyl02', category: 'instrument' },
    ])

    expect(result).toEqual([])
  })
})
