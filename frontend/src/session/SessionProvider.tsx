import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { pb } from '../lib/pb'
import { SessionService } from './sessionService'
import type { SessionData, StorageLike } from './sessionService'

interface SessionContextValue {
  ready: boolean
  sid: string
  data: SessionData
  update(patch: SessionData): Promise<void>
  clear(keep?: string[]): Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

function browserStorage(): StorageLike {
  try {
    return window.localStorage
  } catch {
    // Accessing localStorage itself can throw (blocked site data).
    return { getItem: () => null, setItem: () => {} }
  }
}

function defaultService(): SessionService {
  return new SessionService(pb, browserStorage())
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
    svc
      .load()
      .then(({ sid, data }) => setState({ ready: true, sid, data }))
      // PocketBase unreachable: run with an in-memory session instead of never becoming ready.
      .catch(() => setState({ ready: true, sid: '', data: {} }))
  }, [svc])

  const update = useCallback(
    async (patch: SessionData) => {
      setState((s) => ({ ...s, data: { ...s.data, ...patch } }))
      if (state.sid) await svc.save(state.sid, patch)
    },
    [svc, state.sid],
  )

  const clear = useCallback(
    async (keep?: string[]) => {
      const keepKeys = keep ?? ['room_name', 'player_token']
      setState((s) => ({
        ...s,
        data: Object.fromEntries(Object.entries(s.data).filter(([k]) => keepKeys.includes(k))),
      }))
      if (state.sid) await svc.clear(state.sid, keep)
    },
    [svc, state.sid],
  )

  const value = useMemo(
    () => ({ ready: state.ready, sid: state.sid, data: state.data, update, clear }),
    [state.ready, state.sid, state.data, update, clear],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
