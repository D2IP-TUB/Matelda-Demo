import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './App'
import { PAGES } from './routes'

describe('routes', () => {
  it.each(PAGES.map((p) => [p.path, p.title]))('renders %s with its title', (path, title) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  })

  it('redirects / to the lobby', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Lobby' })).toBeInTheDocument()
  })
})
