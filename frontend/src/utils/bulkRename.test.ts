import { describe, expect, it } from 'vitest'
import {
  applyBulkRenameRules,
  DEFAULT_BULK_RENAME_RULES,
  matchesBulkRenameSearchText,
  type BulkRenameRules,
} from './bulkRename'

function withRules(overrides: Partial<BulkRenameRules>): BulkRenameRules {
  return {
    ...DEFAULT_BULK_RENAME_RULES,
    ...overrides,
  }
}

describe('applyBulkRenameRules', () => {
  it('applies search/replace with case-insensitive matching by default', () => {
    const result = applyBulkRenameRules('Kick LOOP', withRules({
      searchText: 'loop',
      replaceText: 'hit',
    }), 0)

    expect(result).toBe('Kick hit')
  })

  it('supports case conversion modes', () => {
    expect(
      applyBulkRenameRules('big room snare', withRules({ caseMode: 'title' }), 0)
    ).toBe('Big Room Snare')

    expect(
      applyBulkRenameRules('Big Room Snare', withRules({ caseMode: 'snake' }), 0)
    ).toBe('big_room_snare')
  })

  it('adds numbering as suffix', () => {
    const result = applyBulkRenameRules('snare', withRules({
      numberingEnabled: true,
      numberingStart: 3,
      numberingPad: 3,
      numberingSeparator: '_',
      numberingPosition: 'suffix',
    }), 2)

    expect(result).toBe('snare_005')
  })

  it('adds numbering as prefix', () => {
    const result = applyBulkRenameRules('hat', withRules({
      numberingEnabled: true,
      numberingStart: 1,
      numberingPad: 2,
      numberingSeparator: '-',
      numberingPosition: 'prefix',
    }), 4)

    expect(result).toBe('05-hat')
  })

  it('supports native regex replacement', () => {
    const result = applyBulkRenameRules('kick_808_take12', withRules({
      searchText: '(kick|808)_',
      matchRegex: true,
      replaceText: '',
    }), 0)

    expect(result).toBe('take12')
  })

  it('supports match-only mode without replacement', () => {
    const result = applyBulkRenameRules('Kick LOOP', withRules({
      searchText: 'loop',
      replaceText: 'hit',
      replaceMatches: false,
    }), 0)

    expect(result).toBe('Kick LOOP')
  })

  it('ignores invalid regex patterns safely', () => {
    const result = applyBulkRenameRules('snare_loop', withRules({
      searchText: '[',
      matchRegex: true,
      replaceText: 'x',
    }), 0)

    expect(result).toBe('snare_loop')
  })
})

describe('matchesBulkRenameSearchText', () => {
  it('matches using native regex when enabled', () => {
    const rules = withRules({
      searchText: '^kick_[0-9]+$',
      matchRegex: true,
    })

    expect(matchesBulkRenameSearchText('kick_12', rules)).toBe(true)
    expect(matchesBulkRenameSearchText('kick_loop', rules)).toBe(false)
  })

  it('returns false for invalid regex patterns', () => {
    const rules = withRules({
      searchText: '[',
      matchRegex: true,
    })

    expect(matchesBulkRenameSearchText('kick_12', rules)).toBe(false)
  })
})
