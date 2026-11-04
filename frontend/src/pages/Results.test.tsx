import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setLang } from '../i18n'
import { de } from '../i18n/de'
import * as api from '../lib/api'
import { RoomService } from '../rooms/roomService'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { Results } from './Results'

vi.mock('../lib/api', () => ({
  fetchResults: vi.fn(),
}))
const m = vi.mocked(api)

const TIME = '2025-03-01 10:00:00'
const RESULTS = {
  dataset: 'demo', pipeline: 'p1', labeling_budget: 12,
  metrics: { precision: 0.9, recall: 0.8, f1: 0.85, time: TIME },
  comparison: [
    { time: TIME, pipeline: 'p1', labeling_budget: 12, precision: 0.9, recall: 0.8, f1: 0.85 },
    { time: '2025-01-01 10:00:00', pipeline: 'p0', labeling_budget: 5, precision: 0.5, recall: 0.4, f1: 0.44 },
  ],
  raha: { labeling_budget: 12, precision: 0.33, recall: 0.07, f1: 0.11 },
}

function renderPage(
  session: Record<string, unknown> = { pipeline_path: 'p1' },
  pb = new FakePocketBase(),
  keepSession = false, // true: reuse the session record that is already in pb (a reload)
) {
  const storage = keepSession ? { getItem: () => pb.data.sessions[0].sid, setItem: () => {} } : seedSession(pb, session)
  const sessions = new SessionService(pb as any, storage)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter>
          <Results roomService={new RoomService(pb as any)} />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { pb, ...view }
}

function seedRoom() {
  const pb = new FakePocketBase()
  pb.data.rooms = [{ id: 'rm1', name: 'r1', phase: 'labeling', dataset: 'demo' }]
  pb.data.players = [
    { id: 'pl1', room: 'r1', token: 'tok', name: 'Blue Otter', budget: 10, vote: 'demo', created: '1' },
    { id: 'pl2', room: 'r1', token: 'tok2', name: 'Red Yeti', budget: 10, vote: 'demo', created: '2' },
  ]
  const label = (player: string, i: number, value: boolean, ok: boolean, ms: number) => ({
    id: `l-${player}-${i}`, room: 'r1', player, cell_id: `t|${i}|a`, value, is_correct: ok, latency_ms: ms,
  })
  pb.data.labels = [
    ...[0, 1, 2, 3, 4, 5].map((i) => label('pl1', i, true, true, 500)),
    label('pl2', 10, true, true, 3000),
    label('pl2', 11, false, false, 4000),
  ]
  return pb
}
const ROOM_SESSION = { pipeline_path: 'p1', room_name: 'r1', player_token: 'tok' }

beforeEach(() => {
  m.fetchResults.mockReset().mockResolvedValue(RESULTS as any)
})

