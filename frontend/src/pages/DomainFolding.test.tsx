import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setLang } from '../i18n'
import { de } from '../i18n/de'
import * as api from '../lib/api'
import { RoomService } from '../rooms/roomService'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { pointerDrag, seedSession, touchSwipe } from '../test/helpers'
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

function renderPage(session: Record<string, unknown> = { pipeline_path: 'p1' }, again?: FakePocketBase, roomPb?: FakePocketBase) {
  const pb = again ?? roomPb ?? new FakePocketBase()
  // `again` = the same browser coming back: reuse its stored session instead of seeding a fresh one
  const sessions = new SessionService(pb as any, again ? { getItem: () => 's1234567890abcdef', setItem: () => {} } : seedSession(pb, session))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter initialEntries={['/domain-folding']}>
          <Routes>
            <Route path="/domain-folding" element={<DomainFolding pollMs={5} roomService={new RoomService(pb as any)} />} />
            <Route path="/quality-folding" element={<h1>Quality Folding</h1>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { pb, ...view }
}

const box = (fold: string) => document.querySelector(`[data-fold="${fold}"]`) as HTMLElement
const drag = pointerDrag
const folds = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)

beforeEach(() => {
  m.fetchPipeline.mockReset().mockResolvedValue(config() as any)
  m.startDomainFolding.mockReset().mockResolvedValue('job1')
  m.saveDomainFolds.mockReset().mockImplementation(async (_n, f) => f)
  m.fetchJob.mockReset().mockResolvedValue({ id: 'job1', state: 'done' })
  m.fetchDirtyPage.mockReset().mockResolvedValue({ columns: ['a'], rows: [['1']], total_rows: 1, offset: 0 })
})

