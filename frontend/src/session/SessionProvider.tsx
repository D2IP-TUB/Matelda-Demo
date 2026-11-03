import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { pb } from '../lib/pb'
import { SessionService } from './sessionService'
import type { SessionData } from './sessionService'

interface SessionContextValue {
  ready: boolean
  data: SessionData
  update(patch: SessionData): Promise<void>
  clear(keep?: string[]): Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

function defaultService(): SessionService {
  return new SessionService(pb, window.localStorage)
}

export function SessionProvider({
  children,
  service,
}: {
  children: ReactNode
  service?: SessionService
}) {
  const svc = useMemo(() => service ?? defaultService(), [service])
  const [state, setState] = useState<{ ready: boolean; sid: string; data: SessionData }>({
    ready: false,
    sid: '',
    data: {},
  })
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    svc.load().then(({ sid, data }) => setState({ ready: true, sid, data }))
  }, [svc])

  const update = useCallback(
    async (patch: SessionData) => {
      setState((s) => ({ ...s, data: { ...s.data, ...patch } }))
      await svc.save(state.sid, patch)
    },
    [svc, state.sid],
  )

  const clear = useCallback(
    async (keep?: string[]) => {
      const data = await svc.clear(state.sid, keep)
      setState((s) => ({ ...s, data }))
    },
    [svc, state.sid],
  )

  const value = useMemo(
    () => ({ ready: state.ready, data: state.data, update, clear }),
    [state.ready, state.data, update, clear],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
