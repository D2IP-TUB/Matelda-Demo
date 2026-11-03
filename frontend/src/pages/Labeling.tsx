import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { SwipeDeck } from '../components/SwipeDeck'
import type { SwipeDeckHandle } from '../components/SwipeDeck'
import { Button, JobStatus, Notice } from '../components/ui'
import { useJob } from '../jobs/useJob'
import {
  fetchCandidates,
  fetchCards,
  fetchDirtyPage,
  fetchLabelingSample,
  fetchPipeline,
  judgeVerdicts,
  startPropagation,
} from '../lib/api'
import type { Card as CardData } from '../lib/api'
import { pb } from '../lib/pb'
import { RoomService } from '../rooms/roomService'
import { useSession } from '../session/SessionProvider'

type Verdicts = Record<string, boolean> // cell key -> "correct"

function Excerpt({ dataset, card }: { dataset: string; card: CardData }) {
  const start = Math.max(0, card.row - 5)
  const page = useQuery({
    queryKey: ['excerpt', dataset, card.table, start],
    queryFn: () => fetchDirtyPage(dataset, card.table, start, 11),
  })
  if (page.isError) return <Notice kind="error">{(page.error as Error).message}</Notice>
  if (!page.data) return <p>Loading table…</p>
  const target = card.row - start
  const colIndex = page.data.columns.indexOf(card.col)
  return (
    <DataTable
      columns={page.data.columns}
      rows={page.data.rows}
      cellStyle={(r, c) => (r === target && c === colIndex ? { background: 'rgb(244 177 28 / 55%)' } : undefined)}
    />
  )
}

function CardFace({ card, dataset, depth }: { card: CardData; dataset: string; depth: number }) {
  const value = String(card.val) === '' ? '(empty)' : String(card.val)
  return (
    <div className="card-face">
      <h2 className="card-value">{value}</h2>
      {depth === 0 && (
        <>
          <p className="card-meta">
            <code>{card.table}</code> · column <code>{card.col}</code> · row {card.row}
          </p>
          <div className="card-pills">
            {card.strategies.map((s) => (
              <span key={s} className="pill">
                {s}
              </span>
            ))}
          </div>
          <Excerpt dataset={dataset} card={card} />
        </>
      )}
    </div>
  )
}

