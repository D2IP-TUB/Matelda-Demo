import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setLang } from '../i18n'
import { de } from '../i18n/de'
import { Layout } from './Layout'
import { RoomService } from '../rooms/roomService'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { PAGES, stepIndex } from '../routes'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { StepTracker } from './StepTracker'
import { TopBar } from './TopBar'

describe('routes', () => {
  it('lists the nine steps in order', () => {
    expect(PAGES.map((p) => p.title)).toEqual([
      'Lobby',
      'Configurations',
      'Domain Folding',
      'Quality Folding',
      'Labeling',
      'Labeling Stats',
      'Propagated Errors',
      'Error Detection',
      'Results',
    ])
  })

  it('finds the step index of a path', () => {
    expect(stepIndex('/configuration')).toBe(1)
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
    expect(container.querySelectorAll('.done')).toHaveLength(1)
    expect(screen.getByText('Step 2 of 9')).toBeInTheDocument()
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

  it('offers only Leave room, never End session', async () => {
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

  it('shows Leave room and no End session to the host either', async () => {
    const pb = new FakePocketBase()
    pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: 'lobby', dataset: '', host: 'p1' }]
    pb.data.players = [{ id: 'p1', room: 'blue-otter-42', name: 'A', token: 't1', created: '1' }]
    renderTopBar(pb, { room_name: 'blue-otter-42', player_token: 't1' })
    expect(await screen.findByRole('button', { name: 'Leave room' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull()
  })
})

describe('TopBar brand', () => {
  it('links the Matelda name to the landing page', async () => {
    renderTopBar(new FakePocketBase(), {})
    expect(await screen.findByRole('link', { name: /Matelda/ })).toHaveAttribute('href', '/')
  })
})

describe('German', () => {
  afterEach(() => act(() => setLang('en')))

  // The language switch is hidden for now.
  it.skip('TopBar shows the language toggle', async () => {
    renderTopBar(new FakePocketBase(), {})
    expect(await screen.findByRole('button', { name: 'Auf Deutsch umschalten' })).toBeInTheDocument()
  })

  it('switching to German translates the shell but not step names', async () => {
    act(() => setLang('de'))
    const pb = new FakePocketBase()
    pb.data.rooms = [{ id: 'r', name: 'blue-otter-42', phase: 'lobby', dataset: '' }]
    pb.data.players = [{ id: 'p1', room: 'blue-otter-42', name: 'A', token: 't1', created: '1' }]
    const sessions = new SessionService(pb as any, seedSession(pb, { room_name: 'blue-otter-42', player_token: 't1' }))
    render(
      <SessionProvider service={sessions}>
        <MemoryRouter>
          <TopBar roomService={new RoomService(pb as any)} />
          <StepTracker currentPath="/configuration" />
        </MemoryRouter>
      </SessionProvider>,
    )
    expect(await screen.findByRole('button', { name: de.topbar.leaveRoom })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${de.common.theme}: ${de.common.themeSystem}` })).toBeInTheDocument()
    expect(screen.getByText(de.shell.stepOf(2, 9))).toBeInTheDocument()
    for (const p of PAGES) expect(screen.getAllByText(p.title).length).toBeGreaterThan(0)
    expect(screen.getByText('Domain Folding', { selector: '.step-title' })).toBeInTheDocument()
  })

  // The language switch is hidden for now.
  it.skip('switching keeps page state', () => {
    const pb = new FakePocketBase()
    const sessions = new SessionService(pb as any, seedSession(pb, {}))
    render(
      <SessionProvider service={sessions}>
        <MemoryRouter initialEntries={['/x']}>
          <Routes>
            <Route element={<Layout roomService={new RoomService(pb as any)} />}>
              <Route path="/x" element={<input aria-label="field" />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </SessionProvider>,
    )
    const input = screen.getByLabelText('field') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Auf Deutsch umschalten' }))
    expect((screen.getByLabelText('field') as HTMLInputElement).value).toBe('abc')
  })
})
