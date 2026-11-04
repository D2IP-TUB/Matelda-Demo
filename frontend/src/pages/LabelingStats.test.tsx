import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setLang } from '../i18n'
import { de } from '../i18n/de'
import * as api from '../lib/api'
import { RoomService } from '../rooms/roomService'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { LabelingStats } from './LabelingStats'

vi.mock('../lib/api', () => ({
  fetchLabelAccuracy: vi.fn(),
}))
const m = vi.mocked(api)

function renderPage(session: Record<string, unknown> = { pipeline_path: 'p1' }, pb = new FakePocketBase()) {
  const sessions = new SessionService(pb as any, seedSession(pb, session))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter>
          <LabelingStats roomService={new RoomService(pb as any)} />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return pb
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
  m.fetchLabelAccuracy.mockReset().mockResolvedValue({
    total: 4, correct: 3, accuracy: 0.75,
    rows: [{ table: 't1', row: 0, col: 'a', val: 'x', user_said_error: false, truth_is_error: false, clean_value: 'x', correct: true }],
  } as any)
})

describe('LabelingStats (German)', () => {
  beforeEach(() => act(() => setLang('de')))
  afterEach(() => act(() => setLang('en')))

  it('shows the German lead and table headers, with data unchanged', async () => {
    renderPage()
    expect(await screen.findByText(de.labelingStats.lead)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Labeling Stats' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 2, name: de.labelingStats.labelAnalysis })).toBeInTheDocument()
    expect(await screen.findByText(de.labelingStats.colYouSaid)).toBeInTheDocument()
    expect(screen.getByText('75.0%')).toBeInTheDocument()
    expect(screen.getByText('t1')).toBeInTheDocument()
  })

  it('translates the stat tiles in the room but keeps player names', async () => {
    renderPage({ ...ROOM_SESSION, room_disputed_cells: ['a', 'b'] }, seedRoom())
    expect(await screen.findByText(de.labelingStats.roomLabeling)).toBeInTheDocument()
    expect(screen.getByText(de.labelingStats.labelsInRoom, { selector: '.stat span' })).toBeInTheDocument()
    expect(screen.getByText(de.labelingStats.labelers, { selector: '.stat span' })).toBeInTheDocument()
    const board = await screen.findByRole('list', { name: de.labelingStats.leaderboard })
    expect(board).toHaveTextContent('Blue Otter')
    expect(board).toHaveTextContent('Red Yeti')
    expect(board).toHaveTextContent(de.labelingStats.you)
    expect(screen.getByText(de.labelingStats.disputed(2))).toBeInTheDocument()
  })

  it('explains the missing pipeline in German', async () => {
    renderPage({})
    expect(await screen.findByText(de.labelingStats.prereqText)).toBeInTheDocument()
  })
})

describe('LabelingStats', () => {
  it('asks to configure a pipeline first', async () => {
    renderPage({})
    expect(await screen.findByRole('alert')).toHaveTextContent('Pipeline not configured')
    expect(m.fetchLabelAccuracy).not.toHaveBeenCalled()
  })

  it('shows your labeling accuracy right away, without a CSV download', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Labeling Stats' })).toBeInTheDocument()
    expect(await screen.findByText('75.0%')).toBeInTheDocument()
    expect(m.fetchLabelAccuracy).toHaveBeenCalledWith('p1', 0, 100)
    expect(screen.queryByRole('link', { name: 'Download CSV' })).toBeNull()
  })

  it('tints each row green when you were right and red when you were wrong', async () => {
    m.fetchLabelAccuracy.mockResolvedValue({
      total: 2, correct: 1, accuracy: 0.5,
      rows: [
        { table: 't1', row: 0, col: 'a', val: 'x', user_said_error: false, truth_is_error: false, clean_value: 'x', correct: true },
        { table: 't1', row: 1, col: 'a', val: 'y', user_said_error: true, truth_is_error: false, clean_value: 'y', correct: false },
      ],
    } as any)
    renderPage()
    const right = (await screen.findByText('✓ Correct')).closest('tr')!
    const wrong = screen.getByText('✗ Wrong').closest('tr')!
    expect(right).toHaveClass('row-right')
    expect(wrong).toHaveClass('row-wrong')
  })

  it('shows an empty state with a way back to labeling when there are no saved labels', async () => {
    m.fetchLabelAccuracy.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByRole('heading', { name: 'No labels yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Labeling' })).toHaveAttribute('href', '/labeling')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Label Analysis' })).toBeNull()
  })

  it('in a room without labels, shows the empty state in the room section and no Label Analysis', async () => {
    m.fetchLabelAccuracy.mockResolvedValue(null)
    const pb = seedRoom()
    pb.data.labels = []
    renderPage(ROOM_SESSION, pb)
    expect(await screen.findByRole('heading', { name: 'Room labeling' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'No labels yet' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'No labels yet' })).toHaveLength(1)
    expect(screen.queryByText(/has no labels yet/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Label Analysis' })).toBeNull()
  })

  it('shows other errors as a warning', async () => {
    m.fetchLabelAccuracy.mockRejectedValue(new Error('Could not load the labeling accuracy'))
    renderPage()
    expect(await screen.findByText('Could not load the labeling accuracy')).toBeInTheDocument()
  })

  it('has no room section outside a room', async () => {
    renderPage()
    await screen.findByText('75.0%')
    expect(screen.queryByText('Room labeling')).toBeNull()
  })

  it('summarises the room with a leaderboard and the disputed cells, without the per-player table', async () => {
    renderPage({ ...ROOM_SESSION, room_disputed_cells: ['a', 'b'] }, seedRoom())
    expect(await screen.findByText('Room labeling')).toBeInTheDocument()
    const board = await screen.findByRole('list', { name: 'Leaderboard by accuracy' })
    expect(board).toHaveTextContent('Blue Otter')
    expect(board).toHaveTextContent('You')
    expect(board).toHaveTextContent('100% · 6 labels')
    expect(screen.getByText('Labels in the room', { selector: '.stat span' }).nextSibling).toHaveTextContent('8')
    expect(screen.getByText('Labelers', { selector: '.stat span' }).nextSibling).toHaveTextContent('2')
    expect(screen.getByText('Room accuracy', { selector: '.stat span' }).nextSibling).toHaveTextContent('88%')
    expect(screen.getByText(/2 disputed cell\(s\)/)).toBeInTheDocument()
    expect(screen.queryByText('Median time')).toBeNull()
    expect(screen.queryByText('Marked as error')).toBeNull()
    expect(screen.queryByText(/Everyone's labels count/)).toBeNull()
  })

  it('shows a helper the room results only: no Label Analysis and no buttons', async () => {
    const pb = seedRoom()
    pb.data.rooms[0].host = 'pl1' // Blue Otter hosts; Red Yeti (tok2) is a helper
    renderPage({ ...ROOM_SESSION, player_token: 'tok2', pipeline_path: undefined }, pb)
    expect(await screen.findByRole('list', { name: 'Leaderboard by accuracy' })).toHaveTextContent('Red Yeti')
    expect(screen.queryByRole('heading', { name: 'Label Analysis' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull() // their screen follows the host
    expect(screen.queryByText(/Pipeline not configured/)).toBeNull()
    expect(m.fetchLabelAccuracy).not.toHaveBeenCalled()
  })

  it('puts Room labeling above Label Analysis', async () => {
    renderPage(ROOM_SESSION, seedRoom())
    const room = await screen.findByRole('heading', { name: 'Room labeling' })
    const analysis = await screen.findByRole('heading', { name: 'Label Analysis' })
    expect(room.compareDocumentPosition(analysis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('has a Continue button to Propagated Errors, and Back to Labeling', async () => {
    renderPage()
    await screen.findByText('75.0%')
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/propagated-errors')
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/labeling')
  })
})
