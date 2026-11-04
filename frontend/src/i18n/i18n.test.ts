import { act, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { getLang, setLang, useT } from './index'

function Probe() {
  return createElement('p', null, useT().common.langSwitchLabel)
}

describe('i18n', () => {
  it('defaults to English', () => {
    expect(getLang()).toBe('en')
  })
  it('ignores an invalid stored value', () => {
    localStorage.setItem('matelda-lang', 'fr')
    expect(getLang()).toBe('en')
  })
  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error()
    })
    expect(getLang()).toBe('en')
    expect(() => setLang('de')).not.toThrow()
    vi.restoreAllMocks()
  })
  it('setLang stores, sets html lang and notifies', () => {
    render(createElement(Probe))
    expect(screen.getByText('Auf Deutsch umschalten')).toBeInTheDocument()
    act(() => setLang('de'))
    expect(localStorage.getItem('matelda-lang')).toBe('de')
    expect(document.documentElement.lang).toBe('de')
    expect(screen.getByText('Switch to English')).toBeInTheDocument()
  })
})