export function Labeling({ roomService, pollMs = 1000 }: { roomService?: RoomService; pollMs?: number }) {
  const session = useSession()
  const navigate = useNavigate()
  const service = useMemo(() => roomService ?? new RoomService(pb), [roomService])
  const pipeline = session.data.pipeline_path as string | undefined
  const roomName = session.data.room_name as string | undefined
  const token = session.data.player_token as string | undefined
  const results = (session.data.labeling_results as Verdicts | undefined) ?? {}

  const config = useQuery({
    queryKey: ['pipeline', pipeline],
    queryFn: () => fetchPipeline(pipeline as string),
    enabled: !!pipeline,
  })
  const hasFolds = config.data?.has_cell_folds === true
  const dataset = config.data?.selected_dataset ?? ''

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
  const roomReady = !roomName || !token || roomCtx.isSuccess
  const roomStarted = !inRoom || inRoom.room.phase !== 'lobby'

  const cards = useQuery({
    queryKey: ['cards', pipeline, inRoom?.player.id ?? 'solo'],
    enabled: !!pipeline && hasFolds && roomReady && roomStarted,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<CardData[]> => {
      if (!inRoom) return (await fetchLabelingSample(pipeline as string)).cards
      const { keys } = await fetchCandidates(pipeline as string)
      const claimed = await service.claimCells(inRoom.room.name, inRoom.player.id, keys, inRoom.player.budget)
      return fetchCards(pipeline as string, claimed)
    },
  })
  const list = cards.data ?? []

  const [index, setIndex] = useState(0)
  const positioned = useRef(false)
  useEffect(() => {
    if (cards.data && !positioned.current) {
      positioned.current = true
      const first = cards.data.findIndex((c) => !(c.key in results))
      setIndex(first === -1 ? cards.data.length : first)
    }
  }, [cards.data, results])

  const shownAt = useRef(Date.now())
  useEffect(() => {
    shownAt.current = Date.now()
  }, [index])

  const deck = useRef<SwipeDeckHandle>(null)
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId, pollMs)
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (job.state !== 'done' || !jobId || handled.current === jobId) return
    handled.current = jobId
    const disputed = (job.result as { disputed?: string[] } | undefined)?.disputed ?? []
    void session.update({ room_disputed_cells: disputed }).then(() => navigate('/propagated-errors'))
  }, [job.state, job.result, jobId, session, navigate])

  if (!session.ready) return <h1>Labeling</h1>
  if (!pipeline) {
    return (
      <>
        <h1>Labeling</h1>
        <Notice kind="warn">Pipeline not configured.</Notice>
        <Link to="/configuration">Go back to Configurations</Link>
      </>
    )
  }
  if (config.data && !hasFolds) {
    return (
      <>
        <h1>Labeling</h1>
        <Notice kind="warn">Run quality folding first.</Notice>
        <Link to="/quality-folding">Go to Quality Folding</Link>
      </>
    )
  }
  if (roomCtx.isError) {
    return (
      <>
        <h1>Labeling</h1>
        <Notice kind="error">Could not reach the room server ({(roomCtx.error as Error).message}).</Notice>
      </>
    )
  }
  if (inRoom && inRoom.room.phase === 'lobby') {
    return (
      <>
        <h1>Labeling</h1>
        <Notice kind="warn">Your room has not started yet.</Notice>
        <Link to="/lobby">Back to the lobby</Link>
      </>
    )
  }

  const answer = async (correct: boolean) => {
    const card = list[index]
    if (!card) return
    const latency = Date.now() - shownAt.current
    void session.update({ labeling_results: { ...results, [card.key]: correct } })
    setIndex((i) => Math.min(i + 1, list.length))
    if (!inRoom) return
    setWarning('')
    let isCorrect: boolean | null = null
    try {
      ;[isCorrect] = await judgeVerdicts(dataset, [
        { table: card.table, row: card.row, col: card.col, said_correct: correct },
      ])
    } catch {
      setWarning('Could not share your verdict with the room (the answer check failed).')
    }
    try {
      await service.saveLabel(inRoom.room.name, inRoom.player.id, card.key, correct, isCorrect, latency)
    } catch {
      setWarning('Could not share your verdict with the room.')
    }
  }

  const next = async () => {
    setError('')
    const own = list
      .filter((c) => c.key in results)
      .map((c) => ({
        table: c.table, row: c.row, col: c.col, val: c.val, is_error: !results[c.key],
        domain_fold: c.domain_fold, cell_fold: c.cell_fold,
      }))
    try {
      if (inRoom) {
        const labels = await service.roomLabels(inRoom.room.name)
        setJobId(
          await startPropagation(pipeline, {
            own,
            room_labels: labels.map((l) => ({ cell_id: l.cell_id, player: l.player, value: l.value })),
            player_id: inRoom.player.id,
          }),
        )
      } else {
        setJobId(await startPropagation(pipeline, { own }))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start label propagation')
    }
  }

  const card = list[index]
  const finished = cards.data !== undefined && list.length > 0 && !card

  return (
    <>
      <h1>Labeling</h1>
      {inRoom && (
        <Notice kind="info">
          Room <b>{inRoom.room.name}</b> — you are <b>{inRoom.player.name}</b>. You label your own suggestions;
          everyone&apos;s labels are shared when you continue, and cells where players disagree 50/50 are left out.
        </Notice>
      )}
      {cards.isError && <Notice kind="error">{(cards.error as Error).message}</Notice>}
      {cards.isLoading && <p>Loading cells to label…</p>}
      {warning && <Notice kind="warn">{warning}</Notice>}

      {cards.data && list.length === 0 && (
        <>
          <Notice kind="info">
            All cell folds have been bulk-annotated! No individual labeling needed. Continue with Next.
          </Notice>
        </>
      )}

      {list.length > 0 && (
        <>
          <p className="deck-progress">{`Card ${Math.min(index + 1, list.length)} of ${list.length}`}</p>
          <SwipeDeck
            ref={deck}
            items={list}
            index={index}
            disabled={!card}
            onSwipe={(direction) => void answer(direction === 'right')}
            renderCard={(c, depth) => <CardFace card={c} dataset={dataset} depth={depth} />}
          />
          <p className="deck-hint">Drag the card right if the value is correct, left if it is wrong — or use the buttons or the ← → keys.</p>
          <div className="verdict-buttons">
            <button type="button" className="round round-error" aria-label="Error" disabled={!card} onClick={() => deck.current?.swipe('left')}>
              ✕
            </button>
            <button type="button" className="round round-correct" aria-label="Correct" disabled={!card} onClick={() => deck.current?.swipe('right')}>
              ✓
            </button>
          </div>
        </>
      )}
      {finished && <Notice kind="info">All cards answered. Continue with Next.</Notice>}

      <JobStatus state={job.state} error={job.error} />
      {error && <Notice kind="error">{error}</Notice>}

      <div className="nav-row">
        <Link className="btn btn-ghost" to="/quality-folding">
          Back
        </Link>
        <div className="row">
          <Button variant="ghost" disabled={index === 0 || list.length === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            Previous
          </Button>
          <Button
            disabled={job.state === 'running' || !cards.data}
            onClick={() => void next()}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  )
}
