import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as api from '../lib/api'
import { RoomService } from '../rooms/roomService'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { Labeling } from './Labeling'

vi.mock('../lib/api', () => ({
  fetchPipeline: vi.fn(),
  fetchLabelingSample: vi.fn(),
  fetchCandidates: vi.fn(),
  fetchCards: vi.fn(),
  judgeVerdicts: vi.fn(),
  startPropagation: vi.fn(),
  fetchJob: vi.fn(),
  fetchDirtyPage: vi.fn(),
}))

const m = vi.mocked(api)
const card = (i: number) => ({
  key: `t1|${i}|a`, table: 't1', row: i, col: 'a', val: `v${i}`,
  domain_fold: 'D0', cell_fold: 'F0', strategies: ['Typo Detector'],
})
const CARDS = [card(0), card(1), card(2)]
const config = (over = {}) => ({
  selected_dataset: 'demo', labeling_budget: 3, selected_strategies: [],
  domain_folds: { D0: ['t1'] }, has_cell_folds: true, ...over,
})

function renderPage(session: Record<string, unknown> = { pipeline_path: 'p1' }, pb = new FakePocketBase()) {
  const sessions = new SessionService(pb as any, seedSession(pb, session))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter initialEntries={['/labeling']}>
          <Routes>
            <Route
              path="/labeling"
              element={<Labeling roomService={new RoomService(pb as any)} pollMs={5} />}
            />
            <Route path="/propagated-errors" element={<h1>Propagated Errors</h1>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { pb, ...view }
}

const sessionData = (pb: FakePocketBase) => pb.data.sessions[0].data
const answer = async (name: 'Correct' | 'Error') =>
  fireEvent.click(await screen.findByRole('button', { name }))

function seedRoom(phase = 'labeling', budget = 2) {
  const pb = new FakePocketBase()
  pb.data.rooms = [{ id: 'rm1', name: 'r1', phase, dataset: 'demo' }]
  pb.data.players = [
    { id: 'pl1', room: 'r1', token: 'tok', name: 'Blue Otter', budget, vote: 'demo', created: '1' },
    { id: 'pl2', room: 'r1', token: 'tok2', name: 'Red Yeti', budget, vote: 'demo', created: '2' },
  ]
  return pb
}
const ROOM_SESSION = { pipeline_path: 'p1', room_name: 'r1', player_token: 'tok' }

beforeEach(() => {
  m.fetchPipeline.mockReset().mockResolvedValue(config() as any)
  m.fetchLabelingSample.mockReset().mockResolvedValue({ cards: CARDS, bulk_annotated_folds: 0 } as any)
  m.fetchCandidates.mockReset().mockResolvedValue({ keys: [0, 1, 2, 3, 4].map((i) => `t1|${i}|a`), sample_size: 3 })
  m.fetchCards.mockReset().mockImplementation(async (_n, keys) => keys.map((k) => card(Number(k.split('|')[1]))) as any)
  m.judgeVerdicts.mockReset().mockResolvedValue([true])
  m.startPropagation.mockReset().mockResolvedValue('job1')
  m.fetchJob.mockReset().mockResolvedValue({ id: 'job1', state: 'done', result: { disputed: ['t1|0|a'] } })
  m.fetchDirtyPage.mockReset().mockResolvedValue({ columns: ['a'], rows: [['x']], total_rows: 3, offset: 0 })
})

describe('Labeling', () => {
  it('asks to configure a pipeline first', async () => {
    renderPage({})
    expect(await screen.findByRole('alert')).toHaveTextContent('Pipeline not configured')
    expect(screen.getByRole('link', { name: /Configurations/ })).toHaveAttribute('href', '/configuration')
  })

  it('asks for quality folding when there are no cell folds', async () => {
    m.fetchPipeline.mockResolvedValue(config({ has_cell_folds: false }) as any)
    renderPage()
    expect(await screen.findByText(/Run quality folding first/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Quality Folding/ })).toHaveAttribute('href', '/quality-folding')
  })

  it('shows the first card with its strategies and stores verdicts in the session', async () => {
    const { pb } = renderPage()
    expect(await screen.findByText('v0')).toBeInTheDocument()
    expect(screen.getByText('Typo Detector')).toBeInTheDocument()
    expect(screen.getByText('Card 1 of 3')).toBeInTheDocument()
    await answer('Correct')
    expect(await screen.findByText('v1')).toBeInTheDocument()
    await waitFor(() => expect(sessionData(pb).labeling_results).toEqual({ 't1|0|a': true }))
  })

  it('Previous lets the player overwrite a verdict', async () => {
    const { pb } = renderPage()
    await answer('Correct')
    fireEvent.click(await screen.findByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('v0')).toBeInTheDocument()
    await answer('Error')
    await waitFor(() => expect(sessionData(pb).labeling_results).toEqual({ 't1|0|a': false }))
  })

  it('with no cards (all folds bulk annotated) Next still starts propagation', async () => {
    m.fetchLabelingSample.mockResolvedValue({ cards: [], bulk_annotated_folds: 2 } as any)
    renderPage()
    expect(await screen.findByText(/bulk-annotated! No individual labeling needed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(m.startPropagation).toHaveBeenCalledWith('p1', { own: [] }))
  })

  it('Next sends only swiped cards, inverted to is_error, and moves on when the job is done', async () => {
    renderPage()
    await answer('Correct')
    await answer('Error')
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Propagated Errors' })
    expect(m.startPropagation).toHaveBeenCalledWith('p1', {
      own: [
        { table: 't1', row: 0, col: 'a', val: 'v0', is_error: false, domain_fold: 'D0', cell_fold: 'F0' },
        { table: 't1', row: 1, col: 'a', val: 'v1', is_error: true, domain_fold: 'D0', cell_fold: 'F0' },
      ],
    })
  })

  it('a failed propagation job shows its error and stays', async () => {
    m.fetchJob.mockResolvedValue({ id: 'job1', state: 'failed', error: 'no labeled cells' })
    renderPage()
    await screen.findByText('v0') // Next is disabled until the cards have loaded
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/no labeled cells/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Propagated Errors' })).toBeNull()
  })
})

describe('Labeling in a room', () => {
  it('warns when the room has not started', async () => {
    renderPage(ROOM_SESSION, seedRoom('lobby'))
    expect(await screen.findByText(/Your room has not started yet/)).toBeInTheDocument()
    expect(m.fetchCandidates).not.toHaveBeenCalled()
  })

  it('claims exactly the player budget in candidate order, and keeps the claims on reload', async () => {
    const pb = seedRoom()
    const first = renderPage(ROOM_SESSION, pb)
    expect(await screen.findByText('v0')).toBeInTheDocument()
    expect(pb.data.claims.map((c: any) => c.cell_id)).toEqual(['t1|0|a', 't1|1|a'])
    expect(m.fetchCards).toHaveBeenCalledWith('p1', ['t1|0|a', 't1|1|a'])
    expect(screen.getByText('Card 1 of 2')).toBeInTheDocument()
    first.unmount()
    renderPage(ROOM_SESSION, pb)
    expect(await screen.findByText('v0')).toBeInTheDocument()
    expect(pb.data.claims).toHaveLength(2)
  })

  it('another player\'s claims are skipped', async () => {
    const pb = seedRoom()
    pb.data.claims = [{ id: 'c0', room: 'r1', cell_id: 't1|0|a', player: 'pl2' }]
    renderPage(ROOM_SESSION, pb)
    expect(await screen.findByText('v1')).toBeInTheDocument()
    expect(m.fetchCards).toHaveBeenCalledWith('p1', ['t1|1|a', 't1|2|a'])
  })

  it('saves each verdict to the room with its ground-truth check, one record per cell', async () => {
    const pb = seedRoom()
    renderPage(ROOM_SESSION, pb)
    await answer('Correct')
    await waitFor(() => expect(pb.data.labels).toHaveLength(1))
    expect(m.judgeVerdicts).toHaveBeenCalledWith('demo', [{ table: 't1', row: 0, col: 'a', said_correct: true }])
    expect(pb.data.labels[0]).toMatchObject({ cell_id: 't1|0|a', player: 'pl1', value: true, is_correct: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Previous' }))
    m.judgeVerdicts.mockResolvedValue([false])
    await answer('Error')
    await waitFor(() => expect(pb.data.labels[0]).toMatchObject({ value: false, is_correct: false }))
    expect(pb.data.labels).toHaveLength(1)
  })

  it('keeps the verdict and warns when the room check fails', async () => {
    m.judgeVerdicts.mockRejectedValue(new Error('judge down'))
    const pb = seedRoom()
    renderPage(ROOM_SESSION, pb)
    await answer('Correct')
    expect(await screen.findByText(/Could not share your verdict with the room/)).toBeInTheDocument()
    await waitFor(() => expect(sessionData(pb).labeling_results).toEqual({ 't1|0|a': true }))
  })

  it('Next passes the room labels and player id, and stores the disputed cells', async () => {
    const pb = seedRoom()
    pb.data.labels = [{ id: 'l1', room: 'r1', cell_id: 't1|0|a', player: 'pl2', value: true, is_correct: true, latency_ms: 5 }]
    renderPage(ROOM_SESSION, pb)
    await answer('Error')
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Propagated Errors' })
    const body = m.startPropagation.mock.calls[0][1]
    expect(body.player_id).toBe('pl1')
    expect(body.own).toHaveLength(1)
    expect(body.room_labels).toEqual(
      expect.arrayContaining([{ cell_id: 't1|0|a', player: 'pl2', value: true }]),
    )
    await waitFor(() => expect(sessionData(pb).room_disputed_cells).toEqual(['t1|0|a']))
  })
})
