import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { getLang } from '../i18n'
import { LanguageToggle } from './LanguageToggle'

it('shows the current language and switches', () => {
  render(<LanguageToggle />)
  const btn = screen.getByRole('button', { name: 'Auf Deutsch umschalten' })
  expect(btn).toHaveTextContent('EN')
  fireEvent.click(btn)
  expect(getLang()).toBe('de')
  const back = screen.getByRole('button', { name: 'Switch to English' })
  expect(back).toHaveTextContent('DE')
})
