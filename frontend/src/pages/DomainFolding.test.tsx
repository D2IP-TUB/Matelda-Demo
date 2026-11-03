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

const box = (fold: string) => document.querySelector(`[data-fold="${fold}"]`) as HTMLElement
const drag = (source: Element, target: Element) => {
  fireEvent.dragStart(source)
  fireEvent.dragOver(target)
  fireEvent.drop(target)
  fireEvent.dragEnd(source)
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
    drag(await screen.findByRole('button', { name: 't4' }), box('F0'))
    expect(folds()).toEqual(['F0'])
    expect(within(box('F0')).getByText('t4')).toBeInTheDocument()
  })

  it('merges a fold into the one it is dropped on', async () => {
    renderPage()
    drag(await screen.findByLabelText('Drag fold F1'), box('F0'))
    expect(folds()).toEqual(['F0'])
    expect(within(box('F0')).getAllByRole('button', { name: /^t\d$/ }).map((b) => b.textContent)).toEqual([
      't1', 't2', 't3', 't4',
    ])
  })

  it('splits a fold at the scissors between two tables', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Split F0 after t2' }))
    expect(folds()).toEqual(['F0 - Split 1', 'F0 - Split 2', 'F1'])
    expect(screen.queryByRole('button', { name: 'Split F1 after t4' })).toBeNull()
  })

  it('opens a popup with the table when a table is clicked, and loads it only then', async () => {
    renderPage()
    await screen.findByText('t1')
    expect(m.fetchDirtyPage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 't1' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('columnheader', { name: 'a' })).toBeInTheDocument()
    expect(m.fetchDirtyPage).toHaveBeenCalledTimes(1)
    expect(m.fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 0, 20)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the popup with Escape or a click on the backdrop', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 't1' }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 't1' }))
    fireEvent.click(await screen.findByTestId('backdrop'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('saves the edited folds and moves on', async () => {
    renderPage()
    drag(await screen.findByRole('button', { name: 't4' }), box('F0'))
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
