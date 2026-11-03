import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { JoinQr } from '../components/JoinQr'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchDatasets } from '../lib/api'
import { pb } from '../lib/pb'
import { RoomService } from '../rooms/roomService'
import type { Player } from '../rooms/roomService'
import { NOTICE_KEY, useRoomInfo } from '../rooms/useRoomInfo'
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

  const [status, setStatus] = useState<'idle' | 'loading' | 'notfound' | 'ended' | 'ready'>('idle')
  const [message, setMessage] = useState('')
  const [joinInput, setJoinInput] = useState('')
  const entered = useRef<string | null>(null)
  const info = useRoomInfo(service)
  const { room, me, players, isHost } = info

  const datasets = useQuery({ queryKey: ['datasets'], queryFn: loadDatasets })

  // Enter (create the player in) the room named in the URL or stored in the session.
  useEffect(() => {
    if (!roomName) entered.current = null
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
        if (found.phase === 'ended') {
          setStatus('ended')
          return
        }
        const stored = session.data.room_name as string | undefined
        const token = stored === roomName ? (session.data.player_token as string) : undefined
        if (stored && stored !== roomName) await info.leave()
        const player = await service.joinRoom(roomName, token)
        await service.claimHost(found, player)
        await session.update({ room_name: roomName, player_token: player.token })
        await session.remove([NOTICE_KEY])
        setStatus('ready')
      } catch (e) {
        entered.current = null
        setStatus('idle')
        setMessage(e instanceof Error ? e.message : 'Could not join the room')
      }
    })()
  }, [session, roomName, service, info])

  // Left, kicked or the session ended: back to the create/join view.
  useEffect(() => {
    if (status === 'ready' && !info.roomName) {
      setStatus('idle')
      if (params.get('room')) setParams({})
    }
  }, [status, info.roomName, params, setParams])

  // Once the room has started, its dataset becomes the session's dataset.
  useEffect(() => {
    if (room?.phase === 'labeling' && room.dataset && session.data.dataset_select !== room.dataset) {
      void session.update({ dataset_select: room.dataset })
    }
  }, [room?.phase, room?.dataset, session])

  const create = async () => {
    try {
      const created = await service.createRoom()
      setParams({ room: created.name })
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not create a room')
    }
  }

  const vote = async (dataset: string) => {
    if (!me) return
    await service.setVote(me, dataset)
    await info.refresh()
  }

  const start = async () => {
    if (!room) return
    try {
      await service.startRoom(room)
      await info.refresh()
      setMessage('')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not start')
    }
  }

  const kick = async (target: Player) => {
    if (!room || !me) return
    try {
      await service.kickPlayer(room, me.id, target)
      await info.refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not remove the player')
    }
  }

  const counts = (dataset: string) => players.filter((p) => p.vote === dataset).length

  return (
    <main>
      <h1>Lobby</h1>
      {message && <p role="alert">{message}</p>}
      {status === 'notfound' && <p>Room not found</p>}
      {status === 'ended' && <p>This session has ended</p>}
      {status !== 'ready' && status !== 'loading' && info.notice && (
        <p className="room-notice" role="status">
          {info.notice === 'removed' ? 'You were removed by the host' : 'The host ended the session'}
        </p>
      )}
      {!(status === 'ready' && room) && (
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
          {room.phase === 'lobby' && (
            <JoinQr url={`${window.location.origin}/lobby?room=${room.name}`} />
          )}
          <button type="button" onClick={() => void info.leave()}>
            Leave room
          </button>
          <ul>
            {players.map((p) => (
              <li key={p.id} data-testid="player">
                {p.name}
                {p.id === me?.id ? ' (you)' : ''}
                {p.id === room.host ? ' (host)' : ''}
                {isHost && p.id !== me?.id && (
                  <button type="button" aria-label={`Kick ${p.name}`} onClick={() => void kick(p)}>
                    Kick
                  </button>
                )}
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
              {isHost || !room.host ? (
                <button onClick={start} disabled={!room.host || !players.some((p) => p.vote)}>
                  Start
                </button>
              ) : (
                <p>Waiting for the host to start</p>
              )}
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
