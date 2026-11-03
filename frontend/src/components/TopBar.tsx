import { Link } from 'react-router-dom'
import type { RoomService } from '../rooms/roomService'
import { useRoomInfo } from '../rooms/useRoomInfo'

export function TopBar({ roomService }: { roomService?: RoomService }) {
  const { roomName, playerCount, isHost, leave, endSession } = useRoomInfo(roomService)
  const end = () => {
    if (window.confirm('End the session for everyone in the room?')) void endSession()
  }
  return (
    <header className="topbar">
      <span className="brand">◆ Matelda</span>
      {roomName ? (
        <>
          <span className="room">
            Room {roomName} · {playerCount} {playerCount === 1 ? 'player' : 'players'}
          </span>
          <button type="button" className="room-action" onClick={() => void leave()}>
            Leave room
          </button>
          {isHost && (
            <button type="button" className="room-action danger" onClick={end}>
              End session
            </button>
          )}
        </>
      ) : (
        <Link className="room" to="/lobby">
          Join a room
        </Link>
      )}
    </header>
  )
}
