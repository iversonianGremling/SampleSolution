import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExtractCategorizedTagsFromText } = vi.hoisted(() => ({
  mockExtractCategorizedTagsFromText: vi.fn(),
}))

vi.mock('./ollama.js', () => ({
  extractCategorizedTagsFromText: mockExtractCategorizedTagsFromText,
}))

import {
  getTagMetadata,
  parseFilenameTags,
  parseFilenameTagsSmart,
} from './audioAnalysis.js'

describe('filename tag parsing', () => {
  beforeEach(() => {
    mockExtractCategorizedTagsFromText.mockReset()
  })

  it('maps obvious filename words into semantic categories by default', () => {
    const tags = parseFilenameTags('BigClap_FAT_OneShot_909.wav', null)
    const byTag = new Map(tags.map((tag) => [tag.tag, tag]))

    expect(byTag.get('clap')?.category).toBe('instrument')
    expect(byTag.get('fat')?.category).toBe('energy')
    expect(byTag.get('oneshot')?.category).toBe('type')
    expect(byTag.get('909')?.category).toBe('instrument')
  })

  it('falls back to heuristic parsing when Ollama returns no tags', async () => {
    mockExtractCategorizedTagsFromText.mockResolvedValueOnce([])

    const tags = await parseFilenameTagsSmart('clap_dry_oneshot.wav', null)
    const byTag = new Map(tags.map((tag) => [tag.tag, tag]))

    expect(byTag.get('clap')?.category).toBe('instrument')
    expect(byTag.get('dry')?.category).toBe('general')
    expect(byTag.get('oneshot')?.category).toBe('type')
  })

  it('merges Ollama tags with heuristic tags and keeps best confidence', async () => {
    mockExtractCategorizedTagsFromText.mockResolvedValueOnce([
      { tag: 'melancholic', category: 'general', confidence: 0.88 },
      { tag: 'clap', category: 'instrument', confidence: 0.99 },
    ])

    const tags = await parseFilenameTagsSmart('clap.wav', null)
    const byTag = new Map(tags.map((tag) => [tag.tag, tag]))

    expect(byTag.get('melancholic')?.category).toBe('general')
    expect(byTag.get('clap')?.confidence).toBe(0.99)
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

  it('honors explicit category overrides for metadata colors', () => {
    const metadata = getTagMetadata('clap', 'instrument')
    expect(metadata.category).toBe('instrument')
    expect(metadata.color).toBe('#22c55e')
  })
})
