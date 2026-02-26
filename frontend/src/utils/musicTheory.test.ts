import { describe, expect, it } from 'vitest'
import { freqToNoteName, freqToPitchDisplay } from './musicTheory'

describe('freqToPitchDisplay', () => {
  it('formats concert A as A4 with zero cents', () => {
    expect(freqToPitchDisplay(440)).toEqual({
      note: 'A',
      octave: 4,
      cents: 0,
      noteWithOctave: 'A4',
      centsLabel: '+0 cents',
      compactCentsLabel: '+0c',
      fullLabel: 'A4 +0 cents',
      compactLabel: 'A4 +0c',
    })
  })

  it('reports signed cents around the nearest semitone', () => {
    const plusTwentyFiveCentsHz = 440 * Math.pow(2, 25 / 1200)
    const minusSeventeenCentsHz = 440 * Math.pow(2, -17 / 1200)

    expect(freqToPitchDisplay(plusTwentyFiveCentsHz)?.cents).toBe(25)
    expect(freqToPitchDisplay(minusSeventeenCentsHz)?.cents).toBe(-17)
  })

  it('stays compatible with note-class extraction', () => {
    const pitch = freqToPitchDisplay(329.63)
    expect(pitch?.note).toBe(freqToNoteName(329.63))
  })

  it('returns null for invalid or non-positive frequencies', () => {
    expect(freqToPitchDisplay(0)).toBeNull()
    expect(freqToPitchDisplay(-1)).toBeNull()
    expect(freqToPitchDisplay(Number.NaN)).toBeNull()
    expect(freqToPitchDisplay(Number.POSITIVE_INFINITY)).toBeNull()
  })
})
