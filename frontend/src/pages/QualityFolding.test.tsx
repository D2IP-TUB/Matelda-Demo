import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as api from '../lib/api'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { QualityFolding } from './QualityFolding'

vi.mock('../lib/api', () => ({
  fetchPipeline: vi.fn(),
  fetchStrategies: vi.fn(),
  startQualityFolding: vi.fn(),
  fetchJob: vi.fn(),
  fetchCellFolds: vi.fn(),
  fetchFoldCells: vi.fn(),
  fetchDirtyPage: vi.fn(),
  moveCell: vi.fn(),
  mergeCellFolds: vi.fn(),
  splitCellFold: vi.fn(),
  setFoldLabel: vi.fn(),
}))

const m = vi.mocked(api)
const F0 = 'D0 / Cell Fold 0'
const F1 = 'D0 / Cell Fold 1'
const F2 = 'D1 / Cell Fold 0'
const SUMMARY = [
  { name: F0, domain: 'D0', cell_count: 25, label: 'correct' as const, tables: { t1: { a: 25 } } },
  { name: F1, domain: 'D0', cell_count: 2, label: 'neutral' as const, tables: { t1: { a: 2 } } },
  { name: F2, domain: 'D1', cell_count: 1, label: 'false' as const, tables: { t3: { c: 1 } } },
]
const config = (over = {}) => ({
  selected_dataset: 'demo',
  labeling_budget: 10,
  selected_strategies: ['Typo Detector'],
  domain_folds: { 'Domain Fold 0': ['t1'] },
  has_cell_folds: true,
  ...over,
})
const cellOf = (i: number) => ({
  table: 't1', row: i, col: 'a', val: `v${i}`,
  strategies: i === 0 ? [] : ['Typo Detector'], selected_for_labeling: false,
})

function renderPage(session: Record<string, unknown> = { pipeline_path: 'p1' }) {
  const pb = new FakePocketBase()
  const sessions = new SessionService(pb as any, seedSession(pb, session))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter initialEntries={['/quality-folding']}>
          <Routes>
            <Route path="/quality-folding" element={<QualityFolding pollMs={5} />} />
            <Route path="/labeling" element={<h1>Labeling</h1>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  m.fetchPipeline.mockReset().mockResolvedValue(config() as any)
  m.fetchStrategies.mockReset().mockResolvedValue(['Typo Detector', 'Outlier Detector - Gaussian'])
  m.startQualityFolding.mockReset().mockResolvedValue('job1')
  m.fetchJob.mockReset().mockResolvedValue({ id: 'job1', state: 'done' })
  m.fetchCellFolds.mockReset().mockResolvedValue(SUMMARY)
  m.fetchFoldCells.mockReset().mockImplementation(async (_n, fold, offset, limit) => {
    const total = fold === F0 ? 25 : 2
    const count = Math.max(0, Math.min(limit, total - offset))
    return { cells: Array.from({ length: count }, (_, i) => cellOf(offset + i)), total } as any
  })
  m.fetchDirtyPage.mockReset().mockImplementation(async (_d, _t, offset) => ({
    columns: ['a'], rows: Array.from({ length: 11 }, (_, i) => [`r${offset + i}`]), total_rows: 40, offset,
  }))
  for (const fn of [m.moveCell, m.mergeCellFolds, m.splitCellFold, m.setFoldLabel]) {
    fn.mockReset().mockResolvedValue(SUMMARY)
  }
})

const showFold = async (fold: string) => fireEvent.click(await screen.findByRole('button', { name: `Show ${fold}` }))

