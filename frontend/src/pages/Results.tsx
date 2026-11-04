import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import '../styles/pages/results.css'
import { DataTable } from '../components/DataTable'
import { Stat } from '../components/stats'
import { Card, EmptyState, InfoButton, Loading, Notice, Prereq } from '../components/ui'
import { StepSlot } from '../components/StepSlot'
import { t, useT } from '../i18n'
import { fetchResults } from '../lib/api'
import { pb } from '../lib/pb'
import { RoomService } from '../rooms/roomService'
import { useSession } from '../session/SessionProvider'

const fmt = (v: number | null | undefined, digits = 2) => (typeof v === 'number' ? v.toFixed(digits) : '')

const pct = (v: number | null | undefined) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : 'n/a')

function Bar({ name, value, tone }: { name: string; value: number | null | undefined; tone: 'matelda' | 'raha' }) {
  const w = Math.max(0, Math.min(1, value ?? 0)) * 100
  return (
    <div className="bar-row">
      <span className="bar-name">{name}</span>
      <div className="bar-track" aria-hidden="true">
        <div className={`bar-fill ${tone}`} style={{ width: `${w}%` }} />
      </div>
      <b className="bar-val">{`${pct(value)} F1`}</b>
    </div>
  )
}

export function Results({ roomService }: { roomService?: RoomService }) {
  const r = useT().results
  const session = useSession()
  const service = useMemo(() => roomService ?? new RoomService(pb), [roomService])
  const roomName = session.data.room_name as string | undefined
  const token = session.data.player_token as string | undefined

  const roomCtx = useQuery({
    queryKey: ['room-context', roomName, token],
    enabled: session.ready && !!roomName && !!token,
    queryFn: async () => {
      const room = await service.getRoom(roomName as string)
      const player = room ? await service.getPlayer(roomName as string, token as string) : null
      return room && player ? { room, player } : null
    },
  })
  const inRoom = roomCtx.data ?? null
  // A helper (not the host) looks at the host's run, read-only: the room's pipeline, not their own session's.
  const guest = !!inRoom?.room.host && inRoom.player.id !== inRoom.room.host
  const pipeline = guest ? inRoom.room.pipeline || undefined : (session.data.pipeline_path as string | undefined)

  const results = useQuery({
    queryKey: ['results', pipeline],
    queryFn: () => fetchResults(pipeline as string),
    enabled: !!pipeline && !roomCtx.isLoading,
    refetchInterval: guest ? 5000 : false, // the host may still be running error detection
  })
  const data = results.data
  const metrics = data?.metrics ?? null

  // Share the fresh result with the room (once per result) for the live dashboard.
  const sharedFor = useRef<string | null>(null)
  const [runNote, setRunNote] = useState('')
  useEffect(() => {
    if (!inRoom || guest || !metrics || !data) return // only the host's own run is shared
    const time = metrics.time as string
    if (session.data.run_saved_for === time || sharedFor.current === time) return
    sharedFor.current = time
    void session.update({ run_saved_for: time })
    service
      .saveRun(inRoom.room, inRoom.player, data.labeling_budget ?? 0, metrics.precision ?? 0, metrics.recall ?? 0, metrics.f1 ?? 0)
      .catch((e) => setRunNote(t().results.shareFailed(e instanceof Error ? e.message : String(e))))
  }, [inRoom, guest, metrics, data, session, service])

  if (!session.ready || roomCtx.isLoading) return <h1>Results</h1>
  if (!pipeline && !guest) {
    return (
      <>
        <h1>Results</h1>
        <Prereq title={r.prereqTitle} to="/configuration" action={r.backToConfig}>{r.prereqText}</Prereq>
      </>
    )
  }

  const raha = data?.raha ?? null
  const change =
    raha && raha.f1 > 0 && typeof metrics?.f1 === 'number' ? ((metrics.f1 - raha.f1) / raha.f1) * 100 : null
  return (
    <div className="results-page">
      <div className="title-row">
        <h1>Results</h1>
        <InfoButton label={r.infoLabel} title={r.infoTitle}>
          <p>{r.infoIntro}</p>
          <h3>{r.infoReading}</h3>
          <ul>
            <li><b>Precision:</b> {r.infoPrecision}</li>
            <li><b>Recall:</b> {r.infoRecall}</li>
            <li><b>F1:</b> {r.infoF1}</li>
          </ul>
          <p>{r.infoBaseline}</p>
        </InfoButton>
      </div>
      {results.isError && <Notice kind="error">{(results.error as Error).message}</Notice>}
      {runNote && <Notice kind="warn">{runNote}</Notice>}
      {results.isLoading && <Loading>{r.loading}</Loading>}

      {(guest ? !metrics && !results.isLoading : data && !metrics) && (
        <EmptyState
          title={r.emptyTitle}
          to={guest ? undefined : '/error-detection'}
          action={guest ? undefined : r.goToDetection}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
            </svg>
          }
        >
          {guest ? r.guestEmptyText : r.emptyText}
        </EmptyState>
      )}

      {data && metrics && (
        <>
          <h2>{r.performance}</h2>
          {metrics && (
            <div className="hero" role="group" aria-label={r.heroAria}>
              <span className="hero-kicker">{r.heroKicker}</span>
              <span className="hero-num">{fmt(metrics.f1)}</span>
              <span className="hero-sub">{r.heroSub(data.dataset, data.pipeline)}</span>
            </div>
          )}
          {metrics && (
            <div className="stats">
              <Stat label="Precision" value={fmt(metrics.precision)} />
              <Stat label="Recall" value={fmt(metrics.recall)} />
              <Stat label="F1 Score" value={fmt(metrics.f1)} />
              <Stat label="Labeling Budget" value={String(data.labeling_budget ?? 'N/A')} />
            </div>
          )}

          <section>
            <h3>{r.comparisonTitle(data.dataset)}</h3>
            <p>{r.sortHint}</p>
            <DataTable
              sortable
              columns={[r.colTime, r.colPipeline, 'Labeling Budget', 'Recall', 'F1', 'Precision']}
              rows={data.comparison.map((r) => [
                String(r.time), String(r.pipeline), String(r.labeling_budget ?? ''),
                fmt(r.recall as number), fmt(r.f1 as number), fmt(r.precision as number),
              ])}
              rowClassName={(i) =>
                data.comparison[i].pipeline === data.pipeline && data.comparison[i].time === metrics?.time
                  ? 'current'
                  : undefined
              }
            />
          </section>

          {raha && (
            <Card title={r.baselineTitle}>
              <p>{r.baselineText(raha.labeling_budget)}</p>
              <div className="versus" role="group" aria-label={r.versusAria}>
                <Bar name="Matelda" value={metrics?.f1} tone="matelda" />
                <Bar name="Raha" value={raha.f1} tone="raha" />
                {change !== null && (
                  <span className={`delta ${change >= 0 ? 'up' : 'down'}`}>
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={change >= 0 ? 'M8 13V3M3.5 7.5L8 3l4.5 4.5' : 'M8 3v10M3.5 8.5L8 13l4.5-4.5'} />
                    </svg>
                    {(change >= 0 ? r.deltaUp : r.deltaDown)(Math.abs(change).toFixed(1))}
                  </span>
                )}
              </div>
              <div className="stats">
                <Stat label="Raha Precision" value={fmt(raha.precision, 3)} />
                <Stat label="Raha Recall" value={fmt(raha.recall, 3)} />
                <Stat label="Raha F1-Score" value={fmt(raha.f1, 3)} />
                <Stat
                  label={r.f1Change}
                  value={change === null ? 'n/a' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}
                />
              </div>
            </Card>
          )}
        </>
      )}

      {/* a helper has no buttons: their screen moves on when the host does */}
      {!guest && (
        <div className="nav-row">
          <Link className="btn btn-ghost" to="/error-detection">
            {r.back}
          </Link>
          <StepSlot />
          {metrics ? (
            <Link className="btn btn-primary" to="/configuration">
              {r.newRound}
            </Link>
          ) : (
            <span className="btn btn-primary" role="link" aria-disabled="true" title={r.needDetection}>
              {r.newRound}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
