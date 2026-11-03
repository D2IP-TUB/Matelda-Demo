import { useEffect, useRef } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../session/SessionProvider'
import type { RoomService } from '../rooms/roomService'
import { useRoomInfo } from '../rooms/useRoomInfo'
import { StepTracker } from './StepTracker'
import { TopBar } from './TopBar'
import { WaitingForLabeling } from './WaitingForLabeling'

/** Pipeline steps only the host runs; helpers label from the shared pool instead. */
const HOST_ONLY_PATHS = ['/intro', '/configuration', '/domain-folding', '/quality-folding']

export function Layout({ roomService }: { roomService?: RoomService }) {
  const { pathname } = useLocation()
  const { roomName, room, me, isHost, players, settled } = useRoomInfo(roomService)
  const { ready } = useSession()
  const navigate = useNavigate()
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
    if (prevPhase.current === 'lobby' && phase === 'labeling' && pathname === '/lobby') navigate('/configuration')
    prevPhase.current = phase
  }, [phase, pathname, navigate])
  const hostOnly = HOST_ONLY_PATHS.includes(pathname)

  let content = <Outlet />
  if (hostOnly && !ready) content = <></>
  else if (hostOnly && roomName) {
    if (!settled) content = <></> // first load in flight: neither flash the page nor redirect
    else if (!room || !me) content = <Outlet /> // unresolvable room: behave like solo
    else if (!isHost && room.phase !== 'lobby') {
      content = room.pool && room.pool.length > 0
        ? <Navigate replace to="/labeling" />
        : <WaitingForLabeling players={players} />
    }
  }
  return (
    <>
      <TopBar roomService={roomService} />
      <StepTracker currentPath={pathname} />
      <main className="page">{content}</main>
    </>
  )
}
