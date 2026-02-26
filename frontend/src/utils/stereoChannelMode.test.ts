import { describe, expect, it } from 'vitest'
import { matchesStereoChannelMode } from './stereoChannelMode'

describe('matchesStereoChannelMode', () => {
  it('returns true for all mode', () => {
    expect(matchesStereoChannelMode('all', {}, null)).toBe(true)
  })

  it('uses raw stereoWidth before channels', () => {
    const sample = { stereoWidth: 0.1, channels: 2 }

    expect(matchesStereoChannelMode('mono', sample, 0.9)).toBe(true)
    expect(matchesStereoChannelMode('stereo', sample, 0.9)).toBe(false)
  })

  it('treats stereoWidth threshold boundary as mono', () => {
    const sample = { stereoWidth: 0.2 }

    expect(matchesStereoChannelMode('mono', sample, null)).toBe(true)
    expect(matchesStereoChannelMode('stereo', sample, null)).toBe(false)
  })

  it('uses mono tag fallback when stereoWidth is unavailable', () => {
    const sample = {
      channels: 2,
      tags: [{ name: 'Mono' }],
    }

    expect(matchesStereoChannelMode('mono', sample, null)).toBe(true)
    expect(matchesStereoChannelMode('stereo', sample, null)).toBe(false)
  })

  it('uses channels fallback when needed', () => {
    expect(matchesStereoChannelMode('mono', { channels: 1 }, null)).toBe(true)
    expect(matchesStereoChannelMode('stereo', { channels: 1 }, null)).toBe(false)
    expect(matchesStereoChannelMode('mono', { channels: 2 }, null)).toBe(false)
    expect(matchesStereoChannelMode('stereo', { channels: 2 }, null)).toBe(true)
  })

  it('uses normalized fallback for legacy samples with no other signal', () => {
    expect(matchesStereoChannelMode('mono', {}, 0.01)).toBe(true)
    expect(matchesStereoChannelMode('stereo', {}, 0.01)).toBe(false)
    expect(matchesStereoChannelMode('mono', {}, 0.03)).toBe(false)
    expect(matchesStereoChannelMode('stereo', {}, 0.03)).toBe(true)
  })

  it('returns false when mono/stereo cannot be determined', () => {
    expect(matchesStereoChannelMode('mono', {}, null)).toBe(false)
    expect(matchesStereoChannelMode('stereo', {}, undefined)).toBe(false)
  })
})
