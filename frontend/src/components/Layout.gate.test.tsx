import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RoomService } from '../rooms/roomService'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { Layout } from './Layout'
import { WaitingForLabeling } from './WaitingForLabeling'

const mounted = vi.fn()
function Page({ name }: { name: string }) {
  useEffect(() => mounted(name), [name])
  return <button type="button">{`Run ${name}`}</button>
}

function setup(path: string, role: 'helper' | 'host' | 'solo', opts: { phase?: string; pool?: string[]; data?: Record<string, unknown> } = {}) {
  const pb = new FakePocketBase()
  let data: Record<string, unknown> = {}
  if (role !== 'solo') {
    pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: opts.phase ?? 'started', dataset: '', host: 'p1', pool: opts.pool }]
    pb.data.players = [
      { id: 'p1', room: 'blue-otter-42', name: 'Hannah', token: 't1', created: '1' },
      { id: 'p2', room: 'blue-otter-42', name: 'Hugo', token: 't2', created: '2' },
    ]
    data = { room_name: 'blue-otter-42', player_token: role === 'host' ? 't1' : 't2' }
  }
  if (opts.data) data = opts.data
  const sessions = new SessionService(pb as any, seedSession(pb, data))
  render(
    <SessionProvider service={sessions}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout roomService={new RoomService(pb as any)} />}>
            <Route path="/lobby" element={<Page name="lobby" />} />
            <Route path="/configuration" element={<Page name="configuration" />} />
            <Route path="/domain-folding" element={<Page name="domain" />} />
            <Route path="/quality-folding" element={<Page name="quality" />} />
            <Route path="/labeling" element={<p>LABELING PAGE</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  )
  return pb
}

beforeEach(() => mounted.mockClear())

describe('Layout helper gate', () => {
  it.each(['/configuration', '/quality-folding'])('shows the waiting screen to a helper on %s', async (path) => {
    setup(path, 'helper')
    expect(await screen.findByText(/Waiting for labeling/)).toBeInTheDocument()
    expect(screen.getByText('Hannah')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Run/ })).not.toBeInTheDocument()
    expect(mounted).not.toHaveBeenCalled()
  })

  it('navigates the helper to Labeling once the pool is published', async () => {
    const pb = setup('/configuration', 'helper')
    await screen.findByText(/Waiting for labeling/)
    await act(async () => {
      await pb.collection('rooms').update('r', { pool: ['a', 'b'] })
    })
    expect(await screen.findByText('LABELING PAGE')).toBeInTheDocument()
    expect(mounted).not.toHaveBeenCalled()
  })

  it('shows the page to the host', async () => {
    setup('/configuration', 'host')
    expect(await screen.findByRole('button', { name: 'Run configuration' })).toBeInTheDocument()
    expect(screen.queryByText(/Waiting for labeling/)).not.toBeInTheDocument()
  })

  it('shows the page to a solo user', async () => {
    setup('/quality-folding', 'solo')
    expect(await screen.findByRole('button', { name: 'Run quality' })).toBeInTheDocument()
  })

  it('does not gate a helper in the lobby phase', async () => {
    setup('/configuration', 'helper', { phase: 'lobby' })
    expect(await screen.findByRole('button', { name: 'Run configuration' })).toBeInTheDocument()
  })

  it('does not gate non-pipeline routes', async () => {
    setup('/lobby', 'helper')
    expect(await screen.findByRole('button', { name: 'Run lobby' })).toBeInTheDocument()
  })
})

describe('Layout gate with an unresolvable room', () => {
  it('renders the page for a stale room name without a token', async () => {
    setup('/configuration', 'solo', { data: { room_name: 'gone-room-1' } })
    expect(await screen.findByRole('button', { name: 'Run configuration' })).toBeInTheDocument()
  })

  it('renders the page when the room fetch fails', async () => {
    const pb = new FakePocketBase()
    pb.collection('rooms').getFullList = async () => {
      throw new Error('network')
    }
    const sessions = new SessionService(pb as any, seedSession(pb, { room_name: 'blue-otter-42', player_token: 't2' }))
    render(
      <SessionProvider service={sessions}>
        <MemoryRouter initialEntries={['/configuration']}>
          <Routes>
            <Route element={<Layout roomService={new RoomService(pb as any)} />}>
              <Route path="/configuration" element={<Page name="configuration" />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </SessionProvider>,
    )
    expect(await screen.findByRole('button', { name: 'Run configuration' })).toBeInTheDocument()
  })

  it('does not get stuck for a removed player', async () => {
    const pb = setup('/configuration', 'helper', { phase: 'started' })
    await screen.findByText(/Waiting for labeling/)
    await act(async () => {
      await pb.collection('players').delete('p2')
    })
    expect(await screen.findByRole('button', { name: 'Run configuration' })).toBeInTheDocument()
    expect((pb.data.sessions[0].data as any).room_name).toBeUndefined()
  })

  it('does not get stuck when the room ended', async () => {
    const pb = setup('/configuration', 'helper')
    await screen.findByText(/Waiting for labeling/)
    await act(async () => {
      await pb.collection('rooms').update('r', { phase: 'ended' })
    })
    expect(await screen.findByRole('button', { name: 'Run configuration' })).toBeInTheDocument()
    expect((pb.data.sessions[0].data as any).room_name).toBeUndefined()
  })
})

describe('Layout gate extras', () => {
  it('gates /domain-folding', async () => {
    setup('/domain-folding', 'helper')
    expect(await screen.findByText(/Waiting for labeling/)).toBeInTheDocument()
    expect(mounted).not.toHaveBeenCalled()
  })

  it('shows the host the page even when the pool is published', async () => {
    setup('/configuration', 'host', { pool: ['a'] })
    expect(await screen.findByRole('button', { name: 'Run configuration' })).toBeInTheDocument()
    expect(screen.queryByText('LABELING PAGE')).not.toBeInTheDocument()
  })
})

describe('WaitingForLabeling', () => {
  it('lists the players', () => {
    render(<WaitingForLabeling players={[{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }] as any} />)
    expect(screen.getByText(/the host is preparing the cells/)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Ann', 'Bob'])
  })
})
