import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as api from '../lib/api'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { DomainFolding } from './DomainFolding'

vi.mock('../lib/api', () => ({
  fetchPipeline: vi.fn(),
  startDomainFolding: vi.fn(),
  saveDomainFolds: vi.fn(),
  fetchJob: vi.fn(),
  fetchDirtyPage: vi.fn(),
}))

const m = vi.mocked(api)
const FOLDS = { F0: ['t1', 't2', 't3'], F1: ['t4'] }
const config = (folds: Record<string, string[]> | null = FOLDS) => ({
  selected_dataset: 'demo',
  labeling_budget: 10,
  selected_strategies: ['x'],
  ...(folds ? { domain_folds: folds } : {}),
})

function renderPage(session: Record<string, unknown> = { pipeline_path: 'p1' }) {
  const pb = new FakePocketBase()
  const sessions = new SessionService(pb as any, seedSession(pb, session))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter initialEntries={['/domain-folding']}>
          <Routes>
            <Route path="/domain-folding" element={<DomainFolding pollMs={5} />} />
            <Route path="/quality-folding" element={<h1>Quality Folding</h1>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

const folds = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)

beforeEach(() => {
  m.fetchPipeline.mockReset().mockResolvedValue(config() as any)
  m.startDomainFolding.mockReset().mockResolvedValue('job1')
  m.saveDomainFolds.mockReset().mockImplementation(async (_n, f) => f)
  m.fetchJob.mockReset().mockResolvedValue({ id: 'job1', state: 'done' })
  m.fetchDirtyPage.mockReset().mockResolvedValue({ columns: ['a'], rows: [['1']], total_rows: 1, offset: 0 })
})

describe('DomainFolding', () => {
  it('asks to configure a pipeline first', async () => {
    renderPage({})
    expect(await screen.findByRole('alert')).toHaveTextContent('Pipeline not configured')
    expect(screen.getByRole('link', { name: /Configurations/ })).toHaveAttribute('href', '/configuration')
    expect(m.fetchPipeline).not.toHaveBeenCalled()
  })

  it('lists the saved folds and their tables', async () => {
    renderPage()
    expect(await screen.findByText('t1')).toBeInTheDocument()
    expect(folds()).toEqual(['F0', 'F1'])
    expect(screen.getByText('t4')).toBeInTheDocument()
  })

  it('shows a hint when there are no folds yet', async () => {
    m.fetchPipeline.mockResolvedValue(config(null) as any)
    renderPage()
    expect(await screen.findByText(/No domain folds yet/)).toBeInTheDocument()
  })

  it('runs the folding job and reloads the folds when it is done', async () => {
    m.fetchPipeline
      .mockResolvedValueOnce(config() as any)
      .mockResolvedValue(config({ N0: ['t1'], N1: ['t2', 't3', 't4'] }) as any)
    m.fetchJob.mockResolvedValueOnce({ id: 'job1', state: 'running' }).mockResolvedValue({ id: 'job1', state: 'done' })
    renderPage()
    await screen.findByText('t1') // the Run button is disabled until the pipeline has loaded
    fireEvent.click(screen.getByRole('button', { name: 'Run domain based folding' }))
    expect(m.startDomainFolding).toHaveBeenCalledWith('p1')
    await waitFor(() => expect(folds()).toEqual(['N0', 'N1']))
  })

  it('shows the error of a failed job', async () => {
    m.fetchJob.mockResolvedValue({ id: 'job1', state: 'failed', error: 'no folds' })
    renderPage()
    await screen.findByText('t1')
    fireEvent.click(screen.getByRole('button', { name: 'Run domain based folding' }))
    expect(await screen.findByText(/no folds/)).toBeInTheDocument()
  })

  it('moves a table and drops the emptied fold', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText('Move t4 to'), { target: { value: 'F0' } })
    expect(folds()).toEqual(['F0'])
  })

  it('merges two selected folds', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Merge folds' }))
    const confirm = screen.getByRole('button', { name: 'Confirm merge' })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Select fold F0'))
    fireEvent.click(screen.getByLabelText('Select fold F1'))
    fireEvent.click(confirm)
    expect(folds()).toEqual(['F0'])
    expect(screen.getByText('t4')).toBeInTheDocument()
  })

  it('splits a fold after the selected table', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Split folds' }))
    fireEvent.click(screen.getByLabelText('Select table t2'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm split' }))
    expect(folds()).toEqual(['F0 - Split 1', 'F0 - Split 2', 'F1'])
  })

  it('loads a table preview only when asked', async () => {
    renderPage()
    await screen.findByText('t1')
    expect(m.fetchDirtyPage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Preview t1' }))
    expect(await screen.findByRole('columnheader', { name: 'a' })).toBeInTheDocument()
    expect(m.fetchDirtyPage).toHaveBeenCalledTimes(1)
    expect(m.fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 0, 20)
  })

  it('saves the edited folds and moves on', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText('Move t4 to'), { target: { value: 'F0' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await screen.findByRole('heading', { name: 'Quality Folding' })
    expect(m.saveDomainFolds).toHaveBeenCalledWith('p1', { F0: ['t1', 't2', 't3', 't4'] })
  })

  it('stays on the page when saving fails', async () => {
    m.saveDomainFolds.mockRejectedValue(new Error('Table t1 is in more than one fold'))
    renderPage()
    await screen.findByText('t1')
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(await screen.findByText(/more than one fold/)).toBeInTheDocument()
    expect(within(document.body).queryByRole('heading', { name: 'Quality Folding' })).toBeNull()
  })
})
