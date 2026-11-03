import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as api from '../lib/api'
import { RoomService } from '../rooms/roomService'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { Results } from './Results'

vi.mock('../lib/api', () => ({
  fetchResults: vi.fn(),
  fetchLabelAccuracy: vi.fn(),
  labelAccuracyCsvUrl: (name: string) => `/api/pipelines/${name}/label-accuracy.csv`,
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
  m.fetchLabelAccuracy.mockReset().mockResolvedValue({
    total: 4, correct: 3, accuracy: 0.75,
    rows: [{ table: 't1', row: 0, col: 'a', val: 'x', user_said_error: false, truth_is_error: false, clean_value: 'x', correct: true }],
  } as any)
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

  it('points to Error Detection when there are no metrics yet', async () => {
    m.fetchResults.mockResolvedValue({ ...RESULTS, metrics: null, comparison: [], raha: null } as any)
    renderPage()
    expect(await screen.findByText(/No results yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Error Detection/ })).toHaveAttribute('href', '/error-detection')
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

  it('checks the labeling accuracy on request and offers the CSV', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Check my labeling accuracy' }))
    expect(await screen.findByText('75.0%')).toBeInTheDocument()
    expect(m.fetchLabelAccuracy).toHaveBeenCalledWith('p1', 0, 100)
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href', '/api/pipelines/p1/label-accuracy.csv',
    )
  })

  it('shows the API message when there are no saved labels', async () => {
    m.fetchLabelAccuracy.mockRejectedValue(new Error('No saved user labels yet; finish the labeling step first'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Check my labeling accuracy' }))
    expect(await screen.findByText(/No saved user labels yet/)).toBeInTheDocument()
  })

  it('has no room section outside a room', async () => {
    renderPage()
    await screen.findByText('Labeling Budget', { selector: '.stat span' })
    expect(screen.queryByText('Room labeling')).toBeNull()
  })

  it('summarises the room with per-player flags', async () => {
    renderPage({ ...ROOM_SESSION, room_disputed_cells: ['a', 'b'] }, seedRoom())
    expect(await screen.findByText('Room labeling')).toBeInTheDocument()
    expect(await screen.findByText('Blue Otter (you)')).toBeInTheDocument()
    expect(screen.getByText('Labels in the room', { selector: '.stat span' }).nextSibling).toHaveTextContent('8')
    expect(screen.getByText('Labelers', { selector: '.stat span' }).nextSibling).toHaveTextContent('2')
    expect(screen.getByText('Room accuracy', { selector: '.stat span' }).nextSibling).toHaveTextContent('88%')
    const you = screen.getByText('Blue Otter (you)').closest('tr')!
    expect(you.textContent).toContain('very fast')
    expect(you.textContent).toContain('same answer')
    expect(screen.getByText(/2 disputed cell\(s\)/)).toBeInTheDocument()
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
    await screen.findByText('Room labeling')
    expect(pb.data.runs).toHaveLength(1)
    second.unmount()
    m.fetchResults.mockResolvedValue({ ...RESULTS, metrics: { ...RESULTS.metrics, time: '2025-04-01 09:00:00' } } as any)
    renderPage(ROOM_SESSION, pb, true)
    await waitFor(() => expect(pb.data.runs).toHaveLength(2))
  })

  it('offers the share text with the metrics and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    const text = await screen.findByTestId('share-text')
    expect(text.textContent).toContain('Precision: 0.90')
    expect(text.textContent).toContain('Dataset: demo')
    expect(text.textContent).toContain('Pipeline: p1')
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(text.textContent)
  })
})
