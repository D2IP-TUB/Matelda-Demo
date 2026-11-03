import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RoomService } from '../rooms/roomService'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { Lobby } from './Lobby'

function renderLobby(url = '/lobby', pb = new FakePocketBase()) {
  const storage = { getItem: () => null, setItem: () => {} }
  const roomService = new RoomService(pb as any)
  const sessions = new SessionService(pb as any, storage)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter initialEntries={[url]}>
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

  it('refreshes the player list when another player joins', async () => {
    const { roomService, pb } = renderLobby()
    fireEvent.click(await screen.findByRole('button', { name: 'Create room' }))
    await waitFor(() => expect(screen.getAllByTestId('player')).toHaveLength(1))
    await act(async () => {
      await roomService.joinRoom(pb.data.rooms[0].name)
    })
    await waitFor(() => expect(screen.getAllByTestId('player')).toHaveLength(2))
  })
})
