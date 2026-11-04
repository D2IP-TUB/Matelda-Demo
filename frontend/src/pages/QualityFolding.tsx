import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { CutToggle, DomainBox, DragGhost, FoldBox, Modal, Seam, ToolToggle, useCutMode, useDragController } from '../components/foldBoard'
import type { DragController } from '../components/foldBoard'
import { BudgetField, StrategyChecklist } from '../components/forms'
import { Button, Card, InfoButton, JobStatus, Notice, Prereq } from '../components/ui'
import { StepSlot } from '../components/StepSlot'
import { t, useT } from '../i18n'
import { useJob } from '../jobs/useJob'
import {
  fetchCellFolds,
  fetchDirtyPage,
  fetchFoldCells,
  fetchPipeline,
  fetchStrategies,
  mergeCellFolds,
  mergeDomains,
  moveCell,
  moveFoldToDomain,
  setFoldLabel,
  splitCellFold,
  splitDomain,
  startQualityFolding,
} from '../lib/api'
import type { CellRef, CellView, FoldSummary } from '../lib/api'
import { useSession } from '../session/SessionProvider'
import '../styles/pages/quality-folding.css'

const PAGE = 10

/** The domain is shown once on its rectangle, so inside it a fold is just "Cell Fold 0". */
const tailOf = (f: FoldSummary) => (f.name.includes(' / ') ? f.name.slice(f.name.lastIndexOf(' / ') + 3) : f.name)
/** A fold moved in from another domain keeps its full name when its short name would clash with a neighbour. */
const shortName = (f: FoldSummary, siblings: FoldSummary[]) =>
  siblings.some((o) => o !== f && tailOf(o) === tailOf(f)) ? f.name : tailOf(f)

/** What a chip shows: just the value; its origin (table, column, row) is in the details popup. */
const valueOf = (c: CellView) => (c.val === null || c.val === undefined || c.val === '' ? t().qualityFolding.empty : String(c.val))

const refOf = (c: CellRef | CellView): CellRef => ({ table: c.table, row: c.row, col: c.col })
const keyOf = (c: CellRef) => `${c.table}|${c.row}|${c.col}`

/** A cell dragged to another fold, shown there before the server has answered. */
type Moved = { cell: CellView; from: string; to: string; done: boolean }
/** A change on its way to the server, with how the folds look once it is through. */
type Pending = { id: number; preview: (folds: FoldSummary[]) => FoldSummary[] }

const recount = (folds: FoldSummary[], fold: string, by: number) =>
  folds.map((f) => (f.name === fold ? { ...f, cell_count: f.cell_count + by } : f))
const mergePreview = (target: string, source: string) => (folds: FoldSummary[]) => {
  const gone = folds.find((f) => f.name === source)
  return gone ? recount(folds.filter((f) => f !== gone), target, gone.cell_count) : folds
}

/** Every fold of `source` joins the end of `target`, as the server does it. */
const mergeDomainPreview = (target: string, source: string) => (folds: FoldSummary[]) => {
  const moving = folds.filter((f) => f.domain === source).map((f) => ({ ...f, domain: target }))
  const rest = folds.filter((f) => f.domain !== source)
  const at = rest.map((f) => f.domain).lastIndexOf(target) + 1
  return at === 0 ? folds : [...rest.slice(0, at), ...moving, ...rest.slice(at)]
}

