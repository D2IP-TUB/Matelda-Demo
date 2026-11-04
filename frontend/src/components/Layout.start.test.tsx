import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RoomService } from '../rooms/roomService'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { Layout } from './Layout'

function setup(opts: { token?: string; phase?: string; path?: string } = {}) {
  const { token = 't1', phase = 'lobby', path = '/lobby' } = opts
  const pb = new FakePocketBase()
  pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase, dataset: '', pipeline: '', host: 'p1', pool: null }]
  pb.data.players = [
    { id: 'p1', room: 'blue-otter-42', name: 'Hannah', token: 't1', created: '1' },
    { id: 'p2', room: 'blue-otter-42', name: 'Hugo', token: 't2', created: '2' },
  ]
  const sessions = new SessionService(pb as any, seedSession(pb, { room_name: 'blue-otter-42', player_token: token }))
  render(
    <SessionProvider service={sessions}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout roomService={new RoomService(pb as any)} />}>
            <Route path="/lobby" element={<p>LOBBY PAGE</p>} />
            <Route path="/configuration" element={<p>CONFIG PAGE</p>} />
            <Route path="/labeling" element={<p>LABELING PAGE</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  )
  return pb
}

// Wait until the room has loaded (the top bar then shows its players), as it has by the time anyone clicks Start.
const start = async (pb: FakePocketBase) => {
  await screen.findByText(/2 players/)
  await act(async () => {
    await pb.collection('rooms').update('r', { phase: 'labeling' })
  })
}

describe('Layout moves the room on when the host starts', () => {
  it('sends the host from the lobby straight to the configuration', async () => {
    const pb = setup()
    await screen.findByText('LOBBY PAGE')
    await start(pb)
    expect(await screen.findByText('CONFIG PAGE')).toBeInTheDocument()
  })

  it('sends a helper from the lobby to their next step, Labeling, where they wait for the cells', async () => {
    const pb = setup({ token: 't2' })
    await screen.findByText('LOBBY PAGE')
    await start(pb)
    expect(await screen.findByText('LABELING PAGE')).toBeInTheDocument()
    expect(screen.queryByText('CONFIG PAGE')).toBeNull()
  })

  it('does not redirect someone who opens an already started room', async () => {
    setup({ phase: 'labeling' })
    expect(await screen.findByText('LOBBY PAGE')).toBeInTheDocument()
  })

  it('does not pull a player away from another page when the room starts', async () => {
    const pb = setup({ path: '/labeling' })
    await screen.findByText('LABELING PAGE')
    await start(pb)
    expect(screen.getByText('LABELING PAGE')).toBeInTheDocument()
  })
})
