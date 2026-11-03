import type { Player } from '../rooms/roomService'
import { Notice } from './ui'

/** Shown to helpers until the host has published the shared pool. */
export function WaitingForLabeling({ players }: { players: Player[] }) {
  return (
    <>
      <h1>Labeling</h1>
      <Notice kind="info">Waiting for labeling — the host is preparing the cells</Notice>
      <p>If the host has left, leave this room and create a new one.</p>
      <ul aria-label="Players">
        {players.map((p) => (
          <li key={p.id}>{p.name}</li>
        ))}
      </ul>
    </>
  )
}
