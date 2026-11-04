import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../session/SessionProvider'
import { pb } from '../lib/pb'
import { RoomService } from '../rooms/roomService'
import { useRoomInfo } from '../rooms/useRoomInfo'
import { PAGES } from '../routes'
import { StepSlotContext } from './StepSlot'
import { StepTracker } from './StepTracker'
import { TopBar } from './TopBar'

/** Pipeline steps only the host runs; helpers label from the shared pool instead. */
const HOST_ONLY_PATHS = ['/intro', '/configuration', '/domain-folding', '/quality-folding']

/** The only steps a helper (a guest in someone else's room) may visit; they can switch freely between these. */
const GUEST_PATHS = ['/lobby', '/labeling', '/labeling-stats', '/results']
/**
 * Helpers have no navigation of their own: their screen follows the host, to the nearest step they may see.
 * While the host sets the pipeline up they wait on Labeling; while the host looks at propagation and detection
 * they stay on the labeling stats.
 */
const FOLLOW: Record<string, string> = {
  '/lobby': '/lobby',
  '/configuration': '/labeling',
  '/domain-folding': '/labeling',
  '/quality-folding': '/labeling',
  '/labeling': '/labeling',
  '/labeling-stats': '/labeling-stats',
  '/propagated-errors': '/labeling-stats',
  '/error-detection': '/labeling-stats',
  '/results': '/results',
}

/** Hero screens get the large-type showcase treatment; working screens stay compact. */
const SHOWCASE_PATHS = ['/lobby', '/results']

export function Layout({ roomService }: { roomService?: RoomService }) {
  const { pathname } = useLocation()
  const { roomName, room, me, isHost, settled } = useRoomInfo(roomService)
  const service = useMemo(() => roomService ?? new RoomService(pb), [roomService])
  const { ready } = useSession()
  const navigate = useNavigate()
  const [slot, setSlot] = useState<HTMLElement | null>(null) // the page's floating bar, if it has one
  // Kicked, ended or left: the stored room name goes from set to unset, so send the player to the lobby.
  const prevRoomName = useRef(roomName)
  useEffect(() => {
    if (prevRoomName.current && !roomName && pathname !== '/lobby') navigate('/lobby')
    prevRoomName.current = roomName
  }, [roomName, pathname, navigate])
  // Clicking Start moves everyone waiting in the lobby on to the first pipeline step. (Helpers land on
  // the waiting screen there.) Only the live lobby -> labeling change counts, not opening a started room.
  const phase = room?.phase
  const prevPhase = useRef(phase)
  useEffect(() => {
    // the host sets the pipeline up; a helper's next step is Labeling, which waits there for the cells
    if (prevPhase.current === 'lobby' && phase === 'labeling' && pathname === '/lobby') navigate(isHost ? '/configuration' : '/labeling')
    prevPhase.current = phase
  }, [phase, pathname, navigate, isHost])
  const isStep = HOST_ONLY_PATHS.includes(pathname) || PAGES.some((p) => p.path === pathname)
  // The host tells the room which step they are on, so the helpers can follow. Once per step: every write comes back
  // as a room update, so re-sending whenever the stored value differs would loop forever when the server does not
  // keep it (e.g. a PocketBase without the host_path field drops it) and flood everyone with events.
  const hostPath = room?.host_path
  const sentFor = useRef<string | null>(null)
  const roomRef = useRef(room)
  roomRef.current = room
  const roomId = room?.id
  useEffect(() => {
    const current = roomRef.current
    if (!isHost || !current || !PAGES.some((p) => p.path === pathname)) return
    const key = `${current.id}|${pathname}`
    if (sentFor.current === key || current.host_path === pathname) return
    sentFor.current = key
    service.setHostPath(current, pathname).catch(() => {}) // only a hint for the others: never block the host
  }, [isHost, roomId, pathname, service])
  const guestBlocked = isStep && !GUEST_PATHS.includes(pathname)
  const guest = !!roomName && settled && !!room && !!me && !isHost
  // a helper's screen goes wherever the host goes (each time the host changes step, not on every render)
  const follow = guest && room?.phase !== 'lobby' && hostPath ? FOLLOW[hostPath] : undefined
  const here = useRef(pathname)
  here.current = pathname
  useEffect(() => {
    if (follow && follow !== here.current) navigate(follow)
  }, [follow, navigate])

  let content = <Outlet />
  if (guestBlocked && !ready) content = <></>
  else if (guestBlocked && roomName) {
    if (!settled) content = <></> // first load in flight: neither flash the page nor redirect
    else if (!room || !me) content = <Outlet /> // unresolvable room: behave like solo
    else if (!isHost) {
      if (room.phase === 'lobby') content = <Navigate replace to="/lobby" />
      // the host's setup steps: a helper goes on to Labeling, which shows the waiting screen until the cells are out
      else if (HOST_ONLY_PATHS.includes(pathname)) content = <Navigate replace to="/labeling" />
      else content = <Navigate replace to="/labeling-stats" />
    }
  }
  return (
    <StepSlotContext.Provider value={setSlot}>
      <TopBar roomService={roomService} />
      {/* helpers have no step list; while the room loads we do not know yet, so none flashes up */}
      {guest || (!!roomName && !settled) ? null : slot ? (
        createPortal(<StepTracker currentPath={pathname} variant="bar" />, slot)
      ) : (
        <StepTracker currentPath={pathname} />
      )}
      <main className="page" data-tone={SHOWCASE_PATHS.includes(pathname) ? 'showcase' : undefined}>{content}</main>
    </StepSlotContext.Provider>
  )
}
