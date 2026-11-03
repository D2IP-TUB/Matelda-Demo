import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { SwipeDeck } from '../components/SwipeDeck'
import type { SwipeDeckHandle } from '../components/SwipeDeck'
import { Button, Card, JobStatus, Notice } from '../components/ui'
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
import { useRoomInfo } from '../rooms/useRoomInfo'
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

/** Shown to helpers until the host has published the shared pool. Task 7 swaps this for WaitingForLabeling. */
function WaitingForHost() {
  return (
    <>
      <h1>Labeling</h1>
      <Notice kind="info">Waiting for the host to start labeling…</Notice>
    </>
  )
}

export function Labeling({ roomService, pollMs = 1000 }: { roomService?: RoomService; pollMs?: number }) {
  const session = useSession()
  const navigate = useNavigate()
  const service = useMemo(() => roomService ?? new RoomService(pb), [roomService])
  const info = useRoomInfo(service)
  const { room, me, isHost, refresh } = info
  const sessionPipeline = session.data.pipeline_path as string | undefined
  const roomName = session.data.room_name as string | undefined
  const token = session.data.player_token as string | undefined
  const results = (session.data.labeling_results as Verdicts | undefined) ?? {}

  const inRoom = !!room && !!me
  const roomReady = !roomName || !token || inRoom
  const pool = useMemo(() => room?.pool ?? [], [room?.pool])
  const poolReady = pool.length > 0
  const roomStarted = !inRoom || room.phase !== 'lobby'
  const pipeline = inRoom ? (room.pipeline ?? sessionPipeline) : sessionPipeline
  // Helpers must not touch any pipeline endpoint before the host has published the pool.
  const canUsePipeline = !inRoom || isHost || poolReady

  const config = useQuery({
    queryKey: ['pipeline', pipeline],
    queryFn: () => fetchPipeline(pipeline as string),
    enabled: !!pipeline && roomReady && roomStarted && canUsePipeline,
  })
  const hasFolds = config.data?.has_cell_folds === true
  const dataset = config.data?.selected_dataset ?? ''

  // Solo: the sampler's cards in one go.
  const soloCards = useQuery({
    queryKey: ['cards', pipeline, 'solo'],
    enabled: !!pipeline && hasFolds && !roomName,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<CardData[]> => (await fetchLabelingSample(pipeline as string)).cards,
  })

  // Room: cards arrive one claim at a time from the shared pool.
  const [roomCards, setRoomCards] = useState<CardData[]>([])
  const [roomLoaded, setRoomLoaded] = useState(false)
  const [loadingNext, setLoadingNext] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [roomError, setRoomError] = useState('')
  const [index, setIndex] = useState(0)

  const published = useRef(false)
  useEffect(() => {
    if (!inRoom || !isHost || poolReady || !hasFolds || !pipeline || published.current) return
    published.current = true
    void (async () => {
      try {
        const { keys } = await fetchCandidates(pipeline)
        await service.publishPool(room, me.id, pipeline, keys)
        await refresh()
      } catch (e) {
        published.current = false
        setRoomError(e instanceof Error ? e.message : 'Could not publish the cells to label')
      }
    })()
  }, [inRoom, isHost, poolReady, hasFolds, pipeline, room, me, service, refresh])

  const roomCardsRef = useRef(roomCards)
  roomCardsRef.current = roomCards
  const loadNext = async (): Promise<void> => {
    if (!room || !me || !pipeline) return
    setLoadingNext(true)
    try {
      const key = await service.claimNext(room.name, me.id, pool)
      if (key === null) {
        setExhausted(true)
        return
      }
      if (roomCardsRef.current.some((c) => c.key === key)) return
      const [fetched] = await fetchCards(pipeline, [key])
      if (fetched) setRoomCards((l) => (l.some((c) => c.key === fetched.key) ? l : [...l, fetched]))
    } catch (e) {
      setRoomError(e instanceof Error ? e.message : 'Could not load the next cell')
    } finally {
      setLoadingNext(false)
    }
  }

  const started = useRef(false)
  useEffect(() => {
    if (!inRoom || !poolReady || !pipeline || !roomStarted || started.current) return
    started.current = true
    void (async () => {
      try {
        // Cards this player already answered (kept in the session) come first, so a reload keeps order.
        const inPool = new Set(pool)
        const answered = Object.keys(results).filter((k) => inPool.has(k))
        if (answered.length > 0) {
          const seeded = await fetchCards(pipeline, answered)
          setRoomCards(seeded)
          roomCardsRef.current = seeded
          setIndex(seeded.length)
        }
        await loadNext()
      } catch (e) {
        setRoomError(e instanceof Error ? e.message : 'Could not load cells to label')
      } finally {
        setRoomLoaded(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRoom, poolReady, pipeline, roomStarted])

  const list = roomName ? roomCards : (soloCards.data ?? [])
  const loaded = roomName ? roomLoaded : soloCards.data !== undefined

  const positioned = useRef(false)
  useEffect(() => {
    if (soloCards.data && !positioned.current) {
      positioned.current = true
      const first = soloCards.data.findIndex((c) => !(c.key in results))
      setIndex(first === -1 ? soloCards.data.length : first)
    }
  }, [soloCards.data, results])

  const shownAt = useRef(Date.now())
  useEffect(() => {
    shownAt.current = Date.now()
  }, [index])

  const deck = useRef<SwipeDeckHandle>(null)
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const [released, setReleased] = useState<number | null>(null)
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
  if (inRoom && room.phase === 'lobby') {
    return (
      <>
        <h1>Labeling</h1>
        <Notice kind="warn">Your room has not started yet.</Notice>
        <Link to="/lobby">Back to the lobby</Link>
      </>
    )
  }
  if (inRoom && !isHost && !poolReady) return <WaitingForHost />
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

  const answer = async (correct: boolean) => {
    const card = list[index]
    if (!card) return
    const latency = Date.now() - shownAt.current
    const atFrontier = index === list.length - 1
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
      await service.saveLabel(room.name, me.id, card.key, correct, isCorrect, latency)
    } catch {
      setWarning('Could not share your verdict with the room.')
    }
    if (atFrontier && !exhausted) await loadNext()
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
        const labels = await service.roomLabels(room.name)
        setJobId(
          await startPropagation(pipeline, {
            own,
            room_labels: labels.map((l) => ({ cell_id: l.cell_id, player: l.player, value: l.value })),
            player_id: me.id,
          }),
        )
      } else {
        setJobId(await startPropagation(pipeline, { own }))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start label propagation')
    }
  }

  const release = async () => {
    if (!room) return
    try {
      setReleased(await service.releaseUnlabeledClaims(room.name))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not release the claims')
    }
  }

  const card = list[index]
  const finished = loaded && list.length > 0 && !card && !loadingNext && (!inRoom || exhausted)
  const loadError = soloCards.isError ? (soloCards.error as Error).message : roomError

  return (
    <>
      <h1>Labeling</h1>
      {inRoom && (
        <Notice kind="info">
          Room <b>{room.name}</b> — you are <b>{me.name}</b>. Cells are shared out first-come-first-served from one
          shared budget: you get the next free cell each time you answer, and everyone&apos;s labels are shared when
          the host continues.
        </Notice>
      )}
      {loadError && <Notice kind="error">{loadError}</Notice>}
      {!loaded && !loadError && <p>Loading cells to label…</p>}
      {warning && <Notice kind="warn">{warning}</Notice>}
      {inRoom && exhausted && <Notice kind="info">All cells are claimed.</Notice>}

      {!inRoom && soloCards.data && list.length === 0 && (
        <Notice kind="info">
          All cell folds have been bulk-annotated! No individual labeling needed. Continue with Next.
        </Notice>
      )}

      {card && (
        <Card>
          <p>{inRoom ? `Card ${index + 1}` : `Card ${index + 1} of ${list.length}`}</p>
          <p>Swipe right (or press Correct) if the highlighted value is correct, left (Error) if it is wrong.</p>
          <SwipeDeck
            ref={deck}
            items={list}
            index={index}
            onSwipe={(d) => void answer(d === 'right')}
            renderCard={(c, depth) =>
              depth > 0 ? null : (
                <>
                  <h2>{String(c.val) === '' ? '(empty)' : String(c.val)}</h2>
                  <p>
                    <code>{c.table}</code> · column <code>{c.col}</code> · row {c.row} · {c.cell_fold}
                  </p>
                  <div>
                    {c.strategies.map((s) => (
                      <span key={s} className="pill">
                        {s}
                      </span>
                    ))}
                  </div>
                  <Excerpt dataset={dataset} card={c} />
                </>
              )
            }
          />
          <div className="verdict-buttons">
            <Button variant="ghost" onClick={() => deck.current?.swipe('left')}>
              Error
            </Button>
            <Button onClick={() => deck.current?.swipe('right')}>Correct</Button>
          </div>
        </Card>
      )}
      {inRoom && !card && loadingNext && <p>Loading the next cell…</p>}
      {finished && !(inRoom && !isHost) && <Notice kind="info">All cards answered. Continue with Next.</Notice>}
      {finished && inRoom && !isHost && (
        <Notice kind="info">You&apos;re done — the host will continue with the results.</Notice>
      )}

      {inRoom && isHost && (
        <div className="row">
          <Button variant="ghost" onClick={() => void release()}>
            Release unlabeled claims
          </Button>
          {released !== null && <span>{`Released ${released} unlabeled claim${released === 1 ? '' : 's'}.`}</span>}
        </div>
      )}

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
          {(!inRoom || isHost) && (
            <Button disabled={job.state === 'running' || !loaded} onClick={() => void next()}>
              Next
            </Button>
          )}
        </div>
      </div>
    </>
  )
}
