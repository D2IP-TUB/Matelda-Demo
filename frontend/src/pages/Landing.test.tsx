import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../i18n'
import { de } from '../i18n/de'
import { Landing } from './Landing'

const view = () => render(<MemoryRouter><Landing /></MemoryRouter>)

afterEach(() => act(() => setLang('en')))

describe('Landing', () => {
  // The language switch is hidden for now.
  it.skip('has a language toggle', () => {
    view()
    expect(screen.getByRole('button', { name: 'Auf Deutsch umschalten' })).toBeInTheDocument()
  })

  it('German hero, English demo data', () => {
    view()
    act(() => setLang('de'))
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent(de.landing.headline)
    expect(h1).toHaveTextContent(de.landing.headlineAccent)
    expect(screen.getAllByText('Hamburg 1,5').length).toBeGreaterThan(0)
    expect(screen.getByText('Typo Detector')).toBeInTheDocument()
  })
})
