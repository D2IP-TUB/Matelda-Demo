import type { Player } from '../rooms/roomService'
import { useT } from '../i18n'

const initial = (n: string) => (n.trim()[0] ?? '?').toUpperCase()

/** Shown to helpers until the host has published the shared pool. */
export function WaitingForLabeling({ players }: { players: Player[] }) {
  const tr = useT().shell
  return (
    <div className="wait-page">
      <div className="wait-aurora" aria-hidden="true" />
      <h1 className="wait-eyebrow">{tr.waitingTitle}</h1>
      {/* a little deck of cards, gently being shuffled while the host prepares them */}
      <div className="wait-deck" aria-hidden="true">
        <span className="wait-card wait-card-3" />
        <span className="wait-card wait-card-2" />
        <span className="wait-card wait-card-1">
          <span className="wait-line" />
          <span className="wait-line wait-line-short" />
        </span>
      </div>
      <p className="wait-headline">{tr.waitingHeadline}</p>
      <p className="wait-status" role="status">
        <span className="wait-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {tr.waitingNotice}
      </p>
      <p className="wait-hint">{tr.waitingHint}</p>
      {players.length > 0 && (
        <section className="wait-room">
          <h2>
            {tr.waitingPlayersHeading} <span className="wait-count">{players.length}</span>
          </h2>
          <ul className="wait-players" aria-label={tr.players}>
            {players.map((p) => (
              <li key={p.id} data-initial={initial(p.name)}>
                {p.name}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="wait-foot">{tr.waitingHostLeft}</p>
    </div>
  )
}
