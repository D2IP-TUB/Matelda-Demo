import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { centerOffset } from '../lib/centerCell'
import { WaitingForLabeling } from '../components/WaitingForLabeling'
import { SwipeDeck } from '../components/SwipeDeck'
import type { SwipeDeckHandle } from '../components/SwipeDeck'
import { Button, EmptyState, InfoPopup, JobStatus, Loading, Notice, Prereq } from '../components/ui'
import { StepSlot } from '../components/StepSlot'
import { t, useT } from '../i18n'
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
import '../styles/pages/labeling.css'

type Verdicts = Record<string, boolean> // cell key -> "correct"

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
}
const CrossIcon = () => (
  <svg {...iconProps} strokeWidth={3.2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
const CheckIcon = () => (
  <svg {...iconProps} strokeWidth={3.2}>
    <path d="M4 12.5l5 5L20 6.5" />
  </svg>
)
/** Circled "i". */
const InfoIcon = () => (
  <svg {...iconProps} strokeWidth={2.2}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 11v6" />
    <circle cx="12" cy="7.5" r="0.6" fill="currentColor" />
  </svg>
)
const FullscreenIcon = ({ exit }: { exit: boolean }) => (
  <svg {...iconProps} strokeWidth={2.2}>
    {exit ? (
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    ) : (
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    )}
  </svg>
)
/** Circular arrow turning back (counter-clockwise). */
const BackIcon = () => (
  <svg {...iconProps} strokeWidth={2.6}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
)

/** The table rows around a card's cell. Shared by the card and the prefetch for the cards behind it. */
const excerptQuery = (dataset: string, card: CardData) => {
  const start = Math.max(0, card.row - 5)
  return {
    queryKey: ['excerpt', dataset, card.table, start],
    queryFn: () => fetchDirtyPage(dataset, card.table, start, 11),
  }
}

function Excerpt({ dataset, card, pan }: { dataset: string; card: CardData; pan: { x: number; y: number } }) {
  const start = Math.max(0, card.row - 5)
  const page = useQuery(excerptQuery(dataset, card))
  const box = useRef<HTMLDivElement>(null)
  const base = useRef({ x: 0, y: 0 }) // where the cell sits centered
  const panRef = useRef(pan) // how far the player dragged the table away from there
  panRef.current = pan
  const apply = () => {
    const table = box.current?.querySelector('table')
    if (table) table.style.transform = `translate(${base.current.x + panRef.current.x}px, ${base.current.y + panRef.current.y}px)`
  }
  const target = card.row - start
  const colIndex = page.data ? page.data.columns.indexOf(card.col) : -1

  // Keep the cell being labeled in the exact middle of the card, however wide or tall the table is.
  useLayoutEffect(() => {
    const wrap = box.current
    const table = wrap?.querySelector('table')
    if (!wrap || !table || colIndex < 0) return
    const place = () => {
      const td = table.querySelectorAll('tbody tr')[target]?.children[colIndex] as HTMLElement | undefined
      if (!td) return
      const { x, y } = centerOffset(
        { width: wrap.clientWidth, height: wrap.clientHeight },
        { left: td.offsetLeft, top: td.offsetTop, width: td.offsetWidth, height: td.offsetHeight },
      )
      base.current = { x, y }
      apply()
    }
    place()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(place)
    ro.observe(wrap)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.data, target, colIndex])

  // Dragging in inspect mode moves the table away from the centered position; leaving it puts the table back.
  useLayoutEffect(() => {
    apply()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pan.x, pan.y])

  if (page.isError) return <Notice kind="error">{(page.error as Error).message}</Notice>
  if (!page.data) return <div className="card-excerpt" aria-hidden="true" /> // no spinner between swipes
  return (
    <div className="card-excerpt" ref={box} data-testid="excerpt">
      <DataTable
        columns={page.data.columns}
        rows={page.data.rows}
        cellStyle={(r, c) => (r === target && c === colIndex ? { background: 'var(--accent-tint)', boxShadow: 'inset 0 0 0 2px var(--accent)' } : undefined)}
      />
    </div>
  )
}

const PILLS_SHOWN = 1

/** The first strategy as a pill; any further ones sit behind a show-more button. */
function StrategyPills({ strategies }: { strategies: string[] }) {
  const l = useT().labeling
  const [open, setOpen] = useState(false)
  const hidden = strategies.length - PILLS_SHOWN
  const shown = open || hidden <= 0 ? strategies : strategies.slice(0, PILLS_SHOWN)
  return (
    <div className="card-pills">
      {shown.map((s) => (
        <span key={s} className="pill">
          {s}
        </span>
      ))}
      {hidden > 0 && (
        <button type="button" className="pill-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? l.showLess : l.showMore(hidden)}
        </button>
      )}
    </div>
  )
}

function CardFace({ card, dataset, depth, inspect }: { card: CardData; dataset: string; depth: number; inspect: boolean }) {
  const l = useT().labeling
  const value = String(card.val) === '' ? l.empty : String(card.val)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (!inspect) setPan({ x: 0, y: 0 })
  }, [inspect])

  // Mouse and touch both: follow the pointer on the window, so the drag survives leaving the card.
  const startPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    let last = { x: e.clientX, y: e.clientY }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - last.x
      const dy = ev.clientY - last.y
      last = { x: ev.clientX, y: ev.clientY }
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  return (
    <div className="card-face">
      {/* the table is the "photo" */}
      <div className="card-photo">{depth === 0 && <Excerpt dataset={dataset} card={card} pan={pan} />}</div>
      <div className="card-info">
        <h2 className="card-value">{value}</h2>
        {depth === 0 && (
          <>
            <p className="card-meta">
              <code>{card.table}</code>
              {l.metaColumn}
              <code>{card.col}</code>
              {l.metaRow}
              {card.row}
            </p>
            <StrategyPills strategies={card.strategies} />
          </>
        )}
      </div>
      {depth === 0 && inspect && (
        <div className="inspect-pad" data-testid="inspect-pad" aria-label={l.dragTable} onPointerDown={startPan} />
      )}
    </div>
  )
}

