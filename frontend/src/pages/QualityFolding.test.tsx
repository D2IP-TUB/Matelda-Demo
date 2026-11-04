import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setLang } from '../i18n'
import { de } from '../i18n/de'
import * as api from '../lib/api'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { pointerDrag, seedSession } from '../test/helpers'
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
  moveFoldToDomain: vi.fn(),
  splitDomain: vi.fn(),
  mergeDomains: vi.fn(),
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
  for (const fn of [m.moveFoldToDomain, m.splitDomain, m.mergeDomains, m.moveCell, m.mergeCellFolds, m.splitCellFold, m.setFoldLabel]) {
    fn.mockReset().mockResolvedValue(SUMMARY)
  }
})

const short = (f: string) => f.split(' / ')[1]
const ready = (f: string) => waitFor(() => expect(box(f)).not.toBeNull())
const nameOf = async (f: string) => {
  await ready(f)
  return within(box(f)).getByText(short(f))
}
const box = (fold: string) => document.querySelector(`[data-fold="${fold}"]`) as HTMLElement
const drag = pointerDrag
const domainBox = (name: string) => screen.getByRole('region', { name: `Domain ${name}` })
const cellsOf = async (fold: string) => {
  await ready(fold)
  return within(box(fold)).findAllByTestId('cell')
}

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
    // the page is still shown, but its controls are greyed out
    expect(screen.getByRole('heading', { name: 'Quality Folding' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run quality based folding' })).toBeDisabled()
    expect(screen.getByText('Continue')).toHaveAttribute('aria-disabled', 'true')
  })

  it('lists cell folds per domain with counts and label colours', async () => {
    renderPage()
    expect(await nameOf(F0)).toHaveClass('label-correct')
    expect(await nameOf(F2)).toHaveClass('label-false')
    expect(await nameOf(F1)).toHaveClass('label-neutral')
    expect(screen.getByText('25 cells')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'D1' })).toBeInTheDocument()
  })

  it('draws one rectangle per domain holding its cell folds, with the domain name only once', async () => {
    renderPage()
    await ready(F0)
    const d0 = screen.getByRole('region', { name: 'Domain D0' })
    expect(within(d0).getAllByText(/^Cell Fold \d$/)).toHaveLength(2)
    expect(within(d0).queryByText(/D0 \//)).toBeNull()
    expect(box(F0).parentElement).toHaveClass('fold-grid')
    expect(within(d0).getByLabelText(`Drag fold ${F1}`)).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'D0' })).toHaveLength(1)
  })

  it('runs with the edited budget and strategies and refreshes the folds', async () => {
    renderPage()
    await ready(F0)
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

  it('shows the spinner inside the Run button while the job runs, and nowhere else', async () => {
    m.fetchJob.mockResolvedValue({ id: 'job1', state: 'running' })
    renderPage()
    await ready(F0)
    const run = screen.getByRole('button', { name: 'Run quality based folding' })
    fireEvent.click(run)
    await waitFor(() => expect(run).toHaveAttribute('aria-busy', 'true'))
    expect(run.querySelector('.spinner')).not.toBeNull()
    expect(screen.queryByText('Running…')).toBeNull()
  })

  it('shows the error of a failed job', async () => {
    m.fetchJob.mockResolvedValue({ id: 'job1', state: 'failed', error: 'raha exploded' })
    renderPage()
    await ready(F0)
    fireEvent.click(screen.getByRole('button', { name: 'Run quality based folding' }))
    expect(await screen.findByText(/raha exploded/)).toBeInTheDocument()
  })

  it('shows 10 cells per fold and loads the next ten only when the list is scrolled near its end', async () => {
    renderPage()
    const chips = await cellsOf(F0)
    expect(chips).toHaveLength(10)
    expect(m.fetchFoldCells).toHaveBeenCalledWith('p1', F0, 0, 10)
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull()
    expect(within(box(F0)).getByText('scroll for 15 more')).toBeInTheDocument()
    const list = chips[0].closest('ul') as HTMLElement
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 150 })
    await new Promise((r) => setTimeout(r, 50)) // nothing loads by itself, however long we wait
    expect(m.fetchFoldCells).not.toHaveBeenCalledWith('p1', F0, 10, 10)
    list.scrollTop = 100 // far from the end
    fireEvent.scroll(list)
    expect(m.fetchFoldCells).not.toHaveBeenCalledWith('p1', F0, 10, 10)
    list.scrollTop = 850 // near the end
    fireEvent.scroll(list)
    await waitFor(() => expect(within(box(F0)).getAllByTestId('cell')).toHaveLength(20))
    expect(m.fetchFoldCells).toHaveBeenCalledWith('p1', F0, 10, 10)
    expect(within(box(F0)).getByText('scroll for 5 more')).toBeInTheDocument()
  })

  it('greys out the bottom of a cell list until its very end is reached', async () => {
    renderPage()
    const chips = await cellsOf(F0)
    const list = chips[0].closest('ul') as HTMLElement
    const fade = list.parentElement as HTMLElement
    expect(fade).toHaveClass('has-more') // 15 cells are not loaded yet
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 150 })
    for (const n of [20, 25]) {
      list.scrollTop = 850
      fireEvent.scroll(list)
      await waitFor(() => expect(within(box(F0)).getAllByTestId('cell')).toHaveLength(n))
    }
    list.scrollTop = 500 // everything is loaded, but the end is still below
    fireEvent.scroll(list)
    expect(fade).toHaveClass('has-more')
    list.scrollTop = 850 // the very end
    fireEvent.scroll(list)
    expect(fade).not.toHaveClass('has-more')
  })

  it('puts the domain rectangles side by side in one grid', async () => {
    renderPage()
    await ready(F0)
    const grid = screen.getByRole('region', { name: 'Domain D0' }).parentElement as HTMLElement
    expect(grid).toHaveClass('domain-grid')
    expect(within(grid).getByRole('region', { name: 'Domain D1' })).toBeInTheDocument()
  })

  it('shows only the cell value on a chip and leaves the origin to the popup', async () => {
    renderPage()
    const [first, second] = await cellsOf(F0)
    expect(first).toHaveTextContent(/^v0$/)
    expect(second).toHaveTextContent(/^v1$/)
    fireEvent.click(second)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Table').nextElementSibling).toHaveTextContent('t1')
    expect(within(dialog).getByText('Column').nextElementSibling).toHaveTextContent('a')
    expect(within(dialog).getByText('Row').nextElementSibling).toHaveTextContent('1')
  })

  it('opens a dialog with the detection results and a table excerpt', async () => {
    renderPage()
    fireEvent.click((await cellsOf(F0))[7])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Typo Detector')).toBeInTheDocument()
    await waitFor(() => expect(m.fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 2, 11))
    expect(await within(dialog).findByText('r7')).toHaveClass('diff-dirty')
  })

  it('says so when a cell passed all checks, and the excerpt starts at row 0 near the top', async () => {
    renderPage()
    fireEvent.click((await cellsOf(F0))[0])
    expect(await screen.findByText(/passed all error detection checks/)).toBeInTheDocument()
    await waitFor(() => expect(m.fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 0, 11))
  })

  it('moves a cell by dragging it onto another fold', async () => {
    renderPage()
    const [cell] = await cellsOf(F0)
    drag(cell, box(F1))
    await waitFor(() =>
      expect(m.moveCell).toHaveBeenCalledWith('p1', { table: 't1', row: 0, col: 'a' }, F1),
    )
  })

  it('does nothing when a cell is dropped on its own fold', async () => {
    renderPage()
    const [cell] = await cellsOf(F0)
    drag(cell, box(F0))
    expect(m.moveCell).not.toHaveBeenCalled()
  })

  it('merges a fold into the one it is dropped on', async () => {
    renderPage()
    await ready(F0)
    drag(screen.getByLabelText(`Drag fold ${F1}`), box(F0))
    await waitFor(() => expect(m.mergeCellFolds).toHaveBeenCalledWith('p1', [F0, F1]))
  })

  it('shows the merged folds from the server answer without waiting for a refetch', async () => {
    const merged = [{ ...SUMMARY[0], cell_count: 27 }, SUMMARY[2]]
    m.mergeCellFolds.mockResolvedValue(merged)
    m.fetchCellFolds.mockReset().mockResolvedValueOnce(SUMMARY).mockReturnValue(new Promise(() => {}))
    renderPage()
    await ready(F0)
    drag(screen.getByLabelText(`Drag fold ${F1}`), box(F0))
    await waitFor(() => expect(box(F1)).toBeNull())
    expect(screen.getByText('27 cells')).toBeInTheDocument()
  })

  it('queues a second drop while the first change is still being saved, instead of ignoring it', async () => {
    let finish: (v: typeof SUMMARY) => void = () => {}
    m.mergeCellFolds.mockReturnValue(new Promise((r) => (finish = r)))
    renderPage()
    await ready(F0)
    const [cell] = await cellsOf(F2)
    drag(screen.getByLabelText(`Drag fold ${F1}`), box(F0))
    drag(cell, box(F0))
    await waitFor(() => expect(m.mergeCellFolds).toHaveBeenCalledTimes(1))
    expect(m.moveCell).not.toHaveBeenCalled() // changes reach the server one after the other
    finish([{ ...SUMMARY[0], cell_count: 27 }, SUMMARY[2]])
    await waitFor(() => expect(m.moveCell).toHaveBeenCalledWith('p1', { table: 't1', row: 0, col: 'a' }, F0))
  })

  it('moves the chip and the counts at once, before the server answers', async () => {
    m.moveCell.mockReturnValue(new Promise(() => {}))
    renderPage()
    await cellsOf(F1)
    const chip = within(box(F0)).getByText('v5')
    drag(chip, box(F1))
    expect(within(box(F1)).getByText('v5')).toBeInTheDocument()
    expect(within(box(F0)).queryByText('v5')).toBeNull()
    expect(within(box(F0)).getByText('24 cells')).toBeInTheDocument()
    expect(within(box(F1)).getByText('3 cells')).toBeInTheDocument()
  })

  it('puts the chip back when the server rejects the move', async () => {
    m.moveCell.mockRejectedValue(new Error('Unknown cell'))
    renderPage()
    await cellsOf(F1)
    drag(within(box(F0)).getByText('v5'), box(F1))
    expect(await screen.findByText(/Unknown cell/)).toBeInTheDocument()
    await waitFor(() => expect(within(box(F0)).getByText('v5')).toBeInTheDocument())
    expect(within(box(F1)).queryByText('v5')).toBeNull()
  })

  it('merges on screen at once, before the server answers', async () => {
    m.mergeCellFolds.mockReturnValue(new Promise(() => {}))
    renderPage()
    await ready(F0)
    drag(screen.getByLabelText(`Drag fold ${F1}`), box(F0))
    expect(box(F1)).toBeNull()
    expect(within(box(F0)).getByText('27 cells')).toBeInTheDocument()
  })

  it('reloads the folds when a change is rejected because they changed meanwhile', async () => {
    m.mergeCellFolds.mockRejectedValue(new Error(`Unknown fold '${F1}'`))
    renderPage()
    await ready(F0)
    const calls = m.fetchCellFolds.mock.calls.length
    drag(screen.getByLabelText(`Drag fold ${F1}`), box(F0))
    expect(await screen.findByText(/Unknown fold/)).toBeInTheDocument()
    await waitFor(() => expect(m.fetchCellFolds.mock.calls.length).toBeGreaterThan(calls))
  })

  it('after a move only reloads the two folds involved and keeps the cells on screen meanwhile', async () => {
    const after = [
      { ...SUMMARY[0], cell_count: 24 },
      { ...SUMMARY[1], cell_count: 3 },
      SUMMARY[2],
    ]
    renderPage()
    const [cell] = await cellsOf(F0)
    await cellsOf(F1)
    await cellsOf(F2)
    // hold the reload of F0 back so we can look at the screen while it is in flight
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const original = m.fetchFoldCells.getMockImplementation()!
    m.fetchFoldCells.mockImplementation(async (...a) => {
      if (a[1] === F0) await gate
      return original(...a)
    })
    m.moveCell.mockResolvedValue(after)
    m.fetchFoldCells.mockClear()
    drag(cell, box(F1))
    await waitFor(() => expect(m.fetchFoldCells).toHaveBeenCalledWith('p1', F0, 0, 10))
    // F0 still shows its cells while the reload is pending; nothing flashed empty
    expect(within(box(F0)).getAllByTestId('cell').length).toBeGreaterThan(0)
    release()
    await waitFor(() => expect(m.fetchFoldCells).toHaveBeenCalledWith('p1', F1, 0, 10))
    const reloaded = m.fetchFoldCells.mock.calls.map((c) => c[1])
    expect(reloaded).not.toContain(F2) // the untouched fold is not reloaded
  })

  it('moves a whole fold into another domain when it is dropped on that domain, not on one of its folds', async () => {
    renderPage()
    await ready(F0)
    drag(screen.getByLabelText(`Drag fold ${F1}`), domainBox('D1').querySelector('h2')!)
    await waitFor(() => expect(m.moveFoldToDomain).toHaveBeenCalledWith('p1', F1, 'D1'))
    expect(m.mergeCellFolds).not.toHaveBeenCalled()
  })

  it('merges instead when the fold is dropped on a fold of another domain', async () => {
    renderPage()
    await ready(F0)
    drag(screen.getByLabelText(`Drag fold ${F2}`), box(F0))
    await waitFor(() => expect(m.mergeCellFolds).toHaveBeenCalledWith('p1', [F0, F2]))
    expect(m.moveFoldToDomain).not.toHaveBeenCalled()
  })

  it('merges a whole domain into another when its handle is dropped on that domain, even on one of its folds', async () => {
    renderPage()
    await ready(F0)
    drag(screen.getByLabelText('Drag domain D1'), domainBox('D0').querySelector('h2')!)
    await waitFor(() => expect(m.mergeDomains).toHaveBeenCalledWith('p1', 'D1', 'D0'))
    drag(screen.getByLabelText('Drag domain D0'), box(F2))
    await waitFor(() => expect(m.mergeDomains).toHaveBeenCalledWith('p1', 'D0', 'D1'))
    expect(m.mergeCellFolds).not.toHaveBeenCalled()
    expect(m.moveFoldToDomain).not.toHaveBeenCalled()
  })

  it('shows the merged domain at once, before the server answers', async () => {
    let answer: (v: any) => void = () => {}
    m.mergeDomains.mockImplementation(() => new Promise((r) => (answer = r)))
    renderPage()
    await ready(F0)
    drag(screen.getByLabelText('Drag domain D1'), domainBox('D0').querySelector('h2')!)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Domain D1' })).toBeNull())
    expect(domainBox('D0').querySelector(`[data-fold="${F2}"]`)).not.toBeNull()
    answer(SUMMARY.map((f) => ({ ...f, domain: 'D0' })))
  })

  it('ignores a domain dropped on itself', async () => {
    renderPage()
    await ready(F0)
    drag(screen.getByLabelText('Drag domain D0'), box(F0))
    expect(m.mergeDomains).not.toHaveBeenCalled()
    expect(m.mergeCellFolds).not.toHaveBeenCalled()
  })

  it('ignores a fold dropped on its own domain, and a cell dropped on a domain', async () => {
    renderPage()
    await ready(F0)
    drag(screen.getByLabelText(`Drag fold ${F1}`), domainBox('D0').querySelector('h2')!)
    const [cell] = await cellsOf(F0)
    drag(cell, domainBox('D1').querySelector('h2')!)
    expect(m.moveFoldToDomain).not.toHaveBeenCalled()
    expect(m.moveCell).not.toHaveBeenCalled()
  })

  it('splits a domain at the line after a cell fold, in split mode; no line after the last fold of a domain', async () => {
    renderPage()
    await ready(F0)
    expect(screen.queryByRole('button', { name: `Split domain D0 after ${F0}` })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Split folds/ }))
    expect(screen.queryByRole('button', { name: `Split domain D0 after ${F1}` })).toBeNull()
    expect(screen.queryByRole('button', { name: `Split domain D1 after ${F2}` })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `Split domain D0 after ${F0}` }))
    await waitFor(() => expect(m.splitDomain).toHaveBeenCalledWith('p1', 'D0', F0))
  })

  it('keeps the full names of folds whose short names would clash after a move between domains', async () => {
    m.fetchCellFolds.mockResolvedValue([
      { ...SUMMARY[0] },
      { ...SUMMARY[2], domain: 'D0' }, // "D1 / Cell Fold 0" now lives in D0 next to "D0 / Cell Fold 0"
    ])
    renderPage()
    await ready(F0)
    const d0 = domainBox('D0')
    expect(within(d0).getByText(F2)).toBeInTheDocument()
    expect(within(d0).getByText(F0)).toBeInTheDocument() // both clash, so both keep the full name
  })

  it('splits a fold at the line after a cell, in split mode', async () => {
    renderPage()
    await cellsOf(F0)
    expect(screen.queryByRole('button', { name: `Split ${F0} after t1 1 a` })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Split folds/ }))
    fireEvent.click(screen.getByRole('button', { name: `Split ${F0} after t1 1 a` }))
    await waitFor(() =>
      expect(m.splitCellFold).toHaveBeenCalledWith('p1', F0, [{ table: 't1', row: 1, col: 'a' }]),
    )
  })

  it('leaves split mode on a press on a cell or a fold, or on Escape', async () => {
    renderPage()
    const [cell] = await cellsOf(F0)
    const toggle = screen.getByRole('button', { name: /Split folds/ })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerDown(cell)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: `Split domain D0 after ${F0}` })).toBeNull()
    fireEvent.click(toggle)
    fireEvent.pointerDown(box(F1))
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    fireEvent.pointerDown(screen.getByRole('button', { name: `Split domain D0 after ${F0}` }))
    expect(toggle).toHaveAttribute('aria-pressed', 'true') // a cut line keeps it on
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks folds as correct, false or takes the mark back', async () => {
    renderPage()
    const [cell] = await cellsOf(F0)
    expect(screen.queryByRole('button', { name: `Mark ${F1} correct` })).toBeNull()
    const toggle = screen.getByRole('button', { name: /Bulk annotate/ })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerDown(cell) // unlike split mode, a press elsewhere keeps it on
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: `Mark ${F1} correct` }))
    await waitFor(() => expect(m.setFoldLabel).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: `Mark ${F1} false` }))
    await waitFor(() => expect(m.setFoldLabel).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: `Clear label of ${F2}` }))
    await waitFor(() => expect(m.setFoldLabel).toHaveBeenCalledTimes(3))
    expect(m.setFoldLabel).toHaveBeenCalledWith('p1', F1, 'correct')
    expect(m.setFoldLabel).toHaveBeenCalledWith('p1', F1, 'false')
    expect(m.setFoldLabel).toHaveBeenCalledWith('p1', F2, null)
  })

  it('shows the message of a rejected operation', async () => {
    m.mergeCellFolds.mockRejectedValue(new Error('Select at least two different folds to merge'))
    renderPage()
    await ready(F0)
    drag(screen.getByLabelText(`Drag fold ${F1}`), box(F0))
    expect(await screen.findByText(/at least two different folds/)).toBeInTheDocument()
  })

  it('continues to labeling', async () => {
    renderPage()
    await ready(F0)
    fireEvent.click(screen.getByRole('link', { name: /Continue/ }))
    expect(await screen.findByRole('heading', { name: 'Labeling' })).toBeInTheDocument()
  })
})

