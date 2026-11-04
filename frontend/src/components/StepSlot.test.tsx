import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { Layout } from './Layout'
import { StepSlot } from './StepSlot'

function setup(withBar: boolean) {
  const pb = new FakePocketBase()
  const sessions = new SessionService(pb as any, seedSession(pb, {}))
  render(
    <SessionProvider service={sessions}>
      <MemoryRouter initialEntries={['/lobby']}>
        <Routes>
          <Route element={<Layout />}>
            <Route
              path="/lobby"
              element={withBar ? <div className="lobby-page"><div className="nav-row"><StepSlot /></div></div> : <p>no bar</p>}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  )
}

describe('step tracker placement', () => {
  it('sits inside the page\'s floating bar when it has one', async () => {
    setup(true)
    const nav = await screen.findByRole('navigation', { name: 'Progress' })
    expect(nav).toHaveClass('steps-bar')
    expect(nav.closest('.nav-row')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Lobby' })).toHaveAttribute('aria-current', 'step')
  })

  it('stays at the top of pages without a bar', async () => {
    setup(false)
    const nav = await screen.findByRole('navigation', { name: 'Progress' })
    expect(nav).not.toHaveClass('steps-bar')
  })
})
