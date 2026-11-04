import '../styles/pages/lobby.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { JoinQr } from '../components/JoinQr'
import { Link, useSearchParams } from 'react-router-dom'
import { joinUrl } from '../lib/joinUrl'
import { pb } from '../lib/pb'
import { RoomService } from '../rooms/roomService'
import type { Player } from '../rooms/roomService'
import { NOTICE_KEY, resetSession, useRoomInfo } from '../rooms/useRoomInfo'
import { Button, Loading } from '../components/ui'
import { useSession } from '../session/SessionProvider'
import { StepSlot } from '../components/StepSlot'
import { t, useT } from '../i18n'

interface LobbyProps {
  roomService?: RoomService
}

export function Lobby({ roomService }: LobbyProps) {
  const service = useMemo(() => roomService ?? new RoomService(pb), [roomService])
  const session = useSession()
  const tr = useT()
  const l = tr.lobby
  const [params, setParams] = useSearchParams()
  const roomName = params.get('room') ?? (session.data.room_name as string | undefined)

  const [status, setStatus] = useState<'idle' | 'loading' | 'notfound' | 'ended' | 'ready'>('idle')
  const [message, setMessage] = useState('')
  const [creating, setCreating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [joinInput, setJoinInput] = useState('')
  const entered = useRef<string | null>(null)
  const info = useRoomInfo(service)
  const { room, me, players, isHost, leave: leaveOldRoom } = info

  // Enter (create the player in) the room named in the URL or stored in the session.
  useEffect(() => {
    if (!roomName) entered.current = null
    if (!session.ready || !roomName || entered.current === roomName) return
    entered.current = roomName
    const stored = session.data.room_name as string | undefined
    const token = stored === roomName ? (session.data.player_token as string | undefined) : undefined
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
        if (stored && stored !== roomName) await leaveOldRoom()
        if (token && !(await service.getPlayer(roomName, token))) {
          // Kicked while away: the stored token no longer has a player. Never re-admit.
          await resetSession(session, 'removed')
          setStatus('idle')
          if (params.get('room')) setParams({})
          return
        }
        const player = await service.joinRoom(roomName, token)
        await service.claimHost(found, player)
        await session.update({ room_name: roomName, player_token: player.token })
        await session.remove([NOTICE_KEY])
        setStatus('ready')
      } catch (e) {
        entered.current = null
        setStatus('idle')
        setMessage(e instanceof Error ? e.message : t().lobby.joinFailed)
      }
    })()
  }, [session, roomName, service, leaveOldRoom, params, setParams])

  // Left, kicked or the session ended: back to the create/join view.
  useEffect(() => {
    if (status === 'ready' && !info.roomName) {
      setStatus('idle')
      if (params.get('room')) setParams({})
    }
  }, [status, info.roomName, params, setParams])

  const create = async () => {
    setCreating(true)
    try {
      const created = await service.createRoom()
      setParams({ room: created.name })
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t().lobby.createFailed)
    } finally {
      setCreating(false)
    }
  }

  const start = async () => {
    if (!room) return
    setStarting(true)
    try {
      await service.startRoom(room)
      await info.refresh()
      setMessage('')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t().lobby.startFailed)
    } finally {
      setStarting(false)
    }
  }

  const kick = async (target: Player) => {
    if (!room || !me) return
    try {
      await service.kickPlayer(room, me.id, target)
      await info.refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t().topbar.removeFailed)
    }
  }

  const inRoom = status === 'ready' && room
  const joinLink = room ? joinUrl(room.name) : ''
  const initial = (n: string) => (n.trim()[0] ?? '?').toUpperCase()

  return (
    <div className="lobby-page">
      <div className="lobby-aurora" aria-hidden="true" />
      <h1 className="lobby-eyebrow">Lobby</h1>
      {!inRoom && (
        <header className="lobby-hero">
          <p className="lobby-headline">{l.headline}</p>
          <p className="lead">{l.lead}</p>
        </header>
      )}
      {message && <p role="alert" className="lobby-msg lobby-msg-bad">{message}</p>}
      {status === 'notfound' && <p className="lobby-msg lobby-msg-bad">{l.roomNotFound}</p>}
      {status === 'ended' && <p className="lobby-msg lobby-msg-bad">{l.sessionEnded}</p>}
      {status !== 'ready' && status !== 'loading' && info.notice && (
        <p className="room-notice lobby-msg" role="status">
          {info.notice === 'removed' ? l.removedByHost : l.hostEnded}
        </p>
      )}
      {status !== 'loading' && status !== 'ready' && (
        <section className="lobby-start lobby-tiles">
          <div className="lobby-tile lobby-tile-create">
            <span className="lobby-tile-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </span>
            <h2>{l.hostTitle}</h2>
            <p>{l.hostText}</p>
            <Button className="btn-lg" loading={creating} onClick={() => void create()}>
              {l.createRoom}
            </Button>
          </div>
          <form
            className="lobby-tile join-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (joinInput.trim()) setParams({ room: joinInput.trim().toLowerCase() })
            }}
          >
            <span className="lobby-tile-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
            <h2>{l.joinTitle}</h2>
            <p>{l.joinText}</p>
            <div className="lobby-join-row">
              <input
                aria-label={l.roomName}
                placeholder={l.roomName}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
              />
              <button type="submit" className="btn btn-ghost">{l.join}</button>
            </div>
          </form>
        </section>
      )}
      {status === 'loading' || (status === 'ready' && !room) ? <Loading className="lobby-loading">{l.joining}</Loading> : null}
      {inRoom && room && (
        <section className="lobby-room">
          <div className="lobby-code-card">
            <div className="lobby-code-main">
            <h2>{l.room} <span className="lobby-code">{room.name}</span></h2>
            <p className="lobby-sub">
              <span className="lobby-live" aria-hidden="true" />
              {l.playersInLobby(players.length)}
            </p>
            </div>
            {room.phase === 'lobby' && (
              <div className="lobby-qr">
                <JoinQr url={joinLink} />
                <p className="lobby-sub">{l.scanToJoin}</p>
              </div>
            )}
          </div>
          <ul className="players lobby-players">
            {players.map((p) => (
              <li key={p.id} data-testid="player">
                <span className={`lobby-avatar${p.id === room.host ? ' is-host' : ''}`} aria-hidden="true">{initial(p.name)}</span>
                <span className="lobby-pname">
                  {p.name}
                  {p.id === me?.id ? <span className="lobby-tag">{tr.topbar.you}</span> : null}
                  {p.id === room.host ? <span className="lobby-tag lobby-tag-host">{tr.topbar.host}</span> : null}
                </span>
                {isHost && p.id !== me?.id && (
                  <button type="button" className="btn btn-ghost btn-sm lobby-kick" aria-label={tr.topbar.kickPlayer(p.name)} title={tr.topbar.kickPlayer(p.name)} onClick={() => void kick(p)}>
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
                      <path d="M3.5 8h9" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* a helper in a started room has nothing to press here: their screen follows the host */}
      {!(inRoom && room && room.phase !== 'lobby' && room.host && !isHost) && (
      <div className="nav-row">
        <StepSlot />
        {inRoom && room && (
          <div className="row">
            {room.phase === 'lobby' ? (
              isHost || !room.host ? (
                <Button loading={starting} onClick={() => void start()} disabled={!room.host}>
                  {l.start}
                </Button>
              ) : (
                <Loading className="lobby-wait">{l.waitingForHost}</Loading>
              )
            ) : (
              <Link className="btn btn-primary" to="/configuration">{l.continue}</Link>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  )
}
