import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { RoomService } from '../rooms/roomService'
import type { Player } from '../rooms/roomService'
import { pb } from '../lib/pb'
import { useRoomInfo } from '../rooms/useRoomInfo'
import { useT } from '../i18n'
// Language switch hidden for now.
// import { LanguageToggle } from './LanguageToggle'
import { ThemeToggle } from './ThemeToggle'

export function TopBar({ roomService }: { roomService?: RoomService }) {
  const tr = useT().topbar
  const service = useMemo(() => roomService ?? new RoomService(pb), [roomService])
  const { roomName, room, me, isHost, players, playerCount, leave, refresh } = useRoomInfo(service)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const box = useRef<HTMLSpanElement>(null)
  // Phones: the room controls and settings fold into a menu behind one button.
  const [menuOpen, setMenuOpen] = useState(false)
  const bar = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  useEffect(() => setMenuOpen(false), [pathname, roomName])
  useEffect(() => {
    if (!menuOpen) return
    const away = (e: MouseEvent) => {
      if (bar.current && !bar.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [menuOpen])
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const kick = async (target: Player) => {
    if (!room || !me) return
    setError('')
    try {
      await service.kickPlayer(room, me.id, target)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : tr.removeFailed)
    }
  }
  return (
    <header className={`topbar${menuOpen ? ' menu-open' : ''}`} ref={bar}>
      <Link className="brand" to="/">
        <span className="wordmark">Matelda</span>
        <img className="brand-logo" src="/bifold_logo.png" alt="BIFOLD" />
      </Link>
      <button
        type="button"
        className="menu-btn"
        aria-label={menuOpen ? tr.closeMenu : tr.menu}
        aria-expanded={menuOpen}
        aria-controls="topbar-menu"
        onClick={() => setMenuOpen((o) => !o)}
      >
        {roomName && <span className="menu-dot" aria-hidden="true" />}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {/* three bars that fold into an X (animated in CSS) */}
          <line className="bar bar-1" x1="4" y1="7" x2="20" y2="7" />
          <line className="bar bar-2" x1="4" y1="12" x2="20" y2="12" />
          <line className="bar bar-3" x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>
      <span className="topbar-end" id="topbar-menu">
      {roomName ? (
        <>
          <span className="room-players" ref={box}>
            <button
              type="button"
              className="room room-chip"
              aria-haspopup="true"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <span className="room-dot" aria-hidden="true" />
              {roomName} · {tr.players(playerCount)}
            </button>
            {open && (
              <div className="players-pop" role="dialog" aria-label={tr.playersInRoom}>
                <ul>
                  {players.map((p) => (
                    <li key={p.id}>
                      <span>
                        {p.name}
                        {p.id === room?.host ? tr.host : ''}
                        {p.id === me?.id ? tr.you : ''}
                      </span>
                      {isHost && p.id !== me?.id && (
                        <button type="button" className="btn btn-ghost btn-sm" aria-label={tr.kickPlayer(p.name)} onClick={() => void kick(p)}>
                          {tr.kick}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {error && <p className="players-error">{error}</p>}
              </div>
            )}
          </span>
          <button type="button" className="room-action" onClick={() => void leave()}>
            {tr.leaveRoom}
          </button>
        </>
      ) : (
        <Link className="room" to="/lobby">
          {tr.joinRoom}
        </Link>
      )}
      {/* Language switch hidden for now.
      <span className="menu-setting">
        <span className="menu-label" aria-hidden="true">{tr.language}</span>
        <LanguageToggle />
      </span>
      */}
      <span className="menu-setting">
        <span className="menu-label" aria-hidden="true">{tr.appearance}</span>
        <ThemeToggle />
      </span>
      </span>
    </header>
  )
}
