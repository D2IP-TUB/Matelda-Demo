import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchDatasets } from '../lib/api'
import { pb } from '../lib/pb'
import { RoomService } from '../rooms/roomService'
import type { Player, Room } from '../rooms/roomService'
import { useSession } from '../session/SessionProvider'

interface LobbyProps {
  roomService?: RoomService
  loadDatasets?: () => Promise<string[]>
}

export function Lobby({ roomService, loadDatasets = fetchDatasets }: LobbyProps) {
  const service = useMemo(() => roomService ?? new RoomService(pb), [roomService])
  const session = useSession()
  const [params, setParams] = useSearchParams()
  const roomName = params.get('room') ?? (session.data.room_name as string | undefined)

  const [status, setStatus] = useState<'idle' | 'loading' | 'notfound' | 'ready'>('idle')
  const [room, setRoom] = useState<Room | null>(null)
  const [me, setMe] = useState<Player | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [message, setMessage] = useState('')
  const [joinInput, setJoinInput] = useState('')
  const entered = useRef<string | null>(null)

  const datasets = useQuery({ queryKey: ['datasets'], queryFn: loadDatasets })

  const refresh = useCallback(
    async (name: string) => {
      const [freshRoom, freshPlayers] = await Promise.all([
        service.getRoom(name),
        service.listPlayers(name),
      ])
      if (freshRoom) setRoom(freshRoom)
      setPlayers(freshPlayers)
    },
    [service],
  )

  // Enter (create the player in) the room named in the URL or stored in the session.
  useEffect(() => {
    if (!session.ready || !roomName || entered.current === roomName) return
    entered.current = roomName
    setStatus('loading')
    setMessage('')
    ;(async () => {
      try {
        const found = await service.getRoom(roomName)
        if (!found) {
          setStatus('notfound')
          return
        }
        const token =
          session.data.room_name === roomName ? (session.data.player_token as string) : undefined
        const player = await service.joinRoom(roomName, token)
        await session.update({ room_name: roomName, player_token: player.token })
        setRoom(found)
        setMe(player)
        setPlayers(await service.listPlayers(roomName))
        setStatus('ready')
      } catch (e) {
        entered.current = null
        setStatus('idle')
        setMessage(e instanceof Error ? e.message : 'Could not join the room')
      }
    })()
  }, [session, roomName, service])

  // Live updates while in a room.
  useEffect(() => {
    if (status !== 'ready' || !room) return
    const name = room.name
    let stop: (() => Promise<void>) | undefined
    let cancelled = false
    service.subscribe(name, () => void refresh(name)).then((s) => {
      if (cancelled) void s()
      else stop = s
    })
    return () => {
      cancelled = true
      if (stop) void stop()
    }
  }, [status, room?.name, service, refresh])

  const create = async () => {
    try {
      const created = await service.createRoom()
      setParams({ room: created.name })
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not create a room')
    }
  }

  const vote = async (dataset: string) => {
    if (!me || !room) return
    await service.setVote(me, dataset)
    setMe({ ...me, vote: dataset })
    await refresh(room.name)
  }

  const start = async () => {
    if (!room) return
    try {
      setRoom(await service.startRoom(room))
      setMessage('')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not start')
    }
  }

  const counts = (dataset: string) => players.filter((p) => p.vote === dataset).length

  return (
    <main>
      <h1>Lobby</h1>
      {message && <p role="alert">{message}</p>}
      {status === 'notfound' && <p>Room not found</p>}
      {status !== 'ready' && (
        <section>
          <button onClick={create}>Create room</button>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (joinInput.trim()) setParams({ room: joinInput.trim().toLowerCase() })
            }}
          >
            <input
              aria-label="Room name"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
            />
            <button type="submit">Join</button>
          </form>
        </section>
      )}
      {status === 'ready' && room && (
        <section>
          <h2>Room {room.name}</h2>
          <ul>
            {players.map((p) => (
              <li key={p.id} data-testid="player">
                {p.name}
                {p.id === me?.id ? ' (you)' : ''}
              </li>
            ))}
          </ul>
          {room.phase === 'lobby' ? (
            <>
              <h3>Pick a dataset</h3>
              {datasets.isError && <p>Could not load datasets</p>}
              {(datasets.data ?? []).map((d) => (
                <div key={d}>
                  <input
                    type="radio"
                    id={`ds-${d}`}
                    name="dataset"
                    checked={me?.vote === d}
                    onChange={() => void vote(d)}
                  />
                  <label htmlFor={`ds-${d}`}>{d}</label> <span>({counts(d)})</span>
                </div>
              ))}
              <button onClick={start} disabled={!players.some((p) => p.vote)}>
                Start
              </button>
            </>
          ) : (
            <>
              <p>Dataset: {room.dataset}</p>
              <Link to="/intro">Next → Intro</Link>
            </>
          )}
        </section>
      )}
    </main>
  )
}
