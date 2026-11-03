import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RoomService } from '../rooms/roomService'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { PAGES, stepIndex } from '../routes'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { StepTracker } from './StepTracker'
import { TopBar } from './TopBar'

describe('routes', () => {
  it('lists the nine steps in Streamlit sidebar order', () => {
    expect(PAGES.map((p) => p.title)).toEqual([
      'Lobby',
      'Intro',
      'Configurations',
      'Domain Folding',
      'Quality Folding',
      'Labeling',
      'Propagated Errors',
      'Error Detection',
      'Results',
    ])
  })

  it('finds the step index of a path', () => {
    expect(stepIndex('/configuration')).toBe(2)
    expect(stepIndex('/nope')).toBe(-1)
  })
})

describe('StepTracker', () => {
  it('marks the current step and the completed ones', () => {
    const { container } = render(
      <MemoryRouter>
        <StepTracker currentPath="/configuration" />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Progress' })
    expect(within(nav).getAllByRole('link')).toHaveLength(9)
    const current = container.querySelectorAll('[aria-current="step"]')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('Configurations')
    expect(container.querySelectorAll('.done')).toHaveLength(2)
    expect(screen.getByText('Step 3 of 9')).toBeInTheDocument()
  })
})

function renderTopBar(pb: FakePocketBase, data: Record<string, unknown>) {
  const sessions = new SessionService(pb as any, seedSession(pb, data))
  render(
    <SessionProvider service={sessions}>
      <MemoryRouter>
        <TopBar roomService={new RoomService(pb as any)} />
      </MemoryRouter>
    </SessionProvider>,
  )
}

describe('TopBar', () => {
  it('offers to join a room when there is none', async () => {
    renderTopBar(new FakePocketBase(), {})
    expect(await screen.findByRole('link', { name: 'Join a room' })).toBeInTheDocument()
  })

  it('shows the room and the live player count', async () => {
    const pb = new FakePocketBase()
    pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: 'lobby', dataset: '' }]
    pb.data.players = [
      { id: 'p1', room: 'blue-otter-42', name: 'A', token: 't1', created: '1' },
      { id: 'p2', room: 'blue-otter-42', name: 'B', token: 't2', created: '2' },
    ]
    renderTopBar(pb, { room_name: 'blue-otter-42' })
    expect(await screen.findByText(/blue-otter-42/)).toBeInTheDocument()
    expect(await screen.findByText(/2 players/)).toBeInTheDocument()
  })

  it('offers Leave room but not End session to a non-host', async () => {
    const pb = new FakePocketBase()
    pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: 'lobby', dataset: '', host: 'p1' }]
    pb.data.players = [
      { id: 'p1', room: 'blue-otter-42', name: 'A', token: 't1', created: '1' },
      { id: 'p2', room: 'blue-otter-42', name: 'B', token: 't2', created: '2' },
    ]
    renderTopBar(pb, { room_name: 'blue-otter-42', player_token: 't2' })
    expect(await screen.findByRole('button', { name: 'Leave room' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull()
  })

  it('offers End session to the host', async () => {
    const pb = new FakePocketBase()
    pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: 'lobby', dataset: '', host: 'p1' }]
    pb.data.players = [{ id: 'p1', room: 'blue-otter-42', name: 'A', token: 't1', created: '1' }]
    renderTopBar(pb, { room_name: 'blue-otter-42', player_token: 't1' })
    expect(await screen.findByRole('button', { name: 'End session' })).toBeInTheDocument()
  })
})