describe('DomainFolding for a helper in a room', () => {
  function roomPb() {
    const pb = new FakePocketBase()
    pb.data.rooms = [{ id: 'rm1', name: 'r1', phase: 'labeling', dataset: 'demo', pipeline: 'p-room', host: 'pl1', pool: ['a'] }]
    pb.data.players = [
      { id: 'pl1', room: 'r1', token: 'tok', name: 'Blue Otter', budget: 2, vote: 'demo', created: '1' },
      { id: 'pl2', room: 'r1', token: 'tok2', name: 'Red Yeti', budget: 2, vote: 'demo', created: '2' },
    ]
    return pb
  }

  it('shows the host\'s folds read-only, without running, editing or saving', async () => {
    renderPage({ room_name: 'r1', player_token: 'tok2' }, undefined, roomPb())
    expect(await screen.findByText('t1')).toBeInTheDocument()
    expect(m.fetchPipeline).toHaveBeenCalledWith('p-room')
    expect(folds()).toEqual(['F0', 'F1'])
    expect(screen.queryByRole('button', { name: 'Run domain based folding' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Split/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to labeling' })).toHaveAttribute('href', '/labeling')
  })
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

  it('lays the fold rectangles out side by side in a grid', async () => {
    renderPage()
    await screen.findByText('t1')
    expect(box('F0').parentElement).toHaveClass('fold-grid')
    expect(box('F1').parentElement).toBe(box('F0').parentElement)
  })

  it('shows no fold boxes and no empty-state box when there are no folds yet', async () => {
    m.fetchPipeline.mockResolvedValue(config(null) as any)
    renderPage()
    const run = await screen.findByRole('button', { name: 'Run domain based folding' })
    await waitFor(() => expect(run).toBeEnabled())
    expect(screen.queryByText(/No domain folds yet/)).toBeNull()
    expect(screen.queryByLabelText(/Drag fold/)).toBeNull()
  })

  it('explains how to edit the folds behind an info button', async () => {
    renderPage()
    const info = await screen.findByRole('button', { name: 'How to edit the folds' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(info)
    expect(screen.getByRole('dialog', { name: 'Domain folding' })).toHaveTextContent(/drag a table onto another fold/i)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
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

  it('shows the spinner inside the Run button while the job runs, and nowhere else', async () => {
    m.fetchJob.mockResolvedValue({ id: 'job1', state: 'running' })
    renderPage()
    await screen.findByText('t1')
    const run = screen.getByRole('button', { name: 'Run domain based folding' })
    fireEvent.click(run)
    await waitFor(() => expect(run).toHaveAttribute('aria-busy', 'true'))
    expect(run.querySelector('.spinner')).not.toBeNull()
    expect(screen.queryByText('Running…')).toBeNull()
  })

  it('Continue saves the folds and shows the spinner while saving', async () => {
    m.saveDomainFolds.mockImplementation(() => new Promise(() => {}))
    renderPage()
    await screen.findByText('t1')
    const cont = screen.getByRole('button', { name: 'Continue' })
    fireEvent.click(cont)
    await waitFor(() => expect(cont).toHaveAttribute('aria-busy', 'true'))
    expect(cont.querySelector('.spinner')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
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

  it('keeps unsaved folding edits when you leave the page and come back', async () => {
    const first = renderPage()
    drag(await screen.findByRole('button', { name: 't4' }), box('F0'))
    expect(folds()).toEqual(['F0'])
    await waitFor(() => expect(first.pb.data.sessions[0].data.domain_folds_draft).toBeDefined())
    first.unmount()
    renderPage({}, first.pb)
    await screen.findByText('t1')
    expect(folds()).toEqual(['F0'])
    expect(within(box('F0')).getByText('t4')).toBeInTheDocument()
    expect(m.saveDomainFolds).not.toHaveBeenCalled()
  })

  it('moves a table with press-and-hold on a touch screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderPage()
      pointerDrag(await screen.findByRole('button', { name: 't4' }), box('F0'), 'touch')
      expect(folds()).toEqual(['F0'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not drag when a touch moves before the hold (that is scrolling)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderPage()
      touchSwipe(await screen.findByRole('button', { name: 't4' }), box('F0'))
      expect(folds()).toEqual(['F0', 'F1'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not open the preview after a drag', async () => {
    renderPage()
    const chip = await screen.findByRole('button', { name: 't4' })
    drag(chip, box('F1')) // dropped back on its own fold: nothing moves, but the click must not open the popup
    fireEvent.click(chip)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(chip)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('merges a fold into the one it is dropped on', async () => {
    renderPage()
    drag(await screen.findByLabelText('Drag fold F1'), box('F0'))
    expect(folds()).toEqual(['F0'])
    expect(within(box('F0')).getAllByRole('button', { name: /^t\d$/ }).map((b) => b.textContent)).toEqual([
      't1', 't2', 't3', 't4',
    ])
  })

  it('splits a fold at a line between two tables once split mode is on', async () => {
    renderPage()
    await screen.findByText('t1')
    expect(screen.queryByRole('button', { name: 'Split F0 after t2' })).toBeNull()
    const toggle = screen.getByRole('button', { name: /Split folds/ })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const seam = screen.getByRole('button', { name: 'Split F0 after t2' })
    fireEvent.pointerDown(seam)
    fireEvent.click(seam)
    expect(folds()).toEqual(['F0 - Split 1', 'F0 - Split 2', 'F1'])
    expect(screen.queryByRole('button', { name: 'Split F1 after t4' })).toBeNull()
    // still on: another cut can follow
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('leaves split mode on a press anywhere else, or on Escape', async () => {
    renderPage()
    await screen.findByText('t1')
    const toggle = screen.getByRole('button', { name: /Split folds/ })
    fireEvent.click(toggle)
    fireEvent.pointerDown(screen.getByRole('button', { name: 't4' }))
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Split F0 after t2' })).toBeNull()
    fireEvent.click(toggle)
    fireEvent.pointerDown(box('F1'))
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
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
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByRole('heading', { name: 'Quality Folding' })
    expect(m.saveDomainFolds).toHaveBeenCalledWith('p1', { F0: ['t1', 't2', 't3', 't4'] })
  })

  it('stays on the page when saving fails', async () => {
    m.saveDomainFolds.mockRejectedValue(new Error('Table t1 is in more than one fold'))
    renderPage()
    await screen.findByText('t1')
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByText(/more than one fold/)).toBeInTheDocument()
    expect(within(document.body).queryByRole('heading', { name: 'Quality Folding' })).toBeNull()
  })
})

describe('DomainFolding (German)', () => {
  beforeEach(() => act(() => setLang('de')))
  afterEach(() => act(() => setLang('en')))

  it('shows the German lead, run button and navigation', async () => {
    renderPage()
    expect(await screen.findByText(de.domainFolding.lead)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Domain Folding' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: de.domainFolding.run })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: de.domainFolding.continue })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: de.domainFolding.back })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(de.shell.splitFolds) }))
    expect(screen.getByText(de.domainFolding.cutHint)).toBeInTheDocument()
  })

  it('keeps fold and table names from the data unchanged', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 3, name: 'F0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 't1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 't1' }))
    expect(await screen.findByRole('dialog', { name: de.domainFolding.previewLabel('t1') })).toBeInTheDocument()
  })

  it('explains the missing pipeline in German', async () => {
    renderPage({})
    expect(await screen.findByText(de.domainFolding.prereqText)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: de.domainFolding.backToConfig })).toBeInTheDocument()
  })
})
