import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './App'
import { PAGES } from './routes'
import { SessionProvider } from './session/SessionProvider'
import { SessionService } from './session/sessionService'
import { FakePocketBase } from './test/fakePocketBase'

vi.mock('./lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/api')>()),
  fetchDatasets: async () => [],
  fetchStrategies: async () => [],
  fetchPipelines: async () => [],
  suggestPipelineName: async () => 'x',
  fetchTables: async () => [],
}))

function renderAt(path: string) {
  const storage = { getItem: () => null, setItem: () => {} }
  const sessions = new SessionService(new FakePocketBase() as any, storage)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('routes', () => {
  it.each(PAGES.map((p) => [p.path, p.title]))('renders %s with its title', async (path, title) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  })

  it('shows the landing page at / with a way into the demo', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { level: 1, name: /hiding mistakes/i })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /play the demo/i })[0]).toHaveAttribute('href', '/lobby')
  })
})
