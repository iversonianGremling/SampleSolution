import { describe, expect, it, vi } from 'vitest'
import { handleTrustedTourAdvanceClick, isTrustedTourClick } from './tourEventGuards'

describe('tourEventGuards', () => {
  it('treats non-trusted clicks as synthetic', () => {
    expect(isTrustedTourClick({ isTrusted: false })).toBe(false)
    expect(isTrustedTourClick({ isTrusted: true })).toBe(true)
  })

  it('ignores programmatic element.click events', () => {
    const button = document.createElement('button')
    const onAdvance = vi.fn()
    const onBeforeAdvance = vi.fn()

    button.addEventListener('click', (event) => {
      handleTrustedTourAdvanceClick(event, onAdvance, onBeforeAdvance)
    })

    button.click()

    expect(onBeforeAdvance).not.toHaveBeenCalled()
    expect(onAdvance).not.toHaveBeenCalled()
  })

  it('advances exactly once for a trusted click after synthetic attempts', () => {
    const onAdvance = vi.fn()
    const onBeforeAdvance = vi.fn()

    handleTrustedTourAdvanceClick({ isTrusted: false }, onAdvance, onBeforeAdvance)
    handleTrustedTourAdvanceClick({ isTrusted: false }, onAdvance, onBeforeAdvance)
    handleTrustedTourAdvanceClick({ isTrusted: true }, onAdvance, onBeforeAdvance)

    expect(onBeforeAdvance).toHaveBeenCalledTimes(1)
    expect(onAdvance).toHaveBeenCalledTimes(1)
  })
})
