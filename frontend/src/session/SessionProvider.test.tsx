import { render, screen } from '@testing-library/react'
import { SessionProvider, useSession } from './SessionProvider'
import { SessionService } from './sessionService'
import { FakePocketBase } from '../test/fakePocketBase'

function Probe() {
  const s = useSession()
  return <p>{s.ready ? 'ready' : 'loading'}</p>
}

describe('SessionProvider', () => {
  it('becomes ready when PocketBase is unreachable', async () => {
    const pb = new FakePocketBase()
    pb.collection('sessions').getFullList = async () => {
      throw new Error('network down')
    }
    const svc = new SessionService(pb as any, { getItem: () => 'x', setItem: () => {} })
    render(
      <SessionProvider service={svc}>
        <Probe />
      </SessionProvider>,
    )
    expect(await screen.findByText('ready')).toBeInTheDocument()
  })

  it('does not crash when reading window.localStorage throws', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    try {
      render(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      )
      expect(await screen.findByText('ready')).toBeInTheDocument()
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original)
    }
  })
})
