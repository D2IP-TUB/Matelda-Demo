import { Link } from 'react-router-dom'
import type { RoomService } from '../rooms/roomService'
import { useRoomInfo } from '../rooms/useRoomInfo'

export function TopBar({ roomService }: { roomService?: RoomService }) {
  const { roomName, playerCount } = useRoomInfo(roomService)
  return (
    <header className="topbar">
      <span className="brand">◆ Matelda</span>
      {roomName ? (
        <span className="room">
          Room {roomName} · {playerCount} {playerCount === 1 ? 'player' : 'players'}
        </span>
      ) : (
        <Link className="room" to="/lobby">
          Join a room
        </Link>
      )}
    </header>
  )
}
