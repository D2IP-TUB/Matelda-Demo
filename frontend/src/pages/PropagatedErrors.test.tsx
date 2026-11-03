import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as api from '../lib/api'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { PropagatedErrors } from './PropagatedErrors'

vi.mock('../lib/api', () => ({ fetchPropagation: vi.fn() }))
const m = vi.mocked(api)

const PAGE = {
  total: 45,
  propagated_total: 1,
  labeled_cells: [
    {
      table: 't1', row: 0, col: 'a', val: 'x', is_error: true, domain_fold: 'D0', cell_fold: 'F0',
      propagated_cells: [{ table: 't1', row: 5, col: 'a', val: 'y', confidence: 0.85, reason: 'same cell fold' }],
    },
    { table: 't2', row: 1, col: 'b', val: 'ok', is_error: false, domain_fold: 'D1', cell_fold: 'F2', propagated_cells: [] },
  ],
}

function renderPage(session: Record<string, unknown> = { pipeline_path: 'p1' }) {
  const pb = new FakePocketBase()
  const sessions = new SessionService(pb as any, seedSession(pb, session))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter>
          <PropagatedErrors />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  m.fetchPropagation.mockReset().mockResolvedValue(PAGE as any)
})

describe('PropagatedErrors', () => {
  it('asks to configure a pipeline first', async () => {
    renderPage({})
    expect(await screen.findByRole('alert')).toHaveTextContent('Pipeline not configured')
    expect(m.fetchPropagation).not.toHaveBeenCalled()
  })

  it('points to Labeling when propagation has not run', async () => {
    m.fetchPropagation.mockRejectedValue(new Error('Run label propagation first'))
    renderPage()
    expect(await screen.findByText(/Run label propagation first/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Go to Labeling/ })).toHaveAttribute('href', '/labeling')
  })

  it('shows the totals', async () => {
    renderPage()
    expect(await screen.findByText('45')).toBeInTheDocument()
    expect(screen.getByText('Labeled cells')).toBeInTheDocument()
    expect(screen.getByText('Propagated labels')).toBeInTheDocument()
  })

  it('expands a labeled cell to its details and the cells it was propagated to', async () => {
    renderPage()
    const toggle = await screen.findByRole('button', { name: /Cell: x/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Confidence: 85%/)).toBeNull()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Confidence: 85%/)).toBeInTheDocument()
    expect(screen.getByText(/same cell fold/)).toBeInTheDocument()
    expect(screen.getByText(/Domain fold: D0/)).toBeInTheDocument()
  })

  it('says so when nothing was propagated from a label', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Cell: ok/ }))
    expect(screen.getByText('No cells were propagated from this label')).toBeInTheDocument()
  })

  it('pages 20 labeled cells at a time', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Cell: x/ })
    expect(m.fetchPropagation).toHaveBeenCalledWith('p1', 0, 20)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(m.fetchPropagation).toHaveBeenCalledWith('p1', 20, 20))
  })

  it('links back to Labeling and on to Error Detection', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Cell: x/ })
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/labeling')
    expect(screen.getByRole('link', { name: /Next/ })).toHaveAttribute('href', '/error-detection')
  })
})
