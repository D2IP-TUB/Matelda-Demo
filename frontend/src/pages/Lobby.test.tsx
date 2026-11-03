import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RoomService } from '../rooms/roomService'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { TopBar } from '../components/TopBar'
import { Lobby } from './Lobby'

function renderLobby(url = '/lobby', pb = new FakePocketBase(), seed?: Record<string, unknown>) {
  const storage = seed ? seedSession(pb, seed) : { getItem: () => null, setItem: () => {} }
  const roomService = new RoomService(pb as any)
  const sessions = new SessionService(pb as any, storage)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter initialEntries={[url]}>
          <TopBar roomService={roomService} />
          <Lobby roomService={roomService} loadDatasets={async () => ['beers', 'flights']} />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { pb, roomService }
}

describe('Lobby', () => {
  it('creates a room and lists the creator as a player', async () => {
    const { pb } = renderLobby()
    fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
    await waitFor(() => expect(pb.data.rooms).toHaveLength(1))
    await waitFor(() => expect(screen.getAllByTestId('player')).toHaveLength(1))
  })

  it('shows "Room not found" for an unknown ?room=', async () => {
    renderLobby('/lobby?room=ghost-room-00')
    expect(await screen.findByText('Room not found')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create room' })).toBeInTheDocument()
  })

  it('records a vote for the chosen dataset', async () => {
    const { pb } = renderLobby()
    fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
    fireEvent.click(await screen.findByLabelText('beers'))
    await waitFor(() => expect(pb.data.players[0].vote).toBe('beers'))
  })

  it('disables Start until someone voted, then shows the winner', async () => {
    renderLobby()
    fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
    const start = await screen.findByRole('button', { name: 'Start' })
    expect(start).toBeDisabled()
    fireEvent.click(await screen.findByLabelText('flights'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByText(/Dataset: flights/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /intro/i })).toBeInTheDocument()
  })

  it('stores the winning dataset in the session when the room starts', async () => {
    const { pb } = renderLobby()
    fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
    fireEvent.click(await screen.findByLabelText('flights'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(pb.data.sessions[0].data.dataset_select).toBe('flights'))
  })

  it('refreshes the player list when another player joins', async () => {
    const { roomService, pb } = renderLobby()
    fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
    await waitFor(() => expect(screen.getAllByTestId('player')).toHaveLength(1))
    await act(async () => {
      await roomService.joinRoom(pb.data.rooms[0].name)
    })
    await waitFor(() => expect(screen.getAllByTestId('player')).toHaveLength(2))
  })

  describe('rooms', () => {
    const addPlayer = (pb: FakePocketBase, room: string, id: string, token: string, name: string) =>
      pb.data.players.push({ id, room, name, token, created: id, budget: 10, vote: '' })

    it('makes the first joiner the host and marks them', async () => {
      const { pb } = renderLobby()
      fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
      await waitFor(() => expect(pb.data.rooms[0].host).toBe(pb.data.players[0].id))
      expect(await screen.findByText(/\(host\)/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Kick/ })).toBeNull()
    })

    it('shows the QR code with the join URL', async () => {
      renderLobby()
      fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
      const room = await screen.findByRole('heading', { name: /^Room / })
      const name = room.textContent!.replace('Room ', '')
      expect(await screen.findByText(`http://localhost:3000/lobby?room=${name}`)).toBeInTheDocument()
      expect(document.querySelector('svg')).not.toBeNull()
    })

    it('keeps Start disabled until a host is set and hides it from non-hosts', async () => {
      const pb = new FakePocketBase()
      pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: 'lobby', dataset: '', host: 'h' }]
      pb.data.players = []
      addPlayer(pb, 'blue-otter-42', 'h', 'th', 'Host')
      renderLobby('/lobby?room=blue-otter-42', pb)
      await waitFor(() => expect(screen.getAllByTestId('player')).toHaveLength(2))
      expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
      expect(screen.getByText(/Waiting for the host to start/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Kick/ })).toBeNull()
    })

    it('lets the host kick another player', async () => {
      const { pb, roomService } = renderLobby()
      fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
      await waitFor(() => expect(pb.data.rooms[0].host).toBeTruthy())
      await act(async () => {
        await roomService.joinRoom(pb.data.rooms[0].name)
      })
      await waitFor(() => expect(screen.getAllByTestId('player')).toHaveLength(2))
      const kicks = screen.getAllByRole('button', { name: /^Kick/ })
      expect(kicks).toHaveLength(1)
      fireEvent.click(kicks[0])
      await waitFor(() => expect(screen.getAllByTestId('player')).toHaveLength(1))
      expect(pb.data.players).toHaveLength(1)
    })

    it('leaves the room, clears the session room keys and shows create/join again', async () => {
      const { pb } = renderLobby()
      fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
      await waitFor(() => expect(pb.data.rooms[0].host).toBeTruthy())
      await waitFor(() => expect(pb.data.sessions[0].data.room_name).toBeTruthy())
      pb.data.sessions[0].data.labeling_results = { keep: 1 }
      fireEvent.click(screen.getAllByRole('button', { name: 'Leave room' })[0])
      expect(await screen.findByRole('button', { name: 'Create room' })).toBeInTheDocument()
      expect(screen.getByLabelText('Room name')).toBeInTheDocument()
      await waitFor(() => expect(pb.data.players).toHaveLength(0))
      expect(pb.data.sessions[0].data.room_name).toBeUndefined()
      expect(pb.data.sessions[0].data.player_token).toBeUndefined()
    })

    it('transfers the host marker when the host leaves', async () => {
      const { pb, roomService } = renderLobby()
      fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
      await waitFor(() => expect(pb.data.rooms[0].host).toBeTruthy())
      const second = await roomService.joinRoom(pb.data.rooms[0].name)
      fireEvent.click(screen.getAllByRole('button', { name: 'Leave room' })[0])
      await waitFor(() => expect(pb.data.rooms[0].host).toBe(second.id))
    })

    it('shows the removed message and clears the room when kicked, keeping labeling results', async () => {
      const pb = new FakePocketBase()
      pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: 'lobby', dataset: '', host: 'h' }]
      pb.data.players = []
      addPlayer(pb, 'blue-otter-42', 'h', 'th', 'Host')
      addPlayer(pb, 'blue-otter-42', 'm', 'tm', 'Me')
      renderLobby('/lobby', pb, {
        room_name: 'blue-otter-42', player_token: 'tm', labeling_results: { a: 1 },
      })
      await waitFor(() => expect(screen.getAllByTestId('player')).toHaveLength(2))
      await act(async () => {
        await pb.collection('players').delete('m')
      })
      expect(await screen.findByText('You were removed by the host')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create room' })).toBeInTheDocument()
      await waitFor(() => expect(pb.data.sessions[0].data.room_name).toBeUndefined())
      expect(pb.data.sessions[0].data.labeling_results).toEqual({ a: 1 })
    })

    it('shows "This session has ended" for an ended room link and adds no player', async () => {
      const pb = new FakePocketBase()
      pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: 'ended', dataset: 'beers', host: 'h' }]
      pb.data.players = []
      renderLobby('/lobby?room=blue-otter-42', pb)
      expect(await screen.findByText('This session has ended')).toBeInTheDocument()
      expect(pb.data.players).toHaveLength(0)
    })

    it('leaves the old room first when opening a link to another room', async () => {
      const pb = new FakePocketBase()
      pb.data.rooms = [
        { id: 'r1', name: 'old-room-11', phase: 'lobby', dataset: '', host: 'h' },
        { id: 'r2', name: 'new-room-22', phase: 'lobby', dataset: '', host: 'h2' },
      ]
      pb.data.players = []
      addPlayer(pb, 'old-room-11', 'h', 'th', 'Host')
      addPlayer(pb, 'old-room-11', 'm', 'tm', 'Me')
      addPlayer(pb, 'new-room-22', 'h2', 'th2', 'Host2')
      const leave = vi.spyOn(RoomService.prototype, 'leaveRoom')
      renderLobby('/lobby?room=new-room-22', pb, { room_name: 'old-room-11', player_token: 'tm' })
      await waitFor(() => expect(leave).toHaveBeenCalled())
      expect(leave.mock.calls[0][0].name).toBe('old-room-11')
      await waitFor(() => expect(pb.data.sessions[0].data.room_name).toBe('new-room-22'))
      expect(pb.data.players.filter((p) => p.room === 'old-room-11')).toHaveLength(1)
      leave.mockRestore()
    })
  })

  describe('TopBar room actions', () => {
    it('lets the host end the session after confirming; everyone is dropped with a notice', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const { pb } = renderLobby()
      fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
      await waitFor(() => expect(pb.data.rooms[0].host).toBeTruthy())
      fireEvent.click(await screen.findByRole('button', { name: 'End session' }))
      expect(confirm).toHaveBeenCalled()
      await waitFor(() => expect(pb.data.rooms[0].phase).toBe('ended'))
      expect(await screen.findByText('The host ended the session')).toBeInTheDocument()
      await waitFor(() => expect(pb.data.sessions[0].data.room_name).toBeUndefined())
      confirm.mockRestore()
    })

    it('does nothing when the confirmation is cancelled', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const { pb } = renderLobby()
      fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
      await waitFor(() => expect(pb.data.rooms[0].host).toBeTruthy())
      fireEvent.click(await screen.findByRole('button', { name: 'End session' }))
      expect(pb.data.rooms[0].phase).toBe('lobby')
      confirm.mockRestore()
    })

    it('hides End session from non-hosts', async () => {
      const pb = new FakePocketBase()
      pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: 'lobby', dataset: '', host: 'h' }]
      pb.data.players = [{ id: 'h', room: 'blue-otter-42', name: 'H', token: 'th', created: '1' }]
      renderLobby('/lobby?room=blue-otter-42', pb)
      await waitFor(() => expect(screen.getAllByTestId('player')).toHaveLength(2))
      expect(screen.queryByRole('button', { name: 'End session' })).toBeNull()
      expect(screen.getAllByRole('button', { name: 'Leave room' }).length).toBeGreaterThan(0)
    })

    it('Leave mid-labeling keeps shared labels and frees unlabeled claims', async () => {
      const { pb } = renderLobby()
      fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
      await waitFor(() => expect(pb.data.rooms[0].host).toBeTruthy())
      const room = pb.data.rooms[0].name
      const me = pb.data.players[0].id
      pb.data.labels = [{ id: 'l1', room, cell_id: 'a', player: me, value: true }]
      pb.data.claims = [
        { id: 'c1', room, cell_id: 'a', player: me },
        { id: 'c2', room, cell_id: 'b', player: me },
      ]
      fireEvent.click(screen.getAllByRole('button', { name: 'Leave room' })[0])
      await waitFor(() => expect(pb.data.claims.map((c) => c.cell_id)).toEqual(['a']))
      expect(pb.data.labels).toHaveLength(1)
    })
  })

  describe('stale token (kicked while offline)', () => {
    const setup = (delayMs: number) => {
      const pb = new FakePocketBase()
      pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: 'lobby', dataset: '', host: 'h' }]
      pb.data.players = [{ id: 'h', room: 'blue-otter-42', name: 'Host', token: 'th', created: '1' }]
      if (delayMs) {
        const col = pb.collection('players')
        const orig = col.getFullList.bind(col)
        col.getFullList = async (o) => {
          await new Promise((r) => setTimeout(r, delayMs))
          return orig(o)
        }
      }
      return pb
    }

    it.each([0, 40])('Lobby does not re-admit a removed player (delay %i ms)', async (delay) => {
      const pb = setup(delay)
      renderLobby('/lobby?room=blue-otter-42', pb, {
        room_name: 'blue-otter-42', player_token: 'gone', labeling_results: { a: 1 },
      })
      expect(await screen.findByText('You were removed by the host')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create room' })).toBeInTheDocument()
      await waitFor(() => expect(pb.data.sessions[0].data.room_name).toBeUndefined())
      await new Promise((r) => setTimeout(r, 100))
      expect(pb.data.players).toHaveLength(1)
      expect(pb.data.sessions[0].data.player_token).toBeUndefined()
      expect(pb.data.sessions[0].data.labeling_results).toEqual({ a: 1 })
    })

    it('TopBar alone clears the keys and creates no player', async () => {
      const pb = setup(0)
      const sessions = new SessionService(pb as any, seedSession(pb, { room_name: 'blue-otter-42', player_token: 'gone' }))
      render(
        <SessionProvider service={sessions}>
          <MemoryRouter>
            <TopBar roomService={new RoomService(pb as any)} />
          </MemoryRouter>
        </SessionProvider>,
      )
      await waitFor(() => expect(pb.data.sessions[0].data.room_name).toBeUndefined())
      expect(pb.data.sessions[0].data.room_notice).toBe('removed')
      expect(pb.data.players).toHaveLength(1)
    })

    it('a valid token reload keeps the same player', async () => {
      const pb = setup(0)
      pb.data.players.push({ id: 'm', room: 'blue-otter-42', name: 'Me', token: 'tm', created: '2' })
      renderLobby('/lobby', pb, { room_name: 'blue-otter-42', player_token: 'tm' })
      await waitFor(() => expect(screen.getAllByTestId('player')).toHaveLength(2))
      expect(pb.data.players).toHaveLength(2)
      expect(pb.data.sessions[0].data.player_token).toBe('tm')
    })
  })
})
