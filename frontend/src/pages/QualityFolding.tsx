import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { CutButton, DragGhost, FoldBox, Modal, useDragController } from '../components/foldBoard'
import type { DragController } from '../components/foldBoard'
import { BudgetField, StrategyChecklist } from '../components/forms'
import { Button, Card, JobStatus, Notice } from '../components/ui'
import { useJob } from '../jobs/useJob'
import {
  fetchCellFolds,
  fetchDirtyPage,
  fetchFoldCells,
  fetchPipeline,
  fetchStrategies,
  mergeCellFolds,
  moveCell,
  setFoldLabel,
  splitCellFold,
  startQualityFolding,
} from '../lib/api'
import type { CellRef, CellView, FoldSummary } from '../lib/api'
import { useSession } from '../session/SessionProvider'

const PAGE = 20

const refOf = (c: CellRef | CellView): CellRef => ({ table: c.table, row: c.row, col: c.col })

function FoldCells({
  pipeline,
  fold,
  dnd,
  onCut,
  onOpen,
}: {
  pipeline: string
  fold: string
  dnd: DragController
  onCut: (cell: CellView) => void
  onOpen: (cell: CellView) => void
}) {
  const [cells, setCells] = useState<CellView[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  const load = async (offset: number) => {
    try {
      const page = await fetchFoldCells(pipeline, fold, offset, PAGE)
      setCells((prev) => (offset === 0 ? page.cells : [...prev, ...page.cells]))
      setTotal(page.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the cells')
    }
  }
  useEffect(() => {
    void load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline, fold])

  return (
    <div>
      {error && <Notice kind="error">{error}</Notice>}
      <ul className="chips scroll">
        {cells.map((cell, i) => (
          <li key={`${cell.table}|${cell.row}|${cell.col}`}>
            <button
              type="button"
              className="chip"
              data-testid="cell"
              {...dnd.source({ kind: 'item', fold, item: cell }, `${cell.table} · ${cell.col}: ${String(cell.val)}`)}
              onClick={() => onOpen(cell)}
            >
              {`${cell.table} · row ${cell.row} · ${cell.col}: ${String(cell.val)}`}
            </button>
            {i < total - 1 && (
              <CutButton
                label={`Split ${fold} after ${cell.table} ${cell.row} ${cell.col}`}
                onCut={() => onCut(cell)}
              />
            )}
          </li>
        ))}
      </ul>
      {cells.length < total && (
        <Button variant="ghost" onClick={() => void load(cells.length)}>
          Show more
        </Button>
      )}
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
    <Modal label="Cell details" onClose={onClose}>
      <h2>{`Details for ${String(cell.val)}`}</h2>
      <p>
        Table <code>{cell.table}</code> · column <code>{cell.col}</code> · row {cell.row}
      </p>
      <h3>Error detection results</h3>
      {cell.strategies.length > 0 ? (
        <ul>
          {cell.strategies.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ) : (
        <p>This cell passed all error detection checks.</p>
      )}
      <h3>Table excerpt</h3>
      {excerpt.isError && <Notice kind="error">{(excerpt.error as Error).message}</Notice>}
      {data && <DataTable columns={data.columns} rows={data.rows} diff={diff} highlight="dirty" />}
      <Button variant="ghost" onClick={onClose}>
        Close
      </Button>
    </Modal>
  )
}

export function QualityFolding({ pollMs = 1000 }: { pollMs?: number }) {
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
  const [bulk, setBulk] = useState(false)
  const [open, setOpen] = useState<CellView | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')

  if (!session.ready) return <h1>Quality Folding</h1>
  if (!pipeline) {
    return (
      <>
        <h1>Quality Folding</h1>
        <Notice kind="warn">Pipeline not configured.</Notice>
        <Link to="/configuration">Go back to Configurations</Link>
      </>
    )
  }
  if (config.data && !hasDomainFolds) {
    return (
      <>
        <h1>Quality Folding</h1>
        <Notice kind="warn">Run domain based folding first.</Notice>
        <Link to="/domain-folding">Go to Domain Folding</Link>
      </>
    )
  }

  const edit = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError('')
    try {
      await fn()
      await queryClient.invalidateQueries({ queryKey: ['cellFolds', pipeline] })
      setVersion((v) => v + 1)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be saved')
      return false
    }
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
      setError(e instanceof Error ? e.message : 'Could not start quality folding')
    }
  }

  const folds: FoldSummary[] = cellFolds.data ?? []
  const domains = [...new Set(folds.map((f) => f.domain))]

  return (
    <>
      <h1>Quality Folding</h1>

      <Card title="Settings">
        <BudgetField value={effectiveBudget} onChange={setBudget} />
        <StrategyChecklist
          strategies={strategies.data ?? []}
          selected={selected}
          onChange={setChosen}
          error={strategies.isError}
          loading={strategies.isLoading}
        />
        <Button
          onClick={() => void run()}
          disabled={job.state === 'running' || selected.length === 0 || !config.data}
        >
          Run quality based folding
        </Button>
        <JobStatus state={job.state} error={job.error} />
      </Card>

      {cellFolds.isError && <Notice kind="error">{(cellFolds.error as Error).message}</Notice>}
      {config.data && config.data.has_cell_folds !== true && (
        <Notice kind="info">No cell folds yet. Run quality based folding to create them.</Notice>
      )}

      {folds.length > 0 && (
        <>
          <div className="row">
            <Button variant="ghost" onClick={() => setBulk(!bulk)}>
              {bulk ? 'Done annotating' : 'Bulk annotate'}
            </Button>
          </div>
          <p className="hint">
            {bulk
              ? 'Mark whole folds as correct or false; labels are used for error detection.'
              : "Drag a cell (touch: press and hold, then drag) onto another fold to move it, drag a fold's handle onto another fold to merge them, click ✂ between two cells to split, click a cell for details."}
          </p>

          {domains.map((domain) => (
            <section key={domain}>
              <h2>{domain}</h2>
              {folds
                .filter((f) => f.domain === domain)
                .map((fold) => (
                  <FoldBox<CellView>
                    key={fold.name}
                    name={fold.name}
                    dnd={dnd}
                    onDropItem={(cell) => void edit(() => moveCell(pipeline, refOf(cell), fold.name))}
                    onMergeFold={(source) => void edit(() => mergeCellFolds(pipeline, [fold.name, source]))}
                    header={
                      <>
                        <span className={`fold-name label-${fold.label}`}>{fold.name}</span>
                        <span>{`${fold.cell_count} cells`}</span>
                        {bulk && (
                          <>
                            <Button
                              variant="ghost"
                              aria-label={`Mark ${fold.name} correct`}
                              onClick={() => void edit(() => setFoldLabel(pipeline, fold.name, 'correct'))}
                            >
                              ✓
                            </Button>
                            <Button
                              variant="ghost"
                              aria-label={`Mark ${fold.name} false`}
                              onClick={() => void edit(() => setFoldLabel(pipeline, fold.name, 'false'))}
                            >
                              ✗
                            </Button>
                            <Button
                              variant="ghost"
                              aria-label={`Clear label of ${fold.name}`}
                              onClick={() => void edit(() => setFoldLabel(pipeline, fold.name, null))}
                            >
                              Clear
                            </Button>
                          </>
                        )}
                      </>
                    }
                  >
                    <FoldCells
                      key={`${fold.name}-${version}`}
                      pipeline={pipeline}
                      fold={fold.name}
                      dnd={dnd}
                      onCut={(cell) => void edit(() => splitCellFold(pipeline, fold.name, [refOf(cell)]))}
                      onOpen={setOpen}
                    />
                  </FoldBox>
                ))}
            </section>
          ))}
        </>
      )}

      <DragGhost dnd={dnd} />

      {open && config.data && (
        <CellDialog dataset={config.data.selected_dataset} cell={open} onClose={() => setOpen(null)} />
      )}

      {error && <Notice kind="error">{error}</Notice>}

      <div className="nav-row">
        <Link className="btn btn-ghost" to="/domain-folding">
          Back
        </Link>
        <Link className="btn btn-primary" to="/labeling">
          Next → Labeling
        </Link>
      </div>
    </>
  )
}
