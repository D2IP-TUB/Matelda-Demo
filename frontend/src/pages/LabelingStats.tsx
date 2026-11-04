import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import '../styles/pages/labeling-stats.css'
import { DataTable } from '../components/DataTable'
import { Stat } from '../components/stats'
import { EmptyState, InfoButton, Loading, Notice, Prereq } from '../components/ui'
import { StepSlot } from '../components/StepSlot'
import { useT } from '../i18n'
import { fetchLabelAccuracy } from '../lib/api'
import { pb } from '../lib/pb'
import { RoomService } from '../rooms/roomService'
import { useSession } from '../session/SessionProvider'

const PAGE = 100

/** Nothing to compare yet: the labeling step has not saved any labels. */
function NoLabels() {
  const l = useT().labelingStats
  return (
    <EmptyState
      title={l.noLabelsTitle}
      to="/labeling"
      action={l.goToLabeling}
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
          <circle cx="7.5" cy="7.5" r="1.5" />
        </svg>
      }
    >
      {l.noLabelsText}
    </EmptyState>
  )
}

function Accuracy({ pipeline }: { pipeline: string }) {
  const l = useT().labelingStats
  const [offset, setOffset] = useState(0)
  const accuracy = useQuery({
    queryKey: ['accuracy', pipeline, offset],
    queryFn: () => fetchLabelAccuracy(pipeline, offset, PAGE),
  })
  if (accuracy.isError) return <Notice kind="warn">{(accuracy.error as Error).message}</Notice>
  if (!accuracy.data) return <Loading>{l.loading}</Loading>
  const d = accuracy.data
  return (
    <>
      <div className="stats">
        <Stat label={l.totalLabeled} value={String(d.total)} />
        <Stat label={l.correctLabels} value={String(d.correct)} />
        <Stat label={l.yourAccuracy} value={`${(d.accuracy * 100).toFixed(1)}%`} />
      </div>
      <DataTable
        columns={[l.colTable, l.colRow, l.colColumn, l.colValue, l.colYouSaid, l.colTruth, l.colClean, l.colCorrect]}
        rows={d.rows.map((r) => [
          String(r.table), String(r.row), String(r.col), String(r.val),
          r.user_said_error ? l.error : l.correct, r.truth_is_error ? l.error : l.correct,
          String(r.clean_value), r.correct ? l.rightMark : l.wrongMark,
        ])}
        rowClassName={(i) => (d.rows[i].correct ? 'row-right' : 'row-wrong')}
      />
      <div className={`pager${d.total <= PAGE ? ' pager-single' : ''}`}>
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          {l.prevPage}
        </button>
        <span>{l.range(d.total === 0 ? 0 : offset + 1, Math.min(offset + PAGE, d.total), d.total)}</span>
        <button disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>
          {l.nextPage}
        </button>
      </div>
    </>
  )
}

const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

/** Shown after labeling: how you did, and how the whole room did. Leads on to label propagation. */
export function LabelingStats({ roomService }: { roomService?: RoomService }) {
  const l = useT().labelingStats
  const session = useSession()
  const service = useMemo(() => roomService ?? new RoomService(pb), [roomService])
  const pipeline = session.data.pipeline_path as string | undefined
  const roomName = session.data.room_name as string | undefined
  const token = session.data.player_token as string | undefined
  const disputed = (session.data.room_disputed_cells as string[] | undefined) ?? []

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
  // A helper (not the host) sees how the room is doing, live, and goes no further than this page.
  const guest = !!inRoom?.room.host && inRoom.player.id !== inRoom.room.host
  const stats = useQuery({
    queryKey: ['room-stats', inRoom?.room.name],
    queryFn: () => service.playerStats(inRoom!.room.name),
    enabled: !!inRoom,
    refetchInterval: 3000, // others may still be labeling
  })
  // The first page of your labels (shared with the analysis below): `null` means nothing is saved yet.
  const firstPage = useQuery({
    queryKey: ['accuracy', pipeline, 0],
    queryFn: () => fetchLabelAccuracy(pipeline as string, 0, PAGE),
    enabled: !!pipeline && !guest && !roomCtx.isLoading,
  })
  const noLabels = firstPage.data === null

  const head = (
    <header>
      <div className="title-row">
        <h1>Labeling Stats</h1>
        <InfoButton label={l.infoLabel} title={l.infoTitle}>
          <p>{l.infoIntro}</p>
          <h3>{l.infoReading}</h3>
          <ul>
            <li>{l.infoAccuracy}</li>
            <li>{l.infoRoom}</li>
          </ul>
        </InfoButton>
      </div>
      <p className="ls-lead">{l.lead}</p>
    </header>
  )
  if (!session.ready || roomCtx.isLoading) return <div className="lstats-page">{head}</div>
  if (!pipeline && !guest) {
    return (
      <div className="lstats-page">
        {head}
        <Prereq title={l.prereqTitle} to="/configuration" action={l.backToConfig}>{l.prereqText}</Prereq>
      </div>
    )
  }

  const roomStats = stats.data ?? []
  const totalLabels = roomStats.reduce((n, s) => n + s.labels, 0)
  const totalCorrect = roomStats.reduce((n, s) => n + s.correct, 0)
  const ranked = [...roomStats].sort((a, b) => b.accuracy - a.accuracy || b.labels - a.labels)

  return (
    <div className="lstats-page">
      {head}
      {inRoom && (
        <section>
          <h2>{l.roomLabeling}</h2>
          {!stats.isSuccess ? (
            <Loading>{l.loading}</Loading>
          ) : roomStats.length === 0 ? (
            <NoLabels />
          ) : (
            <>
              <div className="stats">
                <Stat label={l.labelsInRoom} value={String(totalLabels)} />
                <Stat label={l.labelers} value={String(roomStats.length)} />
                <Stat label={l.roomAccuracy} value={`${((100 * totalCorrect) / totalLabels).toFixed(0)}%`} />
              </div>
              <ol className="rank" aria-label={l.leaderboard}>
                {ranked.map((s, i) => (
                  <li key={s.id} className={s.id === inRoom.player.id ? 'me' : undefined}>
                    <span className="rank-n">{i + 1}</span>
                    <span className="avatar" aria-hidden="true">{initials(s.name)}</span>
                    <span className="rank-name">
                      {s.name}
                      {s.id === inRoom.player.id && <em className="you">{l.you}</em>}
                    </span>
                    <span className="rank-bar" aria-hidden="true"><i style={{ width: `${Math.round(100 * s.accuracy)}%` }} /></span>
                    <b className="rank-acc">{l.labelsCount((100 * s.accuracy).toFixed(0), s.labels)}</b>
                  </li>
                ))}
              </ol>
              {disputed.length > 0 && (
                <Notice kind="info">
                  {l.disputed(disputed.length)}
                </Notice>
              )}
            </>
          )}
        </section>
      )}

      {guest || !pipeline ? null : noLabels ? (
        !inRoom && <NoLabels /> // in a room the card already sits in the room section
      ) : (
        <>
          <h2>{l.labelAnalysis}</h2>
          <Accuracy pipeline={pipeline} />
        </>
      )}

      {/* a helper has no buttons: their screen moves on when the host does */}
      {!guest && (
        <div className="nav-row">
          <Link className="btn btn-ghost" to="/labeling">
            {l.back}
          </Link>
          <StepSlot />
          <Link className="btn btn-primary" to="/propagated-errors">
            {l.continue}
          </Link>
        </div>
      )}
    </div>
  )
}
