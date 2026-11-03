import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as api from '../lib/api'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { ErrorDetection } from './ErrorDetection'

vi.mock('../lib/api', () => ({
  fetchPipeline: vi.fn(),
  startErrorDetection: vi.fn(),
  fetchErrorDetection: vi.fn(),
  fetchDetectedErrors: vi.fn(),
  fetchDirtyPage: vi.fn(),
  fetchJob: vi.fn(),
}))
const m = vi.mocked(api)

const SUMMARY = {
  time: '2025-01-01 10:00:00',
  metrics: { precision: 0.8, recall: 0.6, f1: 0.69 },
  tables: { t1: 150, t2: 3 },
}
const err = (row: number, confidence: number, extra = {}) => ({
  row, col: 'a', val: `v${row}`, confidence, source: 'Typo Detector', ...extra,
})

function renderPage(session: Record<string, unknown> = { pipeline_path: 'p1' }) {
  const pb = new FakePocketBase()
  const sessions = new SessionService(pb as any, seedSession(pb, session))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter>
          <ErrorDetection pollMs={5} />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  m.fetchPipeline.mockReset().mockResolvedValue({ selected_dataset: 'demo', labeling_budget: 10, selected_strategies: [] } as any)
  m.fetchErrorDetection.mockReset().mockResolvedValue(SUMMARY as any)
  m.startErrorDetection.mockReset().mockResolvedValue('job1')
  m.fetchJob.mockReset().mockResolvedValue({ id: 'job1', state: 'done' })
  m.fetchDirtyPage.mockReset().mockResolvedValue({
    columns: ['a'], rows: [['v0'], ['v1'], ['v2']], total_rows: 3, offset: 0,
  })
  m.fetchDetectedErrors.mockReset().mockImplementation(async (_n, _t, offset, limit) => ({
    errors: [err(0, 0.5), err(1, 0.87)].slice(0, limit).map((e) => ({ ...e, row: e.row + offset })),
    total: 150,
  }) as any)
})

describe('ErrorDetection', () => {
  it('asks to configure a pipeline first', async () => {
    renderPage({})
    expect(await screen.findByRole('alert')).toHaveTextContent('Pipeline not configured')
  })

  it('without a result offers to run detection and disables Next', async () => {
    m.fetchErrorDetection.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByRole('button', { name: 'Run error detection' })).toBeInTheDocument()
    expect(screen.queryByText('Precision')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next: View results' })).toBeDisabled()
  })

  it('runs detection and shows the metrics and the tables when the job is done', async () => {
    m.fetchErrorDetection.mockResolvedValueOnce(null).mockResolvedValue(SUMMARY as any)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Run error detection' }))
    expect(m.startErrorDetection).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('0.800')).toBeInTheDocument()
    expect(screen.getByText('0.600')).toBeInTheDocument()
    expect(screen.getByText('0.690')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /t1 \(150 potential errors\)/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Next: View results' })).toHaveAttribute('href', '/results')
  })

  it('shows the message of a failed job', async () => {
    m.fetchErrorDetection.mockResolvedValue(null)
    m.fetchJob.mockResolvedValue({ id: 'job1', state: 'failed', error: 'Error detection produced no result' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Run error detection' }))
    expect(await screen.findByText(/produced no result/)).toBeInTheDocument()
  })

  it('points back to Propagated Errors when there are no propagation results', async () => {
    m.fetchErrorDetection.mockResolvedValue(null)
    m.startErrorDetection.mockRejectedValue(new Error('Run label propagation first'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Run error detection' }))
    expect(await screen.findByText(/Run label propagation first/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Propagated Errors/ })).toHaveAttribute('href', '/propagated-errors')
  })

  it('expands a table: first 100 rows shaded by confidence, plus the error list', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /t1 \(150 potential errors\)/ }))
    expect(await screen.findByText('v0')).toBeInTheDocument()
    expect(m.fetchDirtyPage).toHaveBeenCalledTimes(1)
    expect(m.fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 0, 100)
    expect(m.fetchDetectedErrors).toHaveBeenCalledWith('p1', 't1', 0, 200)
    expect(m.fetchDetectedErrors).toHaveBeenCalledWith('p1', 't1', 0, 100)
    await waitFor(() => {
      const shaded = Array.from(document.querySelectorAll('.table-wrap td')).filter((td) =>
        /244,\s*177,\s*28/.test(td.getAttribute('style') ?? ''),
      )
      expect(shaded).toHaveLength(2)
      expect(shaded[1].getAttribute('style')).toMatch(/0\.87/)
    })
  })

  it('lists the errors with confidence and source, 100 per page', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /t1 \(150 potential errors\)/ }))
    expect(await screen.findByText(/Confidence: 87%/)).toBeInTheDocument()
    expect(screen.getAllByText(/Source: Typo Detector/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(m.fetchDetectedErrors).toHaveBeenCalledWith('p1', 't1', 100, 100))
  })

  it('says so when no errors were detected', async () => {
    m.fetchErrorDetection.mockResolvedValue({ ...SUMMARY, tables: {} } as any)
    renderPage()
    expect(await screen.findByText(/No errors detected/)).toBeInTheDocument()
  })
})
