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

const POOL = [0, 1, 2, 3, 4].map((i) => `t1|${i}|a`)
function seedRoom(phase = 'labeling', budget = 2, room: Record<string, unknown> = {}) {
  const pb = new FakePocketBase()
  pb.data.rooms = [{ id: 'rm1', name: 'r1', phase, dataset: 'demo', pipeline: '', host: 'pl1', pool: null, ...room }]
  pb.data.players = [
    { id: 'pl1', room: 'r1', token: 'tok', name: 'Blue Otter', budget, vote: 'demo', created: '1' },
    { id: 'pl2', room: 'r1', token: 'tok2', name: 'Red Yeti', budget, vote: 'demo', created: '2' },
  ]
  return pb
}
function seedLabeling() {
  const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: POOL })
  pb.data.claims = [{ id: 'c0', room: 'r1', cell_id: 't1|0|a', player: 'pl1', created: '1' }]
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

  it('stacked back cards show their value, and the round buttons are disabled once all cards are answered', async () => {
    renderPage()
    await screen.findByText('v0')
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Correct' })).toHaveClass('round', 'round-correct')
    await answer('Correct')
    await answer('Correct')
    await answer('Correct')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Correct' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Error' })).toBeDisabled()
    expect(screen.getByText('Card 3 of 3')).toHaveClass('deck-progress')
  })

  it('Previous lets the player overwrite a verdict', async () => {
    const { pb } = renderPage()
    await answer('Correct')
    fireEvent.click(await screen.findByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('v0')).toBeInTheDocument()
    await answer('Error')
    await waitFor(() => expect(sessionData(pb).labeling_results).toEqual({ 't1|0|a': false }))
  })

  it('the middle go-back button sits between Error and Correct and returns to the previous card', async () => {
    renderPage()
    const back = await screen.findByRole('button', { name: 'Go back' })
    const [error, , correct] = Array.from(document.querySelectorAll('.verdict-buttons button'))
    expect(error).toHaveAccessibleName('Error')
    expect(correct).toHaveAccessibleName('Correct')
    expect(document.querySelectorAll('.verdict-buttons button')[1]).toBe(back)
    expect(back).toBeDisabled() // nothing to go back to on the first card
    await answer('Correct')
    expect(await screen.findByText('v1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go back' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
    expect(await screen.findByText('v0')).toBeInTheDocument()
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

  it('the host publishes the pool once, and only the host calls fetchCandidates', async () => {
    const pb = seedRoom()
    renderPage(ROOM_SESSION, pb)
    await waitFor(() => expect(pb.data.rooms[0].pool).toEqual(POOL))
    expect(pb.data.rooms[0]).toMatchObject({ pipeline: 'p1', host: 'pl1' })
    expect(m.fetchCandidates).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/^v\d$/)).toBeInTheDocument()
    expect(m.fetchCandidates).toHaveBeenCalledTimes(1)
  })

  it('a host whose room has PocketBase zero values (pipeline "") publishes with the session pipeline', async () => {
    const pb = seedRoom()
    expect(pb.data.rooms[0]).toMatchObject({ pipeline: '', pool: null })
    renderPage(ROOM_SESSION, pb)
    await waitFor(() => expect(pb.data.rooms[0].pool).toEqual(POOL))
    expect(m.fetchCandidates).toHaveBeenCalledWith('p1')
    expect(pb.data.rooms[0].pipeline).toBe('p1')
    expect(screen.queryByText(/Pipeline not configured/)).toBeNull()
    expect(await screen.findByText(/^v\d$/)).toBeInTheDocument()
  })

  it('shows Loading room while the room has not loaded, never Pipeline not configured', async () => {
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: POOL })
    const slow = new RoomService(pb as any)
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const orig = slow.getRoom.bind(slow)
    vi.spyOn(slow, 'getRoom').mockImplementation(async (n) => { await gate; return orig(n) })
    const sessions = new SessionService(pb as any, seedSession(pb, { room_name: 'r1', player_token: 'tok2' }))
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionProvider service={sessions}>
          <MemoryRouter initialEntries={['/labeling']}>
            <Routes><Route path="/labeling" element={<Labeling roomService={slow} pollMs={5} />} /></Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/Loading room…/)).toBeInTheDocument()
    expect(screen.queryByText(/Pipeline not configured/)).toBeNull()
    release()
    expect(await screen.findByText(/^v\d$/)).toBeInTheDocument()
  })

  it('shows a could-not-reach notice when the stored room cannot be resolved', async () => {
    const pb = seedRoom()
    vi.spyOn(RoomService.prototype, 'getRoom').mockRejectedValue(new Error('network'))
    renderPage({ ...ROOM_SESSION, pipeline_path: undefined }, pb)
    expect(await screen.findByText(/Could not reach the room/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /lobby/i })).toHaveAttribute('href', '/lobby')
    expect(screen.queryByText(/Pipeline not configured/)).toBeNull()
    vi.restoreAllMocks()
  })

  it('room mode ignores stale solo labeling_results: cards unanswered and Next sends no stale verdicts', async () => {
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: POOL })
    pb.data.claims = [{ id: 'c0', room: 'r1', cell_id: 't1|3|a', player: 'pl1', created: '1' }]
    renderPage({ ...ROOM_SESSION, labeling_results: { 't1|3|a': false, 't1|1|a': true } }, pb)
    expect(await screen.findByText('v3')).toBeInTheDocument()
    expect(screen.getByText('Card 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(m.startPropagation).toHaveBeenCalled())
    expect(m.startPropagation.mock.calls[0][1].own).toEqual([])
  })

  it('a helper without a pool waits and touches no pipeline endpoint', async () => {
    const pb = seedRoom()
    renderPage({ ...ROOM_SESSION, player_token: 'tok2' }, pb)
    expect(await screen.findByText(/Waiting for labeling/)).toBeInTheDocument()
    expect(m.fetchCandidates).not.toHaveBeenCalled()
    expect(m.fetchPipeline).not.toHaveBeenCalled()
    expect(m.fetchCards).not.toHaveBeenCalled()
    expect(m.startPropagation).not.toHaveBeenCalled()
  })

  it('a helper starts when the pool appears, using the room pipeline', async () => {
    const pb = seedRoom()
    renderPage({ room_name: 'r1', player_token: 'tok2' }, pb)
    await screen.findByText(/Waiting for labeling/)
    pb.data.rooms[0] = { ...pb.data.rooms[0], pipeline: 'hostp', pool: POOL }
    pb.notify('rooms')
    expect(await screen.findByText(/^v\d$/)).toBeInTheDocument()
    expect(m.fetchCards).toHaveBeenCalledWith('hostp', [expect.stringMatching(/^t1\|\d\|a$/)])
    expect(m.fetchCandidates).not.toHaveBeenCalled()
  })

  it('claims one cell at a time and fetches only that card after each answer', async () => {
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: POOL })
    renderPage(ROOM_SESSION, pb)
    const first = await screen.findByText(/^v\d$/)
    expect(pb.data.claims).toHaveLength(1)
    expect(m.fetchCards).toHaveBeenCalledTimes(1)
    expect(m.fetchCards.mock.calls[0][1]).toHaveLength(1)
    const firstText = first.textContent
    await answer('Correct')
    await waitFor(() => expect(pb.data.claims).toHaveLength(2))
    await waitFor(() => expect(m.fetchCards).toHaveBeenCalledTimes(2))
    expect(m.fetchCards.mock.calls[1][1]).toHaveLength(1)
    expect(await screen.findByText('Card 2')).toBeInTheDocument()
    expect(screen.queryByText(firstText as string)).toBeNull()
  })

  it('reload resumes the own unlabeled claim', async () => {
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: POOL })
    pb.data.claims = [{ id: 'c0', room: 'r1', cell_id: 't1|3|a', player: 'pl1', created: '1' }]
    renderPage(ROOM_SESSION, pb)
    expect(await screen.findByText('v3')).toBeInTheDocument()
    expect(pb.data.claims).toHaveLength(1)
    expect(m.fetchCards).toHaveBeenCalledWith('p1', ['t1|3|a'])
  })

  it('reload positions past already answered cards', async () => {
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: POOL })
    pb.data.claims = [{ id: 'c0', room: 'r1', cell_id: 't1|3|a', player: 'pl1', created: '1' }]
    pb.data.labels = [{ id: 'l0', room: 'r1', cell_id: 't1|3|a', player: 'pl1', value: true, is_correct: true, latency_ms: 1 }]
    renderPage({ ...ROOM_SESSION, labeling_results: { 't1|3|a': true } }, pb)
    await waitFor(() => expect(pb.data.claims).toHaveLength(2))
    expect(m.fetchCards).toHaveBeenCalledWith('p1', ['t1|3|a'])
    const other = pb.data.claims[1].cell_id as string
    expect(await screen.findByText(`v${other.split('|')[1]}`)).toBeInTheDocument()
    expect(screen.getByText('Card 2')).toBeInTheDocument()
  })

  it('an exhausted pool shows the claimed notice and Next stays enabled', async () => {
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: ['t1|0|a'] })
    renderPage(ROOM_SESSION, pb)
    await answer('Correct')
    expect(await screen.findByText(/All cells are claimed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('has no release or check-again buttons, for the host or for helpers', async () => {
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: ['t1|0|a'] })
    renderPage(ROOM_SESSION, pb)
    await answer('Correct')
    expect(await screen.findByText(/All cells are claimed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Release unlabeled claims/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })

  it('shows an error and does not publish when there are no candidate cells', async () => {
    m.fetchCandidates.mockResolvedValue({ keys: [], sample_size: 0 })
    const pb = seedRoom()
    renderPage(ROOM_SESSION, pb)
    expect(await screen.findByText(/No cells to label — go back to Quality Folding\./)).toBeInTheDocument()
    expect(pb.data.rooms[0].pool).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Back' })).toBeInTheDocument()
  })

  it.each([
    ['judgeVerdicts', () => m.judgeVerdicts.mockRejectedValue(new Error('judge down'))],
    ['saveLabel', () => vi.spyOn(RoomService.prototype, 'saveLabel').mockRejectedValue(new Error('save down'))],
  ])('still loads the next card when %s fails', async (_n, fail) => {
    const pb = seedLabeling()
    renderPage(ROOM_SESSION, pb)
    await screen.findByText('v0')
    fail()
    await answer('Correct')
    expect(await screen.findByText('Card 2')).toBeInTheDocument()
    expect(pb.data.claims).toHaveLength(2)
    vi.restoreAllMocks()
  })

  it('a helper who is done gets a notice instead of Next', async () => {
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: ['t1|0|a'] })
    renderPage({ ...ROOM_SESSION, player_token: 'tok2' }, pb)
    await answer('Correct')
    expect(await screen.findByText(/You're done — the host will continue with the results/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('saves each verdict to the room with its ground-truth check, one record per cell', async () => {
    const pb = seedLabeling()
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
    const pb = seedLabeling()
    renderPage(ROOM_SESSION, pb)
    await answer('Correct')
    expect(await screen.findByText(/Could not share your verdict with the room/)).toBeInTheDocument()
    await waitFor(() => expect(sessionData(pb).labeling_results).toEqual({ 't1|0|a': true }))
  })

  it('Next passes the room labels and player id, and stores the disputed cells', async () => {
    const pb = seedLabeling()
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
