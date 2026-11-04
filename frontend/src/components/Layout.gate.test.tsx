import { act, render, screen, waitFor } from '@testing-library/react'
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

function setup(
  path: string,
  role: 'helper' | 'host' | 'solo',
  opts: { phase?: string; pool?: string[]; data?: Record<string, unknown>; room?: Record<string, unknown> } = {},
) {
  const pb = new FakePocketBase()
  let data: Record<string, unknown> = {}
  if (role !== 'solo') {
    pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: opts.phase ?? 'started', dataset: '', pipeline: '', host: 'p1', pool: opts.pool ?? null, ...opts.room }]
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
            <Route path="/labeling-stats" element={<p>STATS PAGE</p>} />
            <Route path="/propagated-errors" element={<Page name="propagated" />} />
            <Route path="/error-detection" element={<Page name="detection" />} />
            <Route path="/results" element={<Page name="results" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  )
  return pb
}

beforeEach(() => mounted.mockClear())

describe('Layout helper gate', () => {
  it.each(['/propagated-errors', '/error-detection'])(
    'sends a helper on %s back to the labeling stats: their journey ends there',
    async (path) => {
      setup(path, 'helper', { phase: 'labeling', pool: ['a'] })
      expect(await screen.findByText('STATS PAGE')).toBeInTheDocument()
      expect(mounted).not.toHaveBeenCalled()
    },
  )

  it('lets a helper open the results, with no step list of their own', async () => {
    setup('/results', 'helper', { phase: 'labeling', pool: ['a'] })
    expect(await screen.findByRole('button', { name: 'Run results' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('navigation', { name: /progress/i })).toBeNull())
  })

  it.each([
    ['/configuration', 'LABELING PAGE'],
    ['/labeling', 'LABELING PAGE'],
    ['/labeling-stats', 'STATS PAGE'],
    ['/error-detection', 'STATS PAGE'],
    ['/results', 'Run results'],
  ])('moves a helper along when the host opens %s', async (hostPath, shown) => {
    const pb = setup('/labeling', 'helper', { phase: 'labeling', pool: ['a'] })
    await screen.findByText('LABELING PAGE')
    await act(async () => {
      await pb.collection('rooms').update('r', { host_path: hostPath })
    })
    expect(await screen.findByText(shown)).toBeInTheDocument()
  })

  it('takes a helper who opens the room to where the host is', async () => {
    setup('/lobby', 'helper', { phase: 'labeling', pool: ['a'], room: { host_path: '/labeling-stats' } })
    expect(await screen.findByText('STATS PAGE')).toBeInTheDocument()
  })

  it('leaves a helper in the lobby while the room has not started, wherever the host is', async () => {
    setup('/lobby', 'helper', { phase: 'lobby', room: { host_path: '/configuration' } })
    expect(await screen.findByRole('button', { name: 'Run lobby' })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByRole('button', { name: 'Run lobby' })).toBeInTheDocument()
  })

  it('tells the room which step the host is on', async () => {
    const pb = setup('/results', 'host', { phase: 'labeling', pool: ['a'] })
    await waitFor(() => expect(pb.data.rooms[0].host_path).toBe('/results'))
  })

  it('tells the room once per step, even when the server does not keep the value (no update loop)', async () => {
    const pb = new FakePocketBase()
    const rooms = pb.collection('rooms')
    const update = rooms.update.bind(rooms)
    let writes = 0
    // a PocketBase without the host_path field drops it, so the room never comes back with it
    rooms.update = async (id: string, body: Record<string, unknown>) => {
      if ('host_path' in body) writes++
      const { host_path: _dropped, ...rest } = body
      return update(id, rest)
    }
    pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: 'labeling', dataset: '', pipeline: '', host: 'p1', pool: ['a'] }]
    pb.data.players = [{ id: 'p1', room: 'blue-otter-42', name: 'Hannah', token: 't1', created: '1' }]
    const sessions = new SessionService(pb as any, seedSession(pb, { room_name: 'blue-otter-42', player_token: 't1' }))
    render(
      <SessionProvider service={sessions}>
        <MemoryRouter initialEntries={['/results']}>
          <Routes>
            <Route element={<Layout roomService={new RoomService(pb as any)} />}>
              <Route path="/results" element={<Page name="results" />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </SessionProvider>,
    )
    await screen.findByRole('button', { name: 'Run results' })
    await new Promise((r) => setTimeout(r, 200))
    expect(writes).toBe(1)
  })

  it('keeps the step list for the host, and does not move them', async () => {
    const pb = setup('/results', 'host', { phase: 'labeling', pool: ['a'] })
    await waitFor(() => expect(pb.data.rooms[0].host_path).toBe('/results'))
    expect(screen.getByRole('navigation', { name: /progress/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run results' })).toBeInTheDocument()
  })

  it('lets the host go on past the labeling stats', async () => {
    setup('/results', 'host', { phase: 'labeling', pool: ['a'] })
    expect(await screen.findByRole('button', { name: 'Run results' })).toBeInTheDocument()
  })

  // their next step is Labeling, which waits there for the host's cells (with the step bar, so they can find their way)
  it.each(['/configuration', '/quality-folding'])('sends a helper on %s on to Labeling, even before the pool is out', async (path) => {
    setup(path, 'helper')
    expect(await screen.findByText('LABELING PAGE')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Run/ })).not.toBeInTheDocument()
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

  it('keeps a helper in the lobby while the room has not started', async () => {
    setup('/configuration', 'helper', { phase: 'lobby' })
    expect(await screen.findByRole('button', { name: 'Run lobby' })).toBeInTheDocument()
    expect(mounted).not.toHaveBeenCalledWith('configuration')
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

  it('sends a removed player to the lobby', async () => {
    const pb = setup('/configuration', 'helper', { phase: 'started' })
    await screen.findByText('LABELING PAGE')
    await act(async () => {
      await pb.collection('players').delete('p2')
    })
    expect(await screen.findByRole('button', { name: 'Run lobby' })).toBeInTheDocument()
    expect((pb.data.sessions[0].data as any).room_name).toBeUndefined()
  })

  it('sends the player to the lobby when the room ended', async () => {
    const pb = setup('/configuration', 'helper')
    await screen.findByText('LABELING PAGE')
    await act(async () => {
      await pb.collection('rooms').update('r', { phase: 'ended' })
    })
    expect(await screen.findByRole('button', { name: 'Run lobby' })).toBeInTheDocument()
    expect((pb.data.sessions[0].data as any).room_name).toBeUndefined()
  })
})

describe('Layout gate extras', () => {
  it('gates /domain-folding', async () => {
    setup('/domain-folding', 'helper')
    expect(await screen.findByText('LABELING PAGE')).toBeInTheDocument()
    expect(mounted).not.toHaveBeenCalled()
  })

  it('sends a helper on /domain-folding to labeling once the pool is published', async () => {
    setup('/domain-folding', 'helper', { pool: ['a'] })
    expect(await screen.findByText('LABELING PAGE')).toBeInTheDocument()
    expect(mounted).not.toHaveBeenCalledWith('domain')
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
    expect(screen.getByText('If the host has left, leave this room and create a new one.')).toBeInTheDocument()
    expect(screen.getAllByRole('list', { name: 'Players' })[0].querySelectorAll('li')).toHaveLength(2)
  })

  it('has no buttons: the helper moves on with the host', () => {
    render(<WaitingForLabeling players={[]} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
