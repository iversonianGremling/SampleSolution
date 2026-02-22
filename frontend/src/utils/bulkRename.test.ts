import { describe, expect, it } from 'vitest'
import { applyBulkRenameRules, type BulkRenameRules, DEFAULT_BULK_RENAME_RULES } from './bulkRename'

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
})