function FoldCells({
  pipeline,
  fold,
  cellCount,
  shownCount,
  moved,
  dnd,
  cutting,
  onCut,
  onOpen,
}: {
  pipeline: string
  fold: string
  /** The size the server reports; a change of it reloads the cells. */
  cellCount: number
  /** The size on screen, with changes still on their way. */
  shownCount: number
  moved: Map<string, Moved>
  dnd: DragController
  cutting: boolean
  onCut: (cell: CellView) => void
  onOpen: (cell: CellView) => void
}) {
  const q = useT().qualityFolding
  const [cells, setCells] = useState<CellView[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const loaded = useRef(0)
  loaded.current = cells.length

  // Load the first page, and reload (quietly, the old cells stay on screen) whenever the fold's size changes,
  // i.e. after a cell was moved in or out. Cells already shown with "Show more" are kept.
  useEffect(() => {
    let current = true
    const limit = Math.min(200, Math.max(PAGE, loaded.current))
    fetchFoldCells(pipeline, fold, 0, limit)
      .then((page) => {
        if (!current) return
        setCells(page.cells)
        setTotal(page.total)
        setError('')
      })
      .catch((e) => current && setError(e instanceof Error ? e.message : t().qualityFolding.loadCellsFailed))
    return () => {
      current = false
    }
  }, [pipeline, fold, cellCount])

  const totalRef = useRef(0)
  totalRef.current = total
  const loading = useRef(false)
  const list = useRef<HTMLUListElement | null>(null)

  // No "show more" button: the next page loads by itself when the list is scrolled near its end.
  const more = async () => {
    if (loading.current || loaded.current >= totalRef.current) return
    loading.current = true
    try {
      const page = await fetchFoldCells(pipeline, fold, loaded.current, PAGE)
      setCells((prev) => [...prev, ...page.cells])
      setTotal(page.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : t().qualityFolding.loadCellsFailed)
    } finally {
      loading.current = false
    }
  }
  const nearEnd = (el: HTMLElement) => el.scrollHeight > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 60

  // The bottom of the list is greyed out while there is more to scroll to: cells below the visible part, or cells
  // not loaded yet. It clears once the very end is reached.
  const [hasMore, setHasMore] = useState(false)
  const checkMore = () => {
    const el = list.current
    if (!el) return
    setHasMore(loaded.current < totalRef.current || el.scrollTop + el.clientHeight < el.scrollHeight - 2)
  }
  useLayoutEffect(checkMore, [cells, total])

  // cells dragged in show up first, cells dragged out disappear, whether or not the server has answered yet
  const movedIn = [...moved.values()].filter((m) => m.to === fold && !cells.some((c) => keyOf(c) === keyOf(m.cell)))
  const shown = [
    ...movedIn.map((m) => m.cell),
    ...cells.filter((c) => {
      const m = moved.get(keyOf(c))
      return !m || m.to === fold
    }),
  ]
  const hidden = Math.max(0, shownCount - shown.length)

  return (
    <div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className={`cells-scroll${hasMore ? ' has-more' : ''}`}>
      <ul
        className="chips scroll"
        ref={list}
        onScroll={(e) => {
          checkMore()
          if (nearEnd(e.currentTarget)) void more()
        }}
      >
        {shown.map((cell, i) => (
          <li key={keyOf(cell)}>
            <button
              type="button"
              className="chip"
              data-testid="cell"
              title={q.clickDetails}
              {...dnd.source({ kind: 'item', fold, item: cell }, valueOf(cell))}
              onClick={() => onOpen(cell)}
            >
              {valueOf(cell)}
            </button>
            {i < shownCount - 1 && (
              <Seam
                cutting={cutting}
                label={q.splitCellAfter(fold, cell.table, cell.row, cell.col)}
                onCut={() => onCut(cell)}
              />
            )}
          </li>
        ))}
        {hidden > 0 && (
          <li className="more-row" aria-hidden="true">
            {q.scrollMore(hidden)}
          </li>
        )}
      </ul>
      </div>
    </div>
  )
}

function CellDialog({
  dataset,
  cell,
  onClose,
}: {
  dataset: string
  cell: CellView
  onClose: () => void
}) {
  const q = useT().qualityFolding
  const start = Math.max(0, cell.row - 5)
  const excerpt = useQuery({
    queryKey: ['excerpt', dataset, cell.table, start],
    queryFn: () => fetchDirtyPage(dataset, cell.table, start, 11),
  })
  const data = excerpt.data
  const diff = data
    ? data.rows.map((_, r) => data.columns.map((c) => start + r === cell.row && c === cell.col))
    : undefined
  return (
    <Modal label={q.cellDetails} onClose={onClose}>
      <h2>{q.detailsFor(valueOf(cell))}</h2>
      <dl className="origin">
        <dt>{q.value}</dt>
        <dd>{valueOf(cell)}</dd>
        <dt>{q.table}</dt>
        <dd>
          <code>{cell.table}</code>
        </dd>
        <dt>{q.column}</dt>
        <dd>
          <code>{cell.col}</code>
        </dd>
        <dt>{q.row}</dt>
        <dd>{cell.row}</dd>
      </dl>
      <h3>{q.detectionResults}</h3>
      {cell.strategies.length > 0 ? (
        <ul>
          {cell.strategies.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ) : (
        <p>{q.passedAll}</p>
      )}
      <h3>{q.excerpt}</h3>
      {excerpt.isError && <Notice kind="error">{(excerpt.error as Error).message}</Notice>}
      {data && <DataTable columns={data.columns} rows={data.rows} diff={diff} highlight="dirty" />}
      <Button variant="ghost" onClick={onClose}>
        {q.close}
      </Button>
    </Modal>
  )
}

export function QualityFolding({ pollMs = 1000 }: { pollMs?: number }) {
  const tr = useT()
  const q = tr.qualityFolding
  const session = useSession()
  const queryClient = useQueryClient()
  const pipeline = session.data.pipeline_path as string | undefined

  const config = useQuery({
    queryKey: ['pipeline', pipeline],
    queryFn: () => fetchPipeline(pipeline as string),
    enabled: !!pipeline,
  })
  const strategies = useQuery({ queryKey: ['strategies'], queryFn: fetchStrategies })
  const hasDomainFolds = !!config.data && Object.keys((config.data.domain_folds as object) ?? {}).length > 0
  const cellFolds = useQuery({
    queryKey: ['cellFolds', pipeline],
    queryFn: () => fetchCellFolds(pipeline as string),
    enabled: !!pipeline && config.data?.has_cell_folds === true,
  })

  const [budget, setBudget] = useState<number | null>(null)
  const [chosen, setChosen] = useState<string[] | null>(null)
  const effectiveBudget = budget ?? config.data?.labeling_budget ?? 10
  const selected = chosen ?? config.data?.selected_strategies ?? []

  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId, pollMs)
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (job.state === 'done' && jobId && handled.current !== jobId) {
      handled.current = jobId
      void queryClient.invalidateQueries({ queryKey: ['pipeline', pipeline] })
      void queryClient.invalidateQueries({ queryKey: ['cellFolds', pipeline] })
      setVersion((v) => v + 1)
    }
  }, [job.state, jobId, pipeline, queryClient])

  const dnd = useDragController()
  const [cutting, setCutting] = useCutMode()
  // Bulk annotation shows the ✓ ✗ ↩ buttons on every fold; unlike split mode it stays on until toggled off.
  const [annotating, setAnnotating] = useState(false)
  // changes go to the server one after the other, never two at once and never dropped; the screen shows them at once
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const seq = useRef(0)
  const [pending, setPending] = useState<Pending[]>([])
  const [moved, setMoved] = useState<Map<string, Moved>>(new Map())
  const [open, setOpen] = useState<CellView | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')

  if (!session.ready) return <div className="quality-page"><h1>Quality Folding</h1></div>
  if (!pipeline) {
    return (
      <div className="quality-page">
        <h1>Quality Folding</h1>
        <Prereq title={q.prereqTitle} to="/configuration" action={q.backToConfig}>{q.prereqText}</Prereq>
      </div>
    )
  }
  const blocked = !!config.data && !hasDomainFolds // shown, but greyed out until domain based folding has run

  const edit = (
    fn: () => Promise<FoldSummary[]>,
    opts: { preview?: (folds: FoldSummary[]) => FoldSummary[]; move?: Omit<Moved, 'done'> } = {},
  ): Promise<boolean> => {
    const id = ++seq.current
    const { preview, move } = opts
    if (preview) setPending((p) => [...p, { id, preview }])
    if (move) setMoved((all) => new Map(all).set(keyOf(move.cell), { ...move, done: false }))
    setError('')
    const send = async () => {
      try {
        // the server answers with the new folds, so show them at once instead of waiting for a refetch
        queryClient.setQueryData(['cellFolds', pipeline], await fn())
        setMoved((all) => {
          const next = new Map(all)
          if (move) next.set(keyOf(move.cell), { ...move, done: true })
          // other changes reshuffle whole folds, and the reloaded cells already show the earlier moves
          else for (const [k, m] of next) if (m.done) next.delete(k)
          return next
        })
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : q.saveFailed)
        if (move) setMoved((all) => {
          const next = new Map(all)
          if (next.get(keyOf(move.cell))?.to === move.to) next.delete(keyOf(move.cell))
          return next
        })
        await queryClient.invalidateQueries({ queryKey: ['cellFolds', pipeline] }) // show what the server really has
        return false
      } finally {
        setPending((p) => p.filter((x) => x.id !== id))
      }
    }
    const result = queue.current.then(send)
    queue.current = result
    return result
  }

  const run = async () => {
    setError('')
    try {
      setJobId(
        await startQualityFolding(pipeline, {
          labeling_budget: effectiveBudget,
          selected_strategies: selected,
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : q.startFailed)
    }
  }

  const serverFolds: FoldSummary[] = cellFolds.data ?? []
  const serverCount = new Map(serverFolds.map((f) => [f.name, f.cell_count]))
  const folds = pending.reduce((all, p) => p.preview(all), serverFolds)
  const setLabel = (fold: string, label: 'correct' | 'false' | null) =>
    void edit(() => setFoldLabel(pipeline, fold, label), {
      preview: (all) => all.map((f) => (f.name === fold ? { ...f, label: label ?? 'neutral' } : f)),
    })
  const domains = [...new Set(folds.map((f) => f.domain))]
  const byDomain = Object.fromEntries(domains.map((d) => [d, folds.filter((f) => f.domain === d)]))

  return (
    <div className="quality-page">
      <header className="qp-head">
        <div className="title-row">
          <h1>Quality Folding</h1>
        <InfoButton label={q.infoLabel} title="Quality folding">
          <p>
            {q.introA}<b>{q.introFolds}</b>{q.introB}
          </p>
          <h3>{q.editTitle}</h3>
          <ul>
            <li><b>{q.move}</b>{q.moveText}</li>
            <li><b>{q.merge}</b>{q.mergeA}<b>⠿</b>{q.mergeB}</li>
            <li>
              <b>{q.split}</b>{q.splitA}<b>{`✂ ${tr.shell.splitFolds}`}</b>{q.splitB}
            </li>
            <li><b>{q.inspect}</b>{q.inspectText}</li>
          </ul>
          <h3>{q.markTitle}</h3>
          <p>{q.markA}<b>{`✓ ${q.bulkAnnotate}`}</b>{q.markB}</p>
          <ul>
            <li><b>✓</b>{q.markOr}<b>✗</b>{q.markWhole}</li>
            <li><b>↩</b>{q.markBack}</li>
          </ul>
        </InfoButton>
        </div>
        <p className="qp-lede">{q.lead}</p>
      </header>

      {blocked && (
        <Prereq title={q.blockedTitle} to="/domain-folding" action={q.blockedAction}>
          {q.blockedText}
        </Prereq>
      )}

      <Card title={q.settings}>
        <fieldset className="qp-fieldset" disabled={blocked}>
        <section className="qp-group" aria-labelledby="qp-budget-h">
          <h3 id="qp-budget-h" className="qp-group-title">{q.budget}</h3>
          <BudgetField value={effectiveBudget} onChange={setBudget} />
        </section>
        <section className="qp-group" aria-labelledby="qp-strategies-h">
          <h3 id="qp-strategies-h" className="qp-group-title">{q.strategies}</h3>
          <StrategyChecklist
            strategies={strategies.data ?? []}
            selected={selected}
            onChange={setChosen}
            error={strategies.isError}
            loading={strategies.isLoading}
          />
        </section>
        <Button
          onClick={() => void run()}
          loading={job.state === 'running'}
          disabled={blocked || selected.length === 0 || !config.data}
        >
          {q.run}
        </Button>
        <JobStatus state={job.state} error={job.error} />
        </fieldset>
      </Card>

      {cellFolds.isError && <Notice kind="error">{(cellFolds.error as Error).message}</Notice>}

      {folds.length > 0 && (
        <>
          <CutToggle
            on={cutting}
            onToggle={() => setCutting((c) => !c)}
            hint={q.cutHint}
          >
            <ToolToggle on={annotating} onToggle={() => setAnnotating((a) => !a)} icon="✓">
              {q.bulkAnnotate}
            </ToolToggle>
          </CutToggle>
          <div className={`domain-grid${cutting ? ' cutting' : ''}`}>
          {domains.map((domain) => (
            <DomainBox
              key={domain}
              name={domain}
              title={domain}
              dnd={dnd}
              onDropFold={(fold) =>
                void edit(() => moveFoldToDomain(pipeline, fold, domain), {
                  preview: (all) => all.map((f) => (f.name === fold ? { ...f, domain } : f)),
                })
              }
              onMergeDomain={(source) =>
                void edit(() => mergeDomains(pipeline, source, domain), {
                  preview: mergeDomainPreview(domain, source),
                })
              }
            >
              <div className="fold-grid inner">
              {byDomain[domain].map((fold, index) => (
                  <FoldBox<CellView>
                    key={fold.name}
                    name={fold.name}
                    domain={domain}
                    dnd={dnd}
                    onDropItem={(cell, from) =>
                      void edit(() => moveCell(pipeline, refOf(cell), fold.name), {
                        preview: (all) => recount(recount(all, from, -1), fold.name, 1),
                        move: { cell, from, to: fold.name },
                      })
                    }
                    onMergeFold={(source) =>
                      void edit(() => mergeCellFolds(pipeline, [fold.name, source]), {
                        preview: mergePreview(fold.name, source),
                      })
                    }
                    header={
                      <>
                        <span className={`fold-name label-${fold.label}`}>{shortName(fold, byDomain[domain])}</span>
                        <span>{q.cellsCount(fold.cell_count)}</span>
                        {annotating && <span className="fold-marks">
                          <Button
                            variant="ghost"
                            aria-label={q.markCorrect(fold.name)}
                            title={q.titleCorrect}
                            onClick={() => setLabel(fold.name, 'correct')}
                          >
                            ✓
                          </Button>
                          <Button
                            variant="ghost"
                            aria-label={q.markFalse(fold.name)}
                            title={q.titleFalse}
                            onClick={() => setLabel(fold.name, 'false')}
                          >
                            ✗
                          </Button>
                          <Button
                            variant="ghost"
                            aria-label={q.clearLabel(fold.name)}
                            title={q.titleClear}
                            disabled={!fold.label}
                            onClick={() => setLabel(fold.name, null)}
                          >
                            ↩
                          </Button>
                        </span>}
                      </>
                    }
                  >
                    <FoldCells
                      key={`${fold.name}-${version}`}
                      pipeline={pipeline}
                      fold={fold.name}
                      cellCount={serverCount.get(fold.name) ?? fold.cell_count}
                      shownCount={fold.cell_count}
                      moved={moved}
                      dnd={dnd}
                      cutting={cutting}
                      onCut={(cell) => void edit(() => splitCellFold(pipeline, fold.name, [refOf(cell)]))}
                      onOpen={setOpen}
                    />
                    {index < byDomain[domain].length - 1 && (
                      <Seam
                        cutting={cutting}
                        spacer={false}
                        className="fold-seam"
                        label={q.splitDomainAfter(domain, fold.name)}
                        title={q.splitDomainTitle}
                        onCut={() => void edit(() => splitDomain(pipeline, domain, fold.name))}
                      />
                    )}
                  </FoldBox>
                ))}
              </div>
            </DomainBox>
          ))}
          </div>
        </>
      )}

      <DragGhost dnd={dnd} />

      {open && config.data && (
        <CellDialog dataset={config.data.selected_dataset} cell={open} onClose={() => setOpen(null)} />
      )}

      {error && <Notice kind="error">{error}</Notice>}

      <div className="nav-row">
        <Link className="btn btn-ghost" to="/domain-folding">
          {q.back}
        </Link>
        <StepSlot />
        {blocked || folds.length === 0 ? (
          <span
            className="btn btn-primary"
            role="link"
            aria-disabled="true"
            title={blocked ? q.blockedTitle : q.runFirstQuality}
          >
            {q.continue}
          </span>
        ) : (
          <Link className="btn btn-primary" to="/labeling">
            {q.continue}
          </Link>
        )}
      </div>
    </div>
  )
}
