import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setLang } from '../i18n'
import { de } from '../i18n/de'
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
            <Route path="/labeling-stats" element={<h1>Labeling Stats</h1>} />
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
/** The other player has labeled every pool cell that has no label yet, so the room is done once you answered. */
function everyoneLabeled(pb: FakePocketBase) {
  const have = new Set((pb.data.labels ?? []).map((l: any) => l.cell_id))
  pb.data.labels = [
    ...(pb.data.labels ?? []),
    ...POOL.filter((k) => !have.has(k)).map((k) => ({
      id: `x-${k}`, room: 'r1', cell_id: k, player: 'pl2', value: true, is_correct: true, latency_ms: 5,
    })),
  ]
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
    expect(screen.getByText('0/3 labeled')).toBeInTheDocument()
    await answer('Correct')
    expect(await screen.findByText('v1')).toBeInTheDocument()
    await waitFor(() => expect(sessionData(pb).labeling_results).toEqual({ 't1|0|a': true }))
  })

  it('Inspect table lets the player drag the table around, and the next card starts un-inspected', async () => {
    renderPage()
    await screen.findByText('v0')
    const button = screen.getByRole('button', { name: 'Inspect table' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('inspect-pad')).toBeNull()
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Done inspecting' })).toHaveAttribute('aria-pressed', 'true')
    const pad = screen.getByTestId('inspect-pad')
    const table = () => document.querySelector('.card-excerpt table') as HTMLElement
    const before = table().style.transform
    fireEvent.pointerDown(pad, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent(window, Object.assign(new Event('pointermove'), { clientX: 140, clientY: 90 }))
    fireEvent(window, new Event('pointerup'))
    await waitFor(() => expect(table().style.transform).not.toBe(before))
    expect(table().style.transform).toContain('40px')
    expect(screen.getByText(/Drag the table to look around/)).toBeInTheDocument()
    // buttons still answer while inspecting, and the next card is back to normal
    await answer('Correct')
    expect(await screen.findByText('v1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect table' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('inspect-pad')).toBeNull()
  })

  it('shows no running spinner after Continue while the propagation job runs', async () => {
    m.fetchJob.mockResolvedValue({ id: 'job1', state: 'running' })
    renderPage()
    await screen.findByText('v0')
    await answer('Correct')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(m.startPropagation).toHaveBeenCalled())
    expect(screen.queryByText('Running…')).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
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
    expect(screen.getByText('3/3 labeled')).toHaveClass('deck-progress')
  })

  it('Go back lets the player overwrite a verdict', async () => {
    const { pb } = renderPage()
    await answer('Correct')
    fireEvent.click(await screen.findByRole('button', { name: 'Go back' }))
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

  it.each([
    ['Correct', 'right'],
    ['Error', 'left'],
  ] as const)('going back after answering %s brings the card in from the %s', async (verdict, side) => {
    renderPage()
    await answer(verdict)
    expect(await screen.findByText('v1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
    expect(await screen.findByText('v0')).toBeInTheDocument()
    const top = document.querySelector('[data-testid="deck-card"][data-depth="0"]')
    expect(top).toHaveAttribute('data-enter-from', side)
  })

  it('Continue shows the spinner while the propagation job runs, and nowhere else', async () => {
    m.fetchJob.mockResolvedValue({ id: 'job1', state: 'running' })
    renderPage()
    await screen.findByText('v0')
    await answer('Correct')
    const cont = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(cont).toBeEnabled())
    fireEvent.click(cont)
    await waitFor(() => expect(cont).toHaveAttribute('aria-busy', 'true'))
    expect(cont.querySelector('.spinner')).not.toBeNull()
    expect(screen.queryByText('Running…')).toBeNull()
  })

  it('solo: when every card is already answered it starts at the first card, not past the end', async () => {
    renderPage({ pipeline_path: 'p1', labeling_results: { 't1|0|a': true, 't1|1|a': false, 't1|2|a': true } })
    expect(await screen.findByText('v0')).toBeInTheDocument()
    expect(screen.getByText('3/3 labeled')).toBeInTheDocument()
    expect(screen.queryByText(/All cards answered/)).toBeNull()
  })

  it('solo: part-way through a round it still resumes at the first unanswered card', async () => {
    renderPage({ pipeline_path: 'p1', labeling_results: { 't1|0|a': true, 't1|1|a': false } })
    expect(await screen.findByText('v2')).toBeInTheDocument()
    expect(screen.getByText('2/3 labeled')).toBeInTheDocument()
    expect(screen.queryByText('v0')).toBeNull() // the two answered cards are behind the player
    expect(screen.queryByText('v1')).toBeNull()
  })

  it('full screen button toggles a full screen mode, and Esc leaves it', async () => {
    renderPage()
    await screen.findByText('v0')
    const page = document.querySelector('.labeling-page')!
    expect(page).not.toHaveClass('is-full')
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    expect(page).toHaveClass('is-full')
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument() // the bar stays reachable
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(page).not.toHaveClass('is-full')
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }))
    expect(page).not.toHaveClass('is-full')
  })

  it('the info panel closes when a button below it is used', async () => {
    renderPage()
    await screen.findByText('v0')
    fireEvent.click(screen.getByRole('button', { name: 'Info' }))
    expect(screen.getByTestId('labeling-info')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Inspect table' }))
    expect(screen.queryByTestId('labeling-info')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Info' }))
    await answer('Correct') // answering (also by keys or swipes) closes it too
    expect(screen.queryByTestId('labeling-info')).toBeNull()
  })

  it('has no Previous button; the round go-back arrow does that job', async () => {
    renderPage()
    await screen.findByText('v0')
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument()
  })

  it('the swipe hint is not shown below the cards, only in the info panel', async () => {
    renderPage()
    await screen.findByText('v0')
    const hint = 'Swipe or drag the card right'
    expect(document.body).not.toHaveTextContent(hint)
    fireEvent.click(screen.getByRole('button', { name: 'Info' }))
    expect(screen.getByTestId('labeling-info')).toHaveTextContent(hint)
  })

  it('the info button toggles a panel with the swipe hint (solo: no room text)', async () => {
    renderPage()
    await screen.findByText('v0')
    const info = screen.getByRole('button', { name: 'Info' })
    expect(info).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('labeling-info')).toBeNull()
    fireEvent.click(info)
    expect(info).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByTestId('labeling-info')
    expect(panel).toHaveTextContent('Swipe or drag the card right if the value is correct')
    expect(panel).toHaveTextContent('← → keys')
    expect(panel).not.toHaveTextContent(/first come, first served/)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('labeling-info')).toBeNull()
  })

  it('with no cards (all folds bulk annotated) Continue still starts propagation', async () => {
    m.fetchLabelingSample.mockResolvedValue({ cards: [], bulk_annotated_folds: 2 } as any)
    renderPage()
    expect(await screen.findByText(/bulk-annotated! No individual labeling needed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(m.startPropagation).toHaveBeenCalledWith('p1', { own: [] }))
  })

  it('Continue sends only swiped cards, inverted to is_error, and moves on when the job is done', async () => {
    renderPage()
    await answer('Correct')
    await answer('Error')
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Labeling Stats' })
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
    await screen.findByText('v0') // Continue is disabled until the cards have loaded
    await answer('Correct')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/no labeled cells/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Labeling Stats' })).toBeNull()
  })
})

describe('Labeling in a room', () => {
  it('the info button holds the room details and the swipe hint; they are not on the page by default', async () => {
    const pb = seedLabeling()
    renderPage(ROOM_SESSION, pb)
    await screen.findByText('v0')
    expect(screen.queryByText(/first come, first served/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Info' }))
    const panel = screen.getByTestId('labeling-info')
    expect(panel).toHaveTextContent('room r1')
    expect(panel).toHaveTextContent('as Blue Otter')
    expect(panel).toHaveTextContent('Cells are handed out first come, first served from one shared budget')
    expect(panel).toHaveTextContent("everyone's labels are combined")
    expect(panel).toHaveTextContent('Swipe or drag the card right if the value is correct')
  })

  it('alone in a room with every cell already answered: starts at the first card, not past the end', async () => {
    const pool = ['t1|0|a', 't1|1|a', 't1|2|a']
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool })
    pb.data.claims = pool.map((k, i) => ({ id: `c${i}`, room: 'r1', cell_id: k, player: 'pl1', created: String(i + 1) }))
    pb.data.labels = pool.map((k, i) => ({ id: `l${i}`, room: 'r1', cell_id: k, player: 'pl1', value: true, is_correct: true, latency_ms: 5 }))
    renderPage(ROOM_SESSION, pb)
    expect(await screen.findByText('v0')).toBeInTheDocument()
    expect(screen.getByText(/^3\/\d+ labeled$/)).toBeInTheDocument()
    expect(screen.queryByText(/All cards answered/)).toBeNull()
    // the deck is usable from there: answering again moves to the next card
    await answer('Error')
    expect(await screen.findByText('v1')).toBeInTheDocument()
  })

  it('a helper who has answered everything keeps the "you\'re done" end state when reopening', async () => {
    const pool = ['t1|0|a', 't1|1|a']
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool })
    pb.data.claims = pool.map((k, i) => ({ id: `c${i}`, room: 'r1', cell_id: k, player: 'pl2', created: String(i + 1) }))
    pb.data.labels = pool.map((k, i) => ({ id: `l${i}`, room: 'r1', cell_id: k, player: 'pl2', value: true, is_correct: true, latency_ms: 5 }))
    renderPage({ ...ROOM_SESSION, player_token: 'tok2' }, pb)
    expect(await screen.findByText(/You.re done/)).toBeInTheDocument()
    expect(screen.queryByText('v0')).toBeNull()
  })

  it('in a room, part-way through a round it still resumes at the next unanswered card', async () => {
    const pool = [0, 1, 2, 3, 4].map((k) => `t1|${k}|a`) // 2 players share 5 cells: the host gets 3
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool })
    pb.data.claims = [0, 1].map((i) => ({ id: `c${i}`, room: 'r1', cell_id: pool[i], player: 'pl1', created: String(i + 1) }))
    pb.data.labels = [0, 1].map((i) => ({ id: `l${i}`, room: 'r1', cell_id: pool[i], player: 'pl1', value: true, is_correct: true, latency_ms: 5 }))
    renderPage(ROOM_SESSION, pb)
    expect(await screen.findByText('2/3 labeled')).toBeInTheDocument()
    expect(screen.queryByText('v0')).toBeNull() // the two answered cards are behind the player
    expect(screen.queryByText('v1')).toBeNull()
  })

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

  it('room mode ignores stale solo labeling_results: cards unanswered and Continue sends no stale verdicts', async () => {
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: POOL })
    pb.data.claims = [{ id: 'c0', room: 'r1', cell_id: 't1|3|a', player: 'pl1', created: '1' }]
    everyoneLabeled(pb)
    renderPage({ ...ROOM_SESSION, labeling_results: { 't1|3|a': false, 't1|1|a': true } }, pb)
    expect(await screen.findByText('v3')).toBeInTheDocument()
    expect(screen.getByText(/^0\/\d+ labeled$/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
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
    expect(await screen.findByText(/^1\/\d+ labeled$/)).toBeInTheDocument()
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
    expect(screen.getByText(/^1\/\d+ labeled$/)).toBeInTheDocument()
  })

  it('an exhausted pool shows the claimed notice and Continue stays enabled', async () => {
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: ['t1|0|a'] })
    renderPage(ROOM_SESSION, pb)
    await answer('Correct')
    expect(await screen.findByText(/All cells are claimed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
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
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
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
    expect(await screen.findByText(/^1\/\d+ labeled$/)).toBeInTheDocument()
    expect(pb.data.claims).toHaveLength(2)
    vi.restoreAllMocks()
  })

  it('a helper who is done gets a done screen with no buttons: the host moves them on', async () => {
    const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: ['t1|0|a', 't1|1|a'] })
    renderPage({ ...ROOM_SESSION, player_token: 'tok2' }, pb)
    await answer('Correct')
    expect(await screen.findByRole('heading', { name: "You're done!" })).toBeInTheDocument()
    expect(screen.getByText(/You labeled 1 cell\. The host continues/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Correct' })).toBeNull() // no deck, no leftover notices
    expect(screen.queryByText(/All cells are claimed/)).toBeNull()
  })

  it('shows the player\'s share of the budget as the total: 10 cells for 3 players is 4 + 3 + 3', async () => {
    const pool = Array.from({ length: 10 }, (_, i) => `t1|${i}|a`)
    const shares: number[] = []
    for (const token of ['tok', 'tok2', 'tok3']) {
      const pb = seedRoom('labeling', 10, { pipeline: 'p1', pool })
      pb.data.players.push({ id: 'pl3', room: 'r1', token: 'tok3', name: 'Green Fox', budget: 10, vote: 'demo', created: '3' })
      const view = renderPage({ ...ROOM_SESSION, player_token: token }, pb)
      const text = (await screen.findByText(/^\d+\/\d+ labeled$/)).textContent!
      shares.push(Number(text.split('/')[1].split(' ')[0]))
      view.unmount()
    }
    expect(shares).toEqual([4, 3, 3])
  })

  it('a single player in a room labels the whole budget', async () => {
    const pool = Array.from({ length: 10 }, (_, i) => `t1|${i}|a`)
    const pb = seedRoom('labeling', 10, { pipeline: 'p1', pool })
    pb.data.players = [pb.data.players[0]]
    renderPage(ROOM_SESSION, pb)
    expect(await screen.findByText('0/10 labeled')).toBeInTheDocument()
  })

  it('saves each verdict to the room with its ground-truth check, one record per cell', async () => {
    const pb = seedLabeling()
    renderPage(ROOM_SESSION, pb)
    await answer('Correct')
    await waitFor(() => expect(pb.data.labels).toHaveLength(1))
    expect(m.judgeVerdicts).toHaveBeenCalledWith('demo', [{ table: 't1', row: 0, col: 'a', said_correct: true }])
    expect(pb.data.labels[0]).toMatchObject({ cell_id: 't1|0|a', player: 'pl1', value: true, is_correct: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Go back' }))
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

  it('Continue passes the room labels and player id, and stores the disputed cells', async () => {
    const pb = seedLabeling()
    pb.data.labels = [{ id: 'l1', room: 'r1', cell_id: 't1|0|a', player: 'pl2', value: true, is_correct: true, latency_ms: 5 }]
    everyoneLabeled(pb)
    renderPage(ROOM_SESSION, pb)
    await answer('Error')
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Labeling Stats' })
    const body = m.startPropagation.mock.calls[0][1]
    expect(body.player_id).toBe('pl1')
    expect(body.own).toHaveLength(1)
    expect(body.room_labels).toEqual(
      expect.arrayContaining([{ cell_id: 't1|0|a', player: 'pl2', value: true }]),
    )
    await waitFor(() => expect(sessionData(pb).room_disputed_cells).toEqual(['t1|0|a']))
  })

  it('later steps follow the pipeline the room labeled, even if the session switched pipelines', async () => {
    // The host went back to Configurations and made a new pipeline after the room had published its pool.
    const pb = seedRoom('labeling', 2, { pipeline: 'p-room', pool: POOL })
    pb.data.claims = [{ id: 'c0', room: 'r1', cell_id: 't1|0|a', player: 'pl1', created: '1' }]
    everyoneLabeled(pb)
    renderPage({ ...ROOM_SESSION, pipeline_path: 'p-session' }, pb)
    await answer('Error')
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Labeling Stats' })
    expect(m.startPropagation.mock.calls[0][0]).toBe('p-room')
    // Labeling Stats, Propagated Errors, Error Detection and Results read the session's pipeline: it must be the labeled one.
    await waitFor(() => expect(sessionData(pb).pipeline_path).toBe('p-room'))
  })

  describe('waiting for the other players', () => {
    it('lets the host continue after one label, but only after confirming, and shows how far the room is', async () => {
      const pb = seedLabeling()
      renderPage(ROOM_SESSION, pb)
      await screen.findByRole('heading', { name: /^v\d$/ })
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled() // nothing labeled yet
      await answer('Correct')
      expect(screen.queryByText(/Waiting for everyone/)).toBeNull()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent('stops labeling for everyone')
      expect(m.startPropagation).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Keep labeling' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(pb.data.rooms[0].labeling_closed).toBeFalsy()
    })

    it('confirming closes labeling for the room and propagates the labels so far', async () => {
      const pb = seedLabeling()
      renderPage(ROOM_SESSION, pb)
      await screen.findByRole('heading', { name: /^v\d$/ })
      await answer('Correct')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Continue for everyone' }))
      await screen.findByRole('heading', { name: 'Labeling Stats' })
      expect(pb.data.rooms[0].labeling_closed).toBe(true)
      expect(m.startPropagation.mock.calls[0][1].own).toHaveLength(1)
    })

    it('continues without a dialog once everyone has finished', async () => {
      const pb = seedLabeling()
      everyoneLabeled(pb)
      renderPage(ROOM_SESSION, pb)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
      await new Promise((r) => setTimeout(r, 50)) // the room progress has loaded
      expect(screen.queryByText(/Everyone has finished|All cards answered|Labeling closed with/)).toBeNull() // no hints
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      await screen.findByRole('heading', { name: 'Labeling Stats' })
    })

    it('reopens labeling when the host comes back to it, so the remaining cards can be swiped', async () => {
      const pb = seedLabeling()
      pb.data.rooms[0].labeling_closed = true // the host had continued before every card was answered
      renderPage(ROOM_SESSION, pb)
      await waitFor(() => expect(pb.data.rooms[0].labeling_closed).toBe(false))
      expect(await screen.findByRole('heading', { name: /^v\d$/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Correct' })).toBeEnabled()
    })

    it('does not reopen labeling for a helper', async () => {
      const pb = seedLabeling()
      pb.data.rooms[0].labeling_closed = true
      renderPage({ ...ROOM_SESSION, player_token: 'tok2' }, pb)
      expect(await screen.findByRole('heading', { name: "You're done!" })).toBeInTheDocument()
      expect(pb.data.rooms[0].labeling_closed).toBe(true)
    })

    it('stops a helper from labeling once the host has continued', async () => {
      const pb = seedLabeling()
      pb.data.rooms[0].labeling_closed = true
      renderPage({ ...ROOM_SESSION, player_token: 'tok2' }, pb)
      expect(await screen.findByRole('heading', { name: "You're done!" })).toBeInTheDocument()
      expect(screen.getByText(/The host has ended labeling/)).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Correct' })).toBeNull()
    })

    it('shows a helper still labeling the same progress, with no buttons of their own', async () => {
      renderPage({ ...ROOM_SESSION, player_token: 'tok2' }, seedLabeling())
      await screen.findByRole('heading', { name: /^v\d$/ })
      expect(screen.queryByText(/Waiting for everyone/)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
      expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull()
      expect(screen.queryByRole('link', { name: 'Back' })).toBeNull()
    })

    it('picks up a cell another player left behind, so the room cannot wait forever', async () => {
      const pb = seedRoom('labeling', 2, { pipeline: 'p1', pool: ['t1|0|a', 't1|1|a'] })
      pb.data.claims = [
        { id: 'c0', room: 'r1', cell_id: 't1|0|a', player: 'pl1', created: '1' },
        { id: 'c1', room: 'r1', cell_id: 't1|1|a', player: 'pl2', created: '2' },
      ]
      renderPage(ROOM_SESSION, pb)
      await answer('Correct')
      pb.data.claims = pb.data.claims.filter((c: any) => c.id !== 'c1') // pl2 left; their claim was released
      await act(async () => {
        await pb.collection('players').delete('pl2') // and the share grows to the whole budget
      })
      expect(await screen.findByRole('heading', { name: 'v1' })).toBeInTheDocument()
    })

    it('does not make a solo player wait', async () => {
      renderPage()
      await screen.findByRole('heading', { name: 'v0' })
      await answer('Correct')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
      expect(screen.queryByText(/Waiting for everyone/)).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  describe('swiping never shows a loading spinner', () => {
    const FAR = [10, 20, 30].map((i) => card(i)) // distinct table excerpts: rows 5.., 15.., 25..

    it('does not show a spinner while the next card\'s table is still loading', async () => {
      m.fetchLabelingSample.mockResolvedValue({ cards: FAR, bulk_annotated_folds: 0 } as any)
      m.fetchDirtyPage.mockImplementation(((_d: string, _t: string, start: number) =>
        start === 5 ? Promise.resolve({ columns: ['a'], rows: [['x']], total_rows: 99, offset: 5 }) : new Promise(() => {})) as any)
      renderPage()
      await screen.findByRole('heading', { name: 'v10' })
      await answer('Correct')
      await screen.findByRole('heading', { name: 'v20' })
      expect(screen.queryByText('Loading table…')).toBeNull()
      expect(document.querySelector('.spinner')).toBeNull()
    })

    it('fetches the next cards\' tables ahead of time', async () => {
      m.fetchLabelingSample.mockResolvedValue({ cards: FAR, bulk_annotated_folds: 0 } as any)
      renderPage()
      await screen.findByRole('heading', { name: 'v10' })
      await waitFor(() => {
        expect(m.fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 15, 11)
        expect(m.fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 25, 11)
      })
    })

    it('does not show a spinner in a room while the next cell is being claimed', async () => {
      m.fetchCards.mockReset()
        .mockImplementationOnce((async (_n: string, keys: string[]) => keys.map((k) => card(Number(k.split('|')[1])))) as any)
        .mockImplementation((() => new Promise(() => {})) as any)
      renderPage(ROOM_SESSION, seedLabeling())
      await screen.findByRole('heading', { name: /^v\d$/ })
      await answer('Correct')
      await new Promise((r) => setTimeout(r, 50))
      expect(screen.queryByText('Loading the next cell…')).toBeNull()
    })
  })

  it('centres the cell being labeled in the middle of the card', async () => {
    const sizes: Record<string, number> = { clientWidth: 400, clientHeight: 500, offsetLeft: 10, offsetTop: 20, offsetWidth: 100, offsetHeight: 30 }
    const restore = Object.keys(sizes).map((k) => {
      const prev = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)
      Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => sizes[k] })
      return () => (prev ? Object.defineProperty(HTMLElement.prototype, k, prev) : delete (HTMLElement.prototype as any)[k])
    })
    try {
      renderPage()
      await screen.findByRole('heading', { name: 'v0' })
      await waitFor(() => {
        const table = document.querySelector('[data-testid="deck-card"] table') as HTMLElement
        expect(table.style.transform).toBe('translate(140px, 215px)')
      })
    } finally {
      restore.forEach((r) => r())
    }
  })

  describe('strategy pills', () => {
    const many = { ...card(0), strategies: ['Typo Detector', 'Pattern Check', 'Outlier Check'] }

    it('shows one strategy and hides the rest behind a show-more button', async () => {
      m.fetchLabelingSample.mockResolvedValue({ cards: [many, card(1), card(2)], bulk_annotated_folds: 0 } as any)
      renderPage()
      await screen.findByRole('heading', { name: 'v0' })
      expect(screen.getByText('Typo Detector')).toBeInTheDocument()
      expect(screen.queryByText('Pattern Check')).toBeNull()
      expect(screen.queryByText('Outlier Check')).toBeNull()
      const more = screen.getByRole('button', { name: '+2 more' })
      expect(more).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(more)
      expect(screen.getByText('Pattern Check')).toBeInTheDocument()
      expect(screen.getByText('Outlier Check')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
    })

    it('has no button when there is one strategy', async () => {
      m.fetchLabelingSample.mockResolvedValue({ cards: [{ ...card(0), strategies: ['A'] }, card(1), card(2)], bulk_annotated_folds: 0 } as any)
      renderPage()
      await screen.findByRole('heading', { name: 'v0' })
      expect(screen.queryByRole('button', { name: /more|Show less/ })).toBeNull()
    })
  })
})

describe('Labeling (German)', () => {
  beforeEach(() => act(() => setLang('de')))
  afterEach(() => act(() => setLang('en')))

  it('shows the card in German while the verdict buttons stay Error and Correct', async () => {
    renderPage()
    expect(await screen.findByText('v0')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Labeling' })).toBeInTheDocument()
    expect(screen.getByText(de.labeling.labeled(0, 3))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Error' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Correct' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: de.labeling.inspectTable })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: de.labeling.goBack })).toBeInTheDocument()
    expect(screen.getByText('Typo Detector')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: de.labeling.info }))
    expect(screen.getByTestId('labeling-info')).toHaveTextContent(de.labeling.infoIntro)
  })

  it('keeps the same card (value and index) when the language changes', async () => {
    renderPage()
    await screen.findByText('v0')
    await answer('Correct')
    await screen.findByText('v1')
    expect(screen.getByText(de.labeling.labeled(1, 3))).toBeInTheDocument()
    const calls = m.fetchLabelingSample.mock.calls.length
    act(() => setLang('en'))
    expect(screen.getByText('1/3 labeled')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'v1' })).toBeInTheDocument()
    act(() => setLang('de'))
    expect(screen.getByText(de.labeling.labeled(1, 3))).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'v1' })).toBeInTheDocument()
    expect(m.fetchLabelingSample.mock.calls.length).toBe(calls)
  })

  it('explains the missing pipeline in German', async () => {
    renderPage({})
    expect(await screen.findByText(de.labeling.prereqText)).toBeInTheDocument()
  })

  it('shows the room details in the info panel in German', async () => {
    renderPage(ROOM_SESSION, seedLabeling())
    await screen.findByText('v0')
    fireEvent.click(screen.getByRole('button', { name: de.labeling.info }))
    const panel = screen.getByTestId('labeling-info')
    expect(panel).toHaveTextContent('Sie sind im Raum r1 als Blue Otter')
  })
})
