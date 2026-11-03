import { useEffect, useMemo, useState } from 'react'
import { pb } from '../lib/pb'
import { useSession } from '../session/SessionProvider'
import { RoomService } from './roomService'

/** The room stored in the session and its live player count. */
export function useRoomInfo(roomService?: RoomService) {
  const session = useSession()
  const service = useMemo(() => roomService ?? new RoomService(pb), [roomService])
  const roomName = (session.data.room_name as string | undefined) ?? null
  const [playerCount, setPlayerCount] = useState(0)

  useEffect(() => {
    if (!session.ready || !roomName) {
      setPlayerCount(0)
      return
    }
    let cancelled = false
    let stop: (() => Promise<void>) | undefined
    const refresh = () =>
      service
        .listPlayers(roomName)
        .then((players) => {
          if (!cancelled) setPlayerCount(players.length)
        })
        .catch(() => {})
    void refresh()
    service
      .subscribe(roomName, refresh)
      .then((s) => {
        if (cancelled) void s()
        else stop = s
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (stop) void stop()
    }
  }, [session.ready, roomName, service])

  return { roomName, playerCount }
}
