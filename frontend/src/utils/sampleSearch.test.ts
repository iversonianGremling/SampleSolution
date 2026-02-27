import { describe, expect, it } from 'vitest'
import type { SliceWithTrackExtended } from '../types'
import { matchesSampleSearchTerm, normalizeSampleSearchTerm } from './sampleSearch'

function buildSample(overrides: Partial<SliceWithTrackExtended> = {}): SliceWithTrackExtended {
  return {
    id: 1,
    trackId: 1,
    name: 'Kick 01',
    startTime: 0,
    endTime: 1,
    filePath: '/data/slices/kick-01.wav',
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    tags: [],
    folderIds: [],
    track: {
      title: 'Drum Hits',
      youtubeId: '',
    },
    ...overrides,
  }
}

describe('matchesSampleSearchTerm', () => {
  it('does not match path-only text in all-fields scope', () => {
    const sample = buildSample({
      name: 'Kick 01',
      track: { title: 'Drum Hits', youtubeId: '' },
    })
    const search = normalizeSampleSearchTerm('slice')

    expect(matchesSampleSearchTerm(sample, search, 'all')).toBe(false)
  })

  it('matches path text when custom scope includes path', () => {
    const sample = buildSample()
    const search = normalizeSampleSearchTerm('slice')

    expect(
      matchesSampleSearchTerm(sample, search, 'custom', {
        customFields: ['path'],
      }),
    ).toBe(true)
  })

  it('still matches sample names in all-fields scope', () => {
    const sample = buildSample({ name: 'Slice 1' })
    const search = normalizeSampleSearchTerm('slice')

    expect(matchesSampleSearchTerm(sample, search, 'all')).toBe(true)
  })
})