describe('Results', () => {
  it('asks to configure a pipeline first', async () => {
    renderPage({})
    expect(await screen.findByRole('alert')).toHaveTextContent('Pipeline not configured')
    expect(m.fetchResults).not.toHaveBeenCalled()
  })

  it('shows precision, recall, F1 and the budget', async () => {
    renderPage()
    const stat = async (label: string) =>
      (await screen.findByText(label, { selector: '.stat span' })).nextSibling
    expect(await stat('Precision')).toHaveTextContent('0.90')
    expect(await stat('Recall')).toHaveTextContent('0.80')
    expect(await stat('F1 Score')).toHaveTextContent('0.85')
    expect(await stat('Labeling Budget')).toHaveTextContent('12')
  })

  it('shows an empty state leading back to error detection, and a greyed-out "Start a new round", when there are no metrics yet', async () => {
    m.fetchResults.mockResolvedValue({ ...RESULTS, metrics: null, comparison: [], raha: null } as any)
    renderPage()
    await waitFor(() => expect(m.fetchResults).toHaveBeenCalled())
    expect(await screen.findByRole('heading', { name: 'No results yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Error Detection' })).toHaveAttribute('href', '/error-detection')
    expect(screen.queryByRole('heading', { name: 'Model Performance Metrics' })).toBeNull()
    expect(screen.getByText('Start a new round')).toHaveAttribute('aria-disabled', 'true')
  })

  it('lists the comparison newest first, highlights the current run and sorts by clicking', async () => {
    renderPage()
    const table = (await screen.findByText(/Result Comparison \(Dataset: demo\)/)).closest('section')!
    const firstColumn = () => within(table).getAllByRole('row').slice(1).map((r) => r.children[1].textContent)
    expect(firstColumn()).toEqual(['p1', 'p0'])
    expect(table.querySelectorAll('tr.current')).toHaveLength(1)
    expect(table.querySelector('tr.current')!.textContent).toContain('p1')
    fireEvent.click(within(table).getByRole('columnheader', { name: /F1/ }))
    expect(firstColumn()).toEqual(['p0', 'p1'])
    fireEvent.click(within(table).getByRole('columnheader', { name: /F1/ }))
    expect(firstColumn()).toEqual(['p1', 'p0'])
  })

  it('compares with the Raha baseline', async () => {
    m.fetchResults.mockResolvedValue({
      ...RESULTS, metrics: { ...RESULTS.metrics, f1: 0.45 }, raha: { labeling_budget: 12, precision: 0.3, recall: 0.2, f1: 0.4 },
    } as any)
    renderPage()
    expect(await screen.findByText('+12.5%')).toBeInTheDocument()
    expect(screen.getByText('0.400')).toBeInTheDocument()
  })

  it('shows n/a for the change when the baseline F1 is zero', async () => {
    m.fetchResults.mockResolvedValue({ ...RESULTS, raha: { labeling_budget: 12, precision: 0, recall: 0, f1: 0 } } as any)
    renderPage()
    expect(await screen.findByText('n/a')).toBeInTheDocument()
  })

  it('shows a helper the host\'s run read-only: the room pipeline, no sharing, no buttons', async () => {
    const pb = seedRoom()
    Object.assign(pb.data.rooms[0], { host: 'pl1', pipeline: 'p-room' })
    renderPage({ room_name: 'r1', player_token: 'tok2' }, pb)
    expect(await screen.findByText('Result Comparison (Dataset: demo)')).toBeInTheDocument()
    expect(m.fetchResults).toHaveBeenCalledWith('p-room')
    expect(screen.queryByText('Start a new round')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull() // their screen follows the host
    await new Promise((r) => setTimeout(r, 50))
    expect(pb.data.runs ?? []).toHaveLength(0)
  })

  it('tells a helper to wait for the host when there are no results yet', async () => {
    m.fetchResults.mockResolvedValue({ ...RESULTS, metrics: null, comparison: [], raha: null } as any)
    const pb = seedRoom()
    Object.assign(pb.data.rooms[0], { host: 'pl1', pipeline: 'p-room' })
    renderPage({ room_name: 'r1', player_token: 'tok2' }, pb)
    expect(await screen.findByText(/The host hasn't run error detection yet/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/Pipeline not configured/)).toBeNull()
  })

  it('shares the run with the room once per result', async () => {
    const pb = seedRoom()
    const first = renderPage(ROOM_SESSION, pb)
    await waitFor(() => expect(pb.data.runs).toHaveLength(1))
    expect(pb.data.runs[0]).toMatchObject({
      room: 'r1', player: 'pl1', dataset: 'demo', budget: 12, precision: 0.9, recall: 0.8, f1: 0.85,
    })
    first.unmount()
    const second = renderPage(ROOM_SESSION, pb, true)
    await screen.findByText('Result Comparison (Dataset: demo)')
    expect(pb.data.runs).toHaveLength(1)
    second.unmount()
    m.fetchResults.mockResolvedValue({ ...RESULTS, metrics: { ...RESULTS.metrics, time: '2025-04-01 09:00:00' } } as any)
    renderPage(ROOM_SESSION, pb, true)
    await waitFor(() => expect(pb.data.runs).toHaveLength(2))
  })

  it('has no share-your-results card', async () => {
    renderPage()
    await screen.findByText('Result Comparison (Dataset: demo)')
    expect(screen.queryByText('Share your results')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
  })
})

describe('Results (German)', () => {
  beforeEach(() => act(() => setLang('de')))
  afterEach(() => act(() => setLang('en')))
  const r = de.results

  it('translates the words but keeps metric names and 0.87-style numbers', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 2, name: r.performance })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Results' })).toBeInTheDocument()
    const stat = (label: string) => screen.getByText(label, { selector: '.stat span' }).nextSibling
    expect(stat('Precision')).toHaveTextContent('0.90')
    expect(stat('Recall')).toHaveTextContent('0.80')
    expect(stat('F1 Score')).toHaveTextContent('0.85')
    expect(stat('Labeling Budget')).toHaveTextContent('12')
    expect(screen.getByText(r.comparisonTitle('demo'))).toBeInTheDocument()
    expect(screen.getByText(r.sortHint)).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: r.colTime })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Precision' })).toBeInTheDocument()
    expect(screen.getByText(r.baselineTitle)).toBeInTheDocument()
    expect(screen.getByText(r.baselineText(12))).toBeInTheDocument()
    expect(screen.getByText(r.newRound)).toBeInTheDocument()
  })

  it('shows the German empty state', async () => {
    m.fetchResults.mockResolvedValue({ ...RESULTS, metrics: null, comparison: [], raha: null } as any)
    renderPage()
    expect(await screen.findByRole('heading', { name: r.emptyTitle })).toBeInTheDocument()
    expect(screen.getByText(r.emptyText)).toBeInTheDocument()
    expect(screen.getByText(r.newRound)).toHaveAttribute('aria-disabled', 'true')
  })

  it('explains the missing pipeline in German', async () => {
    renderPage({})
    expect(await screen.findByText(r.prereqText)).toBeInTheDocument()
  })
})
