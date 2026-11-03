import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as api from '../lib/api'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { Intro } from './Intro'

vi.mock('../lib/api', () => ({
  fetchTables: vi.fn(),
  fetchDirtyPage: vi.fn(),
  fetchCompare: vi.fn(),
}))

const fetchTables = vi.mocked(api.fetchTables)
const fetchDirtyPage = vi.mocked(api.fetchDirtyPage)
const fetchCompare = vi.mocked(api.fetchCompare)

function renderIntro(session: Record<string, unknown>) {
  const pb = new FakePocketBase()
  const sessions = new SessionService(pb as any, seedSession(pb, session))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter>
          <Intro />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

const page = (over = {}) => ({
  columns: ['a', 'b'],
  rows: [['1', '2']],
  total_rows: 250,
  offset: 0,
  ...over,
})

beforeEach(() => {
  fetchTables.mockReset().mockResolvedValue(['t1', 't2'])
  fetchDirtyPage.mockReset().mockResolvedValue(page())
  fetchCompare.mockReset().mockResolvedValue({
    columns: ['a', 'b'],
    dirty_rows: [['1', 'x'], ['3', '4']],
    clean_rows: [['1', '2'], ['3', '4']],
    diff: [[false, true], [false, false]],
    offset: 0,
    total_rows: 2,
    total_cells: 4,
    differing_cells: 1,
    error_rate: 25,
  })
})

describe('Intro', () => {
  it('asks for a room when there is no dataset', async () => {
    renderIntro({})
    expect(await screen.findByRole('alert')).toHaveTextContent('No dataset yet')
    expect(screen.getByRole('link', { name: /Lobby/ })).toHaveAttribute('href', '/lobby')
    expect(fetchTables).not.toHaveBeenCalled()
  })

  it('lists the tables and previews the first one', async () => {
    renderIntro({ dataset_select: 'demo' })
    expect(await screen.findByText(/2 table\(s\)/)).toBeInTheDocument()
    expect(await screen.findByText('Rows: 250 · Columns: 2')).toBeInTheDocument()
    expect(fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 0, 100)
    expect(screen.getByRole('columnheader', { name: 'a' })).toBeInTheDocument()
  })

  it('pages through the preview 100 rows at a time', async () => {
    renderIntro({ dataset_select: 'demo' })
    await screen.findByText('Rows: 250 · Columns: 2')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 100, 100))
  })

  it('shows compare stats and highlights differing cells on both sides', async () => {
    renderIntro({ dataset_select: 'demo' })
    fireEvent.click(await screen.findByRole('tab', { name: 'Dirty vs Clean' }))
    expect(await screen.findByText('25.00%')).toBeInTheDocument()
    expect(screen.getByText('Total cells')).toBeInTheDocument()
    expect(screen.getByText('Differing cells')).toBeInTheDocument()
    expect(document.querySelectorAll('td.diff-dirty')).toHaveLength(1)
    expect(document.querySelectorAll('td.diff-clean')).toHaveLength(1)
  })

  it('shows a warning when the table has no clean version', async () => {
    fetchCompare.mockRejectedValue(new Error('No clean.csv for this table'))
    renderIntro({ dataset_select: 'demo' })
    fireEvent.click(await screen.findByRole('tab', { name: 'Dirty vs Clean' }))
    expect(await screen.findByText(/No clean.csv/)).toBeInTheDocument()
  })

  it('shows an error when the tables cannot be loaded', async () => {
    fetchTables.mockRejectedValue(new Error('Could not load tables'))
    renderIntro({ dataset_select: 'demo' })
    expect(await screen.findByText(/Could not load tables/)).toBeInTheDocument()
  })

  it('handles a dataset without tables', async () => {
    fetchTables.mockResolvedValue([])
    renderIntro({ dataset_select: 'demo' })
    expect(await screen.findByText('No tables found in this dataset.')).toBeInTheDocument()
  })

  it('links on to Configurations', async () => {
    renderIntro({ dataset_select: 'demo' })
    const link = await screen.findByRole('link', { name: /Configurations/ })
    expect(within(link.parentElement!).getByRole('link')).toHaveAttribute('href', '/configuration')
  })
})