export function Labeling({ roomService, pollMs = 1000 }: { roomService?: RoomService; pollMs?: number }) {
  const l = useT().labeling
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
  const pipeline = inRoom ? (room.pipeline || sessionPipeline) : sessionPipeline
  // Helpers must not touch any pipeline endpoint before the host has published the pool.
  const canUsePipeline = !inRoom || isHost || poolReady

  // In a room, the host can only continue once every cell of the shared pool has been answered.
  const progress = useQuery({
    queryKey: ['room-progress', room?.name, pool.length],
    queryFn: () => service.progress(room!.name, pool),
    enabled: inRoom && poolReady,
    refetchInterval: pollMs,
  })
  // The shared budget is split evenly between the players still in the room; the first players (by join order)
  // get the extra cells: 10 cells for 3 players is 4 + 3 + 3. It grows again if someone leaves.
  const playerCount = Math.max(1, info.players.length)
  const myRank = Math.max(0, info.players.findIndex((p) => p.id === me?.id))
  const quota = inRoom && poolReady ? Math.floor(pool.length / playerCount) + (myRank < pool.length % playerCount ? 1 : 0) : 0
  const closed = inRoom && room.labeling_closed === true
  // Not everyone has answered everything yet: the host may still continue, but only after confirming.
  const unfinished = inRoom && poolReady && progress.data?.done !== true && !closed
  const labeledCount = inRoom ? (progress.data?.labeled ?? 0) : Object.keys(results).length
  const [confirming, setConfirming] = useState(false)

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
  const [poolError, setPoolError] = useState('')
  const [index, setIndex] = useState(0)
  // The cells this player has answered in the room (saved labels, plus answers given since the page opened).
  const [roomDone, setRoomDone] = useState<ReadonlySet<string>>(new Set())

  const published = useRef(false)
  useEffect(() => {
    if (!inRoom || !isHost || poolReady || !hasFolds || !pipeline || published.current) return
    published.current = true
    void (async () => {
      try {
        const { keys } = await fetchCandidates(pipeline)
        if (keys.length === 0) {
          setPoolError(t().labeling.noCellsToLabel)
          return
        }
        await service.publishPool(room, me.id, pipeline, keys)
        await refresh()
      } catch (e) {
        published.current = false
        setRoomError(e instanceof Error ? e.message : t().labeling.publishFailed)
      }
    })()
  }, [inRoom, isHost, poolReady, hasFolds, pipeline, room, me, service, refresh])

  // The host came back after continuing early: open labeling again so the remaining cards can be swiped. The steps
  // after it are not redone automatically; pressing Continue again runs them with the new labels.
  // Only when it was already closed on arrival: closing it from here (Continue) must not undo itself.
  const reopened = useRef(false)
  const closedOnArrival = useRef<boolean | null>(null)
  if (inRoom && closedOnArrival.current === null) closedOnArrival.current = room.labeling_closed === true
  useEffect(() => {
    if (!inRoom || !isHost || !closedOnArrival.current || room.labeling_closed !== true || reopened.current) return
    reopened.current = true
    service
      .reopenLabeling(room, me.id)
      .then(() => refresh())
      .catch((e) => {
        reopened.current = false
        setRoomError(e instanceof Error ? e.message : t().labeling.loadFailed)
      })
  }, [inRoom, isHost, room, me, service, refresh])

  const roomCardsRef = useRef(roomCards)
  roomCardsRef.current = roomCards
  /** Claims and loads the next card for this player; resolves to whether a new card was added. */
  const loadNext = async (quiet = false): Promise<boolean> => {
    if (!room || !me || !pipeline) return false
    if (roomCardsRef.current.length >= quota) {
      setExhausted(true) // this player's share is done
      return false
    }
    if (!quiet) setLoadingNext(true)
    try {
      const key = await service.claimNext(
        room.name,
        me.id,
        pool,
        new Set(roomCardsRef.current.map((c) => c.key)),
      )
      if (key === null) {
        setExhausted(true)
        return false
      }
      if (roomCardsRef.current.some((c) => c.key === key)) return false
      const [fetched] = await fetchCards(pipeline, [key])
      if (fetched) setRoomCards((l) => (l.some((c) => c.key === fetched.key) ? l : [...l, fetched]))
      return !!fetched
    } catch (e) {
      setRoomError(e instanceof Error ? e.message : t().labeling.loadNextFailed)
      return false
    } finally {
      if (!quiet) setLoadingNext(false)
    }
  }

  const started = useRef(false)
  useEffect(() => {
    if (!inRoom || !poolReady || !pipeline || !roomStarted || started.current) return
    started.current = true
    void (async () => {
      try {
        // Cards this player already answered come first, so a reload keeps order.
        const inPool = new Set(pool)
        // In a room only this player's saved room labels count; stale solo verdicts in the session do not.
        const mine = (await service.roomLabels(room.name)).filter((l) => l.player === me.id)
        const answered = [...new Set(mine.map((l) => l.cell_id).filter((k) => inPool.has(k)))]
        setRoomDone(new Set(answered))
        if (answered.length > 0) {
          const seeded = await fetchCards(pipeline, answered)
          setRoomCards(seeded)
          roomCardsRef.current = seeded
          setIndex(seeded.length)
        }
        const added = await loadNext()
        // Every cell already answered: start at the first card (the host can review or just continue) rather than
        // one past the last. A helper who is done keeps the "you're done" end state.
        if (answered.length > 0 && !added && isHost) setIndex(0)
      } catch (e) {
        setRoomError(e instanceof Error ? e.message : t().labeling.loadFailed)
      } finally {
        setRoomLoaded(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRoom, poolReady, pipeline, roomStarted])

  // A cell left behind by someone who left would block the room forever: whoever is out of cards re-checks for freed
  // cells each time the progress refreshes, and picks one up.
  const checkedAt = useRef(0)
  useEffect(() => {
    if (!exhausted || loadingNext || !progress.data || progress.data.done) return
    if (checkedAt.current === progress.dataUpdatedAt) return
    checkedAt.current = progress.dataUpdatedAt
    void loadNext(true) // quiet: the screen should not flicker on every check
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exhausted, loadingNext, progress.data, progress.dataUpdatedAt])

  const list = roomName ? roomCards : (soloCards.data ?? [])
  const loaded = roomName ? roomLoaded || !!poolError : soloCards.data !== undefined

  const positioned = useRef(false)
  useEffect(() => {
    if (soloCards.data && !positioned.current) {
      positioned.current = true
      const first = soloCards.data.findIndex((c) => !(c.key in results))
      setIndex(first === -1 ? 0 : first) // everything answered: start over at the first card, not past the end
    }
  }, [soloCards.data, results])

  const shownAt = useRef(Date.now())
  useEffect(() => {
    shownAt.current = Date.now()
  }, [index])

  const deck = useRef<SwipeDeckHandle>(null)
  const [inspect, setInspect] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  // Full screen mode: the page covers the whole window (CSS, so it also works where the browser has no Fullscreen API,
  // e.g. iPhones) and, where available, the browser goes full screen too. Esc leaves both.
  const [full, setFull] = useState(false)
  const enterFull = () => {
    setFull(true)
    try {
      void document.documentElement.requestFullscreen?.()?.catch(() => {})
    } catch {
      /* the CSS mode alone is fine */
    }
  }
  const exitFull = () => {
    setFull(false)
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    if (!full) return
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false) // the browser left full screen (Esc)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitFull()
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('keydown', onKey)
    }
  }, [full])
  useEffect(() => () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}) // leaving the page leaves full screen
  }, [])
  useEffect(() => setInspect(false), [index]) // a new card starts un-inspected
  // Fetch the tables of the next few cards while the current one is being answered, so none of them loads on screen.
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!dataset) return
    for (const next of list.slice(index + 1, index + 4)) void queryClient.prefetchQuery(excerptQuery(dataset, next))
  }, [dataset, list, index, queryClient])
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId, pollMs)
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (job.state !== 'done' || !jobId || handled.current === jobId) return
    handled.current = jobId
    const disputed = (job.result as { disputed?: string[] } | undefined)?.disputed ?? []
    // The labels (and the propagation just run) belong to `pipeline`, which in a room is the room's pipeline.
    // Every later step reads the session's pipeline, so make the two the same before moving on.
    void session
      .update({ room_disputed_cells: disputed, ...(pipeline ? { pipeline_path: pipeline } : {}) })
      .then(() => navigate('/labeling-stats'))
  }, [job.state, job.result, jobId, session, navigate, pipeline])

  if (!session.ready) return <h1>Labeling</h1>
  if (roomName && token && !info.settled) {
    return (
      <>
        <h1>Labeling</h1>
        <Loading>{l.loadingRoom}</Loading>
      </>
    )
  }
  if (roomName && token && !inRoom) {
    return (
      <>
        <h1>Labeling</h1>
        <Notice kind="warn">{l.couldNotReach}</Notice>
        <Link to="/lobby">{l.backToLobby}</Link>
      </>
    )
  }
  if (inRoom && room.phase === 'lobby') {
    return (
      <>
        <h1>Labeling</h1>
        <Notice kind="warn">{l.roomNotStarted}</Notice>
        <Link to="/lobby">{l.backToLobby}</Link>
      </>
    )
  }
  if (inRoom && !isHost && !poolReady) return <WaitingForLabeling players={info.players} />
  if (!pipeline) {
    return (
      <>
        <h1>Labeling</h1>
        <Prereq title={l.prereqTitle} to="/configuration" action={l.backToConfig}>{l.prereqText}</Prereq>
      </>
    )
  }
  if (config.data && !hasFolds) {
    return (
      <div className="labeling-page">
        <div className="labeling-head">
          <h1>Labeling</h1>
        </div>
        <Prereq title={l.foldsTitle} to="/quality-folding" action={l.foldsAction}>
          {l.foldsText}
        </Prereq>
        <div className="nav-row">
          <Link className="btn btn-ghost" to="/quality-folding">
            {l.back}
          </Link>
        <StepSlot />
          <span className="btn btn-primary" role="link" aria-disabled="true" title={l.foldsTitle}>
            {l.continue}
          </span>
        </div>
      </div>
    )
  }

  const answer = async (correct: boolean) => {
    const card = list[index]
    if (!card) return
    setShowInfo(false)
    const latency = Date.now() - shownAt.current
    const atFrontier = index === list.length - 1
    void session.update({ labeling_results: { ...results, [card.key]: correct } })
    setIndex((i) => Math.min(i + 1, list.length))
    if (!inRoom) return
    setRoomDone((s) => new Set(s).add(card.key))
    setWarning('')
    let isCorrect: boolean | null = null
    try {
      ;[isCorrect] = await judgeVerdicts(dataset, [
        { table: card.table, row: card.row, col: card.col, said_correct: correct },
      ])
    } catch {
      setWarning(t().labeling.shareFailedCheck)
    }
    try {
      await service.saveLabel(room.name, me.id, card.key, correct, isCorrect, latency)
    } catch {
      setWarning(t().labeling.shareFailed)
    }
    if (atFrontier && !exhausted) await loadNext()
  }

  const confirmContinue = async () => {
    setError('')
    try {
      await service.closeLabeling(room!, me!.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : t().labeling.stopFailed)
      return
    }
    setConfirming(false)
    await next()
  }

  const next = async () => {
    setError('')
    const toOwn = (verdicts: Verdicts) =>
      list
        .filter((c) => c.key in verdicts)
        .map((c) => ({
          table: c.table, row: c.row, col: c.col, val: c.val, is_error: !verdicts[c.key],
          domain_fold: c.domain_fold, cell_fold: c.cell_fold,
        }))
    try {
      if (inRoom) {
        const labels = await service.roomLabels(room.name)
        // Room mode: this player's verdicts are the ones saved in the room, not the session's (possibly stale) results.
        const mine: Verdicts = {}
        for (const l of labels) if (l.player === me.id) mine[l.cell_id] = l.value
        const own = toOwn(mine)
        setJobId(
          await startPropagation(pipeline, {
            own,
            room_labels: labels.map((l) => ({ cell_id: l.cell_id, player: l.player, value: l.value })),
            player_id: me.id,
          }),
        )
      } else {
        setJobId(await startPropagation(pipeline, { own: toOwn(results) }))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t().labeling.propagationFailed)
    }
  }

  const card = closed ? undefined : list[index]
  const loadError = soloCards.isError ? (soloCards.error as Error).message : roomError

  // How many cards have a verdict (not the position in the deck, which differs after going back or stopping early).
  const answeredCount = inRoom ? list.filter((c) => roomDone.has(c.key)).length : list.filter((c) => c.key in results).length
  // A helper with nothing left to label (their share is done, or the host ended labeling) gets one calm end screen.
  const guestDone = inRoom && !isHost && loaded && !card && !loadingNext && (exhausted || closed)
  // In a room only the cards claimed so far are loaded, so the total is this player's share of the shared budget.
  const total = inRoom ? Math.max(quota, list.length) : list.length
  const pct = total > 0 ? Math.round((answeredCount / total) * 100) : 0

  if (guestDone) {
    return (
      <div className="labeling-page">
        <div className="labeling-head">
          <h1>Labeling</h1>
        </div>
        <EmptyState
          done
          title={l.doneTitle}
          note={progress.data && !closed && !progress.data.done ? l.doneProgress(progress.data.labeled, progress.data.total) : undefined}
          icon={<CheckIcon />}
        >
          {closed ? l.doneClosedText(answeredCount) : l.doneText(answeredCount)}
        </EmptyState>
        {/* no buttons: a helper's screen moves on when the host does */}
      </div>
    )
  }

  return (
    <div
      className={`labeling-page${full ? ' is-full' : ''}`}
      onPointerDownCapture={(e) => {
        // Touching anything below the info panel (the card, inspect, verdicts, back, continue) dismisses it.
        const t = e.target as HTMLElement
        if (showInfo && !t.closest('.info-btn, .labeling-info, .labeling-head')) setShowInfo(false)
      }}
    >
      <div className="labeling-head">
        <h1>Labeling</h1>
        <button
          type="button"
          className={`info-btn${full ? ' on' : ''}`}
          aria-label={full ? l.exitFull : l.full}
          aria-pressed={full}
          onClick={() => (full ? exitFull() : enterFull())}
        >
          <FullscreenIcon exit={full} />
        </button>
        <button
          type="button"
          className={`info-btn${showInfo ? ' on' : ''}`}
          aria-label={l.info}
          aria-expanded={showInfo}
          aria-controls="labeling-info"
          onClick={() => setShowInfo(!showInfo)}
        >
          <InfoIcon />
        </button>
      </div>
      {list.length > 0 && (
        <>
          <p className="deck-progress">{l.labeled(answeredCount, total)}</p>
          <div className="lp-bar" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
      {showInfo && (
        <InfoPopup title={l.infoTitle} onClose={() => setShowInfo(false)} id="labeling-info" testId="labeling-info">
          <p>{l.infoIntro}</p>
          <h3>{l.answerTitle}</h3>
          <ul>
            <li>{l.swipeRightA}<b>{l.right}</b>{l.swipeRightB}<b>{l.correct}</b>.</li>
            <li>{l.swipeLeftA}<b>{l.left}</b>{l.swipeLeftB}<b>{l.wrong}</b>.</li>
            <li>{l.keyboardA}<kbd>←</kbd> <kbd>→</kbd>{l.keyboardB}</li>
          </ul>
          {inRoom && (
            <>
              <h3>{l.yourRoom}</h3>
              <p>
                {l.roomA}<b>{room.name}</b>{l.roomB}<b>{me.name}</b>{l.roomC}
              </p>
            </>
          )}
        </InfoPopup>
      )}
      {poolError && <Notice kind="error">{poolError}</Notice>}
      {loadError && <Notice kind="error">{loadError}</Notice>}
      {!loaded && !loadError && !poolError && <Loading>{l.loadingCells}</Loading>}
      {warning && <Notice kind="warn">{warning}</Notice>}
      {inRoom && isHost && exhausted && !closed && <Notice kind="info">{l.allClaimed}</Notice>}

      {!inRoom && soloCards.data && list.length === 0 && (
        <Notice kind="info">{l.allFolded}</Notice>
      )}

      {list.length > 0 && (
        <>
          <SwipeDeck
            ref={deck}
            items={list}
            index={index}
            disabled={!card}
            dragLocked={inspect}
            enterFrom={(c) => (c.key in results ? (results[c.key] ? 'right' : 'left') : undefined)}
            onSwipe={(direction) => void answer(direction === 'right')}
            renderCard={(c, depth) => <CardFace card={c} dataset={dataset} depth={depth} inspect={inspect} />}
          />
          <div className="deck-tools">
            <button
              type="button"
              className={`inspect-btn${inspect ? ' on' : ''}`}
              aria-pressed={inspect}
              disabled={!card}
              onClick={() => setInspect(!inspect)}
            >
              {inspect ? l.doneInspecting : l.inspectTable}
            </button>
          </div>
          {inspect && (
            <p className="deck-hint">{l.inspectHint}</p>
          )}
          <div className="verdict-buttons">
            <button type="button" className="round round-error" aria-label="Error" disabled={!card} onClick={() => deck.current?.swipe('left')}>
              <CrossIcon />
              <kbd aria-hidden="true">←</kbd>
            </button>
            <button
              type="button"
              className="round round-back"
              aria-label={l.goBack}
              disabled={index === 0 || list.length === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              <BackIcon />
            </button>
            <button type="button" className="round round-correct" aria-label="Correct" disabled={!card} onClick={() => deck.current?.swipe('right')}>
              <CheckIcon />
              <kbd aria-hidden="true">→</kbd>
            </button>
          </div>
        </>
      )}
      {/* no "all answered" / "labeling closed" hints: the progress bar and the Continue button say it already.
          No spinner while propagating either: the button is disabled meanwhile; only failures are shown. */}
      {job.state !== 'running' && <JobStatus state={job.state} error={job.error} />}
      {error && <Notice kind="error">{error}</Notice>}

      {/* a helper has no buttons: their screen moves on when the host does */}
      {(!inRoom || isHost) && (
        <div className="nav-row">
          <Link className="btn btn-ghost" to="/quality-folding">
            {l.back}
          </Link>
          <StepSlot />
          <div className="row">
            <Button loading={job.state === 'running'} disabled={!loaded || (list.length > 0 && labeledCount === 0)}
              onClick={() => (unfinished ? setConfirming(true) : void next())}
            >
              {l.continue}
            </Button>
          </div>
        </div>
      )}

      {confirming && (
        <div className="confirm-backdrop">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <h2 id="confirm-title">{l.confirmTitle}</h2>
            <p>{l.confirmText(progress.data?.labeled ?? 0, progress.data?.total ?? 0)}</p>
            <div className="row">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {l.keepLabeling}
              </Button>
              <Button onClick={() => void confirmContinue()}>{l.continueEveryone}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