describe('QualityFolding', () => {
  it('asks to configure a pipeline first', async () => {
    renderPage({})
    expect(await screen.findByRole('alert')).toHaveTextContent('Pipeline not configured')
    expect(screen.getByRole('link', { name: /Configurations/ })).toHaveAttribute('href', '/configuration')
  })

  it('asks for domain folds when there are none', async () => {
    m.fetchPipeline.mockResolvedValue(config({ domain_folds: undefined, has_cell_folds: false }) as any)
    renderPage()
    expect(await screen.findByText(/Run domain based folding first/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Domain Folding/ })).toHaveAttribute('href', '/domain-folding')
  })

  it('lists cell folds per domain with counts and label colours', async () => {
    renderPage()
    expect(await screen.findByText(F0)).toHaveClass('label-correct')
    expect(screen.getByText(F2)).toHaveClass('label-false')
    expect(screen.getByText(F1)).toHaveClass('label-neutral')
    expect(screen.getByText('25 cells')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'D1' })).toBeInTheDocument()
  })

  it('runs with the edited budget and strategies and refreshes the folds', async () => {
    renderPage()
    await screen.findByText(F0)
    fireEvent.change(screen.getByLabelText('Labeling budget'), { target: { value: '20' } })
    fireEvent.click(await screen.findByLabelText('Outlier Detector - Gaussian'))
    const calls = m.fetchCellFolds.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Run quality based folding' }))
    expect(m.startQualityFolding).toHaveBeenCalledWith('p1', {
      labeling_budget: 20,
      selected_strategies: ['Typo Detector', 'Outlier Detector - Gaussian'],
    })
    await waitFor(() => expect(m.fetchCellFolds.mock.calls.length).toBeGreaterThan(calls))
  })

  it('cannot run without any strategy', async () => {
    renderPage()
    fireEvent.click(await screen.findByLabelText('Typo Detector'))
    expect(screen.getByRole('button', { name: 'Run quality based folding' })).toBeDisabled()
  })

  it('shows the error of a failed job', async () => {
    m.fetchJob.mockResolvedValue({ id: 'job1', state: 'failed', error: 'raha exploded' })
    renderPage()
    await screen.findByText(F0)
    fireEvent.click(screen.getByRole('button', { name: 'Run quality based folding' }))
    expect(await screen.findByText(/raha exploded/)).toBeInTheDocument()
  })

  it('loads cells 20 at a time', async () => {
    renderPage()
    await showFold(F0)
    expect(await screen.findAllByTestId('cell')).toHaveLength(20)
    expect(m.fetchFoldCells).toHaveBeenCalledWith('p1', F0, 0, 20)
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(screen.getAllByTestId('cell')).toHaveLength(25))
    expect(m.fetchFoldCells).toHaveBeenCalledWith('p1', F0, 20, 20)
  })

  it('opens a dialog with the detection results and a table excerpt', async () => {
    renderPage()
    await showFold(F0)
    fireEvent.click((await screen.findAllByTestId('cell'))[7])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Typo Detector')).toBeInTheDocument()
    await waitFor(() => expect(m.fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 2, 11))
    expect(await within(dialog).findByText('r7')).toHaveClass('diff-dirty')
  })

  it('says so when a cell passed all checks, and the excerpt starts at row 0 near the top', async () => {
    renderPage()
    await showFold(F0)
    fireEvent.click((await screen.findAllByTestId('cell'))[0])
    expect(await screen.findByText(/passed all error detection checks/)).toBeInTheDocument()
    await waitFor(() => expect(m.fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 0, 11))
  })

  it('moves a cell to another fold from the dialog', async () => {
    renderPage()
    await showFold(F0)
    fireEvent.click((await screen.findAllByTestId('cell'))[0])
    fireEvent.change(await screen.findByLabelText('Move cell to'), { target: { value: F1 } })
    await waitFor(() =>
      expect(m.moveCell).toHaveBeenCalledWith('p1', { table: 't1', row: 0, col: 'a' }, F1),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('merges the selected folds in selection order', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Merge folds' }))
    const confirm = screen.getByRole('button', { name: 'Confirm merge' })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByLabelText(`Select fold ${F1}`))
    fireEvent.click(screen.getByLabelText(`Select fold ${F0}`))
    fireEvent.click(confirm)
    await waitFor(() => expect(m.mergeCellFolds).toHaveBeenCalledWith('p1', [F1, F0]))
  })

  it('splits a fold after the selected cell', async () => {
    renderPage()
    await showFold(F0)
    fireEvent.click(await screen.findByRole('button', { name: 'Split folds' }))
    fireEvent.click(await screen.findByLabelText('Select cell t1 1 a'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm split' }))
    await waitFor(() =>
      expect(m.splitCellFold).toHaveBeenCalledWith('p1', F0, [{ table: 't1', row: 1, col: 'a' }]),
    )
  })

  it('bulk annotates folds as correct, false or cleared', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Bulk annotate' }))
    fireEvent.click(screen.getByRole('button', { name: `Mark ${F1} correct` }))
    fireEvent.click(screen.getByRole('button', { name: `Mark ${F1} false` }))
    fireEvent.click(screen.getByRole('button', { name: `Clear label of ${F2}` }))
    await waitFor(() => expect(m.setFoldLabel).toHaveBeenCalledTimes(3))
    expect(m.setFoldLabel).toHaveBeenCalledWith('p1', F1, 'correct')
    expect(m.setFoldLabel).toHaveBeenCalledWith('p1', F1, 'false')
    expect(m.setFoldLabel).toHaveBeenCalledWith('p1', F2, null)
  })

  it('shows the message of a rejected operation', async () => {
    m.mergeCellFolds.mockRejectedValue(new Error('Select at least two different folds to merge'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Merge folds' }))
    fireEvent.click(screen.getByLabelText(`Select fold ${F0}`))
    fireEvent.click(screen.getByLabelText(`Select fold ${F1}`))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }))
    expect(await screen.findByText(/at least two different folds/)).toBeInTheDocument()
  })

  it('continues to labeling', async () => {
    renderPage()
    await screen.findByText(F0)
    fireEvent.click(screen.getByRole('link', { name: /Next/ }))
    expect(await screen.findByRole('heading', { name: 'Labeling' })).toBeInTheDocument()
  })
})