describe('QualityFolding (German)', () => {
  beforeEach(() => act(() => setLang('de')))
  afterEach(() => act(() => setLang('en')))

  it('shows the German lead, settings and run button', async () => {
    renderPage()
    expect(await screen.findByText(de.qualityFolding.lead)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Quality Folding' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: de.qualityFolding.run })).toBeInTheDocument()
    expect(screen.getByText(de.qualityFolding.settings)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(de.shell.splitFolds) }))
    expect(screen.getByText(de.qualityFolding.cutHint)).toBeInTheDocument()
  })

  it('keeps fold, domain and cell values from the data unchanged', async () => {
    renderPage()
    expect(await screen.findByText('Cell Fold 1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'D0' })).toBeInTheDocument()
    expect(screen.getByText(de.qualityFolding.cellsCount(25))).toBeInTheDocument()
    expect((await screen.findAllByTestId('cell'))[0]).toHaveTextContent('v0')
  })

  it('opens the cell details in German', async () => {
    renderPage()
    fireEvent.click((await screen.findAllByTestId('cell'))[0])
    expect(await screen.findByText(de.qualityFolding.detailsFor('v0'))).toBeInTheDocument()
    expect(screen.getByText(de.qualityFolding.passedAll)).toBeInTheDocument()
  })

  it('explains the missing pipeline in German', async () => {
    renderPage({})
    expect(await screen.findByText(de.qualityFolding.prereqText)).toBeInTheDocument()
  })
})
