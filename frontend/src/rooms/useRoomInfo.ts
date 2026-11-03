import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pb } from '../lib/pb'
import { useSession } from '../session/SessionProvider'
import { RoomService } from './roomService'
import type { Player, Room } from './roomService'

export const ROOM_KEYS = ['room_name', 'player_token']
/** Session key holding why the player is no longer in a room ('removed' | 'ended'). */
export const NOTICE_KEY = 'room_notice'

/**
 * The room stored in the session, live: its record, players and the current player.
 * Also drops the player out of the session when the host removes them or ends the room.
 */
export function useRoomInfo(roomService?: RoomService) {
  const session = useSession()
  const service = useMemo(() => roomService ?? new RoomService(pb), [roomService])
  const roomName = (session.data.room_name as string | undefined) ?? null
  const token = (session.data.player_token as string | undefined) ?? null
  const [room, setRoom] = useState<Room | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const sessionRef = useRef(session)
  sessionRef.current = session
  const refreshRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    if (!session.ready || !roomName) {
      setRoom(null)
      setPlayers([])
      return
    }
    let cancelled = false
    let stop: (() => Promise<void>) | undefined
    const refresh = async () => {
      try {
        const [freshRoom, freshPlayers] = await Promise.all([
          service.getRoom(roomName),
          service.listPlayers(roomName),
        ])
        if (cancelled) return
        const gone = freshRoom?.phase === 'ended' ? 'ended'
          : token && !freshPlayers.some((p) => p.token === token) ? 'removed'
          : null
        if (gone) {
          cancelled = true
          await sessionRef.current.update({ [NOTICE_KEY]: gone })
          await sessionRef.current.remove(ROOM_KEYS)
          return
        }
        setRoom(freshRoom)
        setPlayers(freshPlayers)
      } catch {
        // Keep the last known state; the next event retries.
      }
    }
    refreshRef.current = refresh
    void refresh()
    service
      .subscribe(roomName, () => void refresh())
      .then((s) => {
        if (cancelled) void s()
        else stop = s
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (stop) void stop()
    }
  }, [session.ready, roomName, token, service])

  const me = (token && players.find((p) => p.token === token)) || null
  const isHost = !!me && !!room?.host && room.host === me.id

  /** Leave the stored room: the session is cleared first, then the player is removed server side. */
  const leave = useCallback(async () => {
    const s = sessionRef.current
    const name = s.data.room_name as string | undefined
    const tok = s.data.player_token as string | undefined
    await s.remove([...ROOM_KEYS, NOTICE_KEY])
    if (!name || !tok) return
    const [r, p] = await Promise.all([service.getRoom(name), service.getPlayer(name, tok)])
    if (r && p) await service.leaveRoom(r, p)
  }, [service])

  const endSession = useCallback(async () => {
    if (!room || !me) return
    await service.endRoom(room, me.id)
  }, [service, room, me])

  const refresh = useCallback(() => refreshRef.current(), [])

  return {
    roomName,
    room,
    players,
    playerCount: players.length,
    me,
    isHost,
    notice: (session.data[NOTICE_KEY] as 'removed' | 'ended' | undefined) ?? null,
    leave,
    endSession,
    refresh,
  }
}
