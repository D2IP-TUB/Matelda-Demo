import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { Button, Card, Notice } from '../components/ui'
import { fetchLabelAccuracy, fetchResults, labelAccuracyCsvUrl } from '../lib/api'
import { pb } from '../lib/pb'
import { RoomService } from '../rooms/roomService'
import type { PlayerStat } from '../rooms/roomService'
import { useSession } from '../session/SessionProvider'

const fmt = (v: number | null | undefined, digits = 2) => (typeof v === 'number' ? v.toFixed(digits) : '')

function pattern(s: PlayerStat): string {
  const flags: string[] = []
  if (s.labels >= 5 && s.median_ms < 700) flags.push('very fast')
  if (s.labels >= 5 && Math.max(s.error_share, 1 - s.error_share) >= 0.9) flags.push('same answer')
  return flags.join(', ')
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

function Accuracy({ pipeline }: { pipeline: string }) {
  const [offset, setOffset] = useState(0)
  const accuracy = useQuery({
    queryKey: ['accuracy', pipeline, offset],
    queryFn: () => fetchLabelAccuracy(pipeline, offset, 100),
  })
  if (accuracy.isError) return <Notice kind="warn">{(accuracy.error as Error).message}</Notice>
  if (!accuracy.data) return <p>Loading…</p>
  const d = accuracy.data
  return (
    <>
      <div className="stats">
        <Stat label="Total cells labeled" value={String(d.total)} />
        <Stat label="Correct labels" value={String(d.correct)} />
        <Stat label="Your accuracy" value={`${(d.accuracy * 100).toFixed(1)}%`} />
      </div>
      <DataTable
        columns={['Table', 'Row', 'Column', 'Value', 'You said', 'Truth', 'Clean value', 'Correct']}
        rows={d.rows.map((r) => [
          String(r.table), String(r.row), String(r.col), String(r.val),
          r.user_said_error ? 'error' : 'correct', r.truth_is_error ? 'error' : 'correct',
          String(r.clean_value), r.correct ? '✅' : '❌',
        ])}
      />
      <div className="pager">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>
          Previous page
        </button>
        <span>{`${d.total === 0 ? 0 : offset + 1}–${Math.min(offset + 100, d.total)} of ${d.total}`}</span>
        <button disabled={offset + 100 >= d.total} onClick={() => setOffset(offset + 100)}>
          Next page
        </button>
        <a href={labelAccuracyCsvUrl(pipeline)}>Download CSV</a>
      </div>
    </>
  )
}

export function Results({ roomService }: { roomService?: RoomService }) {
  const session = useSession()
  const service = useMemo(() => roomService ?? new RoomService(pb), [roomService])
  const pipeline = session.data.pipeline_path as string | undefined
  const roomName = session.data.room_name as string | undefined
  const token = session.data.player_token as string | undefined
  const disputed = (session.data.room_disputed_cells as string[] | undefined) ?? []

  const results = useQuery({
    queryKey: ['results', pipeline],
    queryFn: () => fetchResults(pipeline as string),
    enabled: !!pipeline,
  })
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
  const stats = useQuery({
    queryKey: ['room-stats', inRoom?.room.name],
    queryFn: () => service.playerStats(inRoom!.room.name),
    enabled: !!inRoom,
  })

  const data = results.data
  const metrics = data?.metrics ?? null

  // Share the fresh result with the room (once per result) for the live dashboard.
  const sharedFor = useRef<string | null>(null)
  const [runNote, setRunNote] = useState('')
  useEffect(() => {
    if (!inRoom || !metrics || !data) return
    const time = metrics.time as string
    if (session.data.run_saved_for === time || sharedFor.current === time) return
    sharedFor.current = time
    void session.update({ run_saved_for: time })
    service
      .saveRun(inRoom.room, inRoom.player, data.labeling_budget ?? 0, metrics.precision ?? 0, metrics.recall ?? 0, metrics.f1 ?? 0)
      .catch((e) => setRunNote(`Could not share metrics with the room (${e instanceof Error ? e.message : e}).`))
  }, [inRoom, metrics, data, session, service])

  const [showAccuracy, setShowAccuracy] = useState(false)

  if (!session.ready) return <h1>Results</h1>
  if (!pipeline) {
    return (
      <>
        <h1>Results</h1>
        <Notice kind="warn">Pipeline not configured.</Notice>
        <Link to="/configuration">Go back to Configurations</Link>
      </>
    )
  }

  const raha = data?.raha ?? null
  const change =
    raha && raha.f1 > 0 && typeof metrics?.f1 === 'number' ? ((metrics.f1 - raha.f1) / raha.f1) * 100 : null
  const shareText = data
    ? `🎯 Just achieved some great results with Matelda! 📊 Recall: ${fmt(metrics?.recall)} | F1: ${fmt(metrics?.f1)} | Precision: ${fmt(metrics?.precision)} 💰 Budget: ${data.labeling_budget ?? ''} | 📈 Dataset: ${data.dataset} | Pipeline: ${data.pipeline} #ErrorDetection #DataCleaning #D2IP #TUB #VLDB`
    : ''
  const roomStats = stats.data ?? []
  const totalLabels = roomStats.reduce((n, s) => n + s.labels, 0)
  const totalCorrect = roomStats.reduce((n, s) => n + s.correct, 0)

  return (
    <>
      <h1>Results</h1>
      {results.isError && <Notice kind="error">{(results.error as Error).message}</Notice>}

      {data && (
        <>
          <h2>Model Performance Metrics</h2>
          {metrics ? (
            <div className="stats">
              <Stat label="Precision" value={fmt(metrics.precision)} />
              <Stat label="Recall" value={fmt(metrics.recall)} />
              <Stat label="F1 Score" value={fmt(metrics.f1)} />
              <Stat label="Labeling Budget" value={String(data.labeling_budget ?? 'N/A')} />
            </div>
          ) : (
            <>
              <Notice kind="info">No results yet. Run error detection first.</Notice>
              <Link to="/error-detection">Go to Error Detection</Link>
            </>
          )}

          <section>
            <h3>{`Result Comparison (Dataset: ${data.dataset})`}</h3>
            <p>Click a column header to sort.</p>
            <DataTable
              sortable
              columns={['Time', 'Pipeline Name', 'Labeling Budget', 'Recall', 'F1', 'Precision']}
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
            <Card title="Baseline comparison: Raha">
              <p>{`Raha baseline for the closest labeling budget (${raha.labeling_budget} labels):`}</p>
              <div className="stats">
                <Stat label="Raha Precision" value={fmt(raha.precision, 3)} />
                <Stat label="Raha Recall" value={fmt(raha.recall, 3)} />
                <Stat label="Raha F1-Score" value={fmt(raha.f1, 3)} />
                <Stat
                  label="F1 change vs Raha"
                  value={change === null ? 'n/a' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}
                />
              </div>
            </Card>
          )}

          <h2>Label Analysis</h2>
          <Button variant="ghost" onClick={() => setShowAccuracy(true)}>
            Check my labeling accuracy
          </Button>
          {showAccuracy && <Accuracy pipeline={pipeline} />}

          {inRoom && (
            <section>
              <h2>Room labeling</h2>
              {runNote && <Notice kind="warn">{runNote}</Notice>}
              {roomStats.length === 0 ? (
                <p>{`Room ${inRoom.room.name} has no labels yet.`}</p>
              ) : (
                <>
                  <div className="stats">
                    <Stat label="Labels in the room" value={String(totalLabels)} />
                    <Stat label="Labelers" value={String(roomStats.length)} />
                    <Stat label="Room accuracy" value={`${((100 * totalCorrect) / totalLabels).toFixed(0)}%`} />
                  </div>
                  <DataTable
                    columns={['Player', 'Labels', 'Correct', 'Accuracy', 'Median time', 'Marked as error', 'Pattern']}
                    rows={roomStats.map((s) => [
                      s.name + (s.id === inRoom.player.id ? ' (you)' : ''),
                      String(s.labels), String(s.correct), `${(100 * s.accuracy).toFixed(0)}%`,
                      `${(s.median_ms / 1000).toFixed(1)}s`, `${(100 * s.error_share).toFixed(0)}%`, pattern(s),
                    ])}
                  />
                  {disputed.length > 0 && (
                    <Notice kind="info">
                      {`${disputed.length} disputed cell(s) (players disagreed 50/50) were left out of your run.`}
                    </Notice>
                  )}
                  <p>Everyone&apos;s labels count. The pattern column only hints at click-through.</p>
                </>
              )}
            </section>
          )}

          <Card title="Share your results">
            <pre data-testid="share-text">{shareText}</pre>
            <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(shareText)}>
              Copy
            </Button>
          </Card>
        </>
      )}

      <div className="nav-row">
        <Link className="btn btn-ghost" to="/error-detection">
          Back
        </Link>
        <span />
      </div>
    </>
  )
}
