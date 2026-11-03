import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RoomService } from '../rooms/roomService'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { Layout } from './Layout'
import { useRoomInfo } from '../rooms/useRoomInfo'

function LobbyStub() {
  const { notice } = useRoomInfo()
  return <p>{`LOBBY ${notice ?? ''}`}</p>
}

function setup(path: string, solo = false) {
  const pb = new FakePocketBase()
  let data: Record<string, unknown> = {}
  if (!solo) {
    pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: 'lobby', dataset: '', pipeline: '', host: 'p1', pool: null }]
    pb.data.players = [
      { id: 'p1', room: 'blue-otter-42', name: 'Hannah', token: 't1', created: '1' },
      { id: 'p2', room: 'blue-otter-42', name: 'Hugo', token: 't2', created: '2' },
    ]
    data = { room_name: 'blue-otter-42', player_token: 't2' }
  }
  const sessions = new SessionService(pb as any, seedSession(pb, data))
  render(
    <SessionProvider service={sessions}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout roomService={new RoomService(pb as any)} />}>
            <Route path="/lobby" element={<LobbyStub />} />
            <Route path="/labeling" element={<p>LABELING PAGE</p>} />
            <Route path="/quality-folding" element={<p>QUALITY PAGE</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  )
  return pb
}

describe('Layout leaves the room', () => {
  it('sends a kicked player on /labeling to the lobby with the notice', async () => {
    const pb = setup('/labeling')
    await screen.findByText('LABELING PAGE')
    await act(async () => {
      await pb.collection('players').delete('p2')
    })
    expect(await screen.findByText('LOBBY removed')).toBeInTheDocument()
  })

  it('sends a player to the lobby when the room is ended', async () => {
    const pb = setup('/labeling')
    await screen.findByText('LABELING PAGE')
    await act(async () => {
      await pb.collection('rooms').update('r', { phase: 'ended' })
    })
    expect(await screen.findByText('LOBBY ended')).toBeInTheDocument()
  })

  it('Leave from the top bar goes to the lobby', async () => {
    setup('/quality-folding')
    await screen.findByText('QUALITY PAGE')
    fireEvent.click(await screen.findByRole('button', { name: 'Leave room' }))
    expect(await screen.findByText(/^LOBBY/)).toBeInTheDocument()
  })

  it('does not redirect a solo user', async () => {
    setup('/quality-folding', true)
    expect(await screen.findByText('QUALITY PAGE')).toBeInTheDocument()
  })
})
