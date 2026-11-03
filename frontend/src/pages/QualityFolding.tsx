import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
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
type Mode = 'none' | 'merge' | 'split' | 'bulk'

const refOf = (c: CellRef | CellView): CellRef => ({ table: c.table, row: c.row, col: c.col })
const sameCell = (a: CellRef, b: CellRef) => a.table === b.table && a.row === b.row && a.col === b.col

function FoldCells({
  pipeline,
  fold,
  splitMode,
  picked,
  onPick,
  onOpen,
}: {
  pipeline: string
  fold: string
  splitMode: boolean
  picked: CellRef[]
  onPick: (cell: CellRef) => void
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
      <ul className="cells">
        {cells.map((cell) => (
          <li key={`${cell.table}|${cell.row}|${cell.col}`} data-testid="cell" onClick={() => onOpen(cell)}>
            {splitMode && (
              <input
                type="checkbox"
                aria-label={`Select cell ${cell.table} ${cell.row} ${cell.col}`}
                checked={picked.some((p) => sameCell(p, cell))}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onPick(refOf(cell))}
              />
            )}
            <button type="button" className="link">
              {`${cell.table} · row ${cell.row} · ${cell.col}: ${String(cell.val)}`}
            </button>
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
  fold,
  allFolds,
  onMove,
  onClose,
}: {
  dataset: string
  cell: CellView
  fold: string
  allFolds: string[]
  onMove: (toFold: string) => void
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
    <dialog open role="dialog" aria-label="Cell details" className="cell-dialog">
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
      <div className="field">
        <label htmlFor="move-cell">Move cell to</label>
        <select id="move-cell" value={fold} onChange={(e) => onMove(e.target.value)}>
          {allFolds.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </div>
      <Button variant="ghost" onClick={onClose}>
        Close
      </Button>
    </dialog>
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

  const [mode, setMode] = useState<Mode>('none')
  const [pickedFolds, setPickedFolds] = useState<string[]>([])
  const [splitSel, setSplitSel] = useState<{ fold: string; cells: CellRef[] }>({ fold: '', cells: [] })
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState<{ cell: CellView; fold: string } | null>(null)
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

  const enter = (next: Mode) => {
    setMode(next)
    setPickedFolds([])
    setSplitSel({ fold: '', cells: [] })
  }

  const folds: FoldSummary[] = cellFolds.data ?? []
  const domains = [...new Set(folds.map((f) => f.domain))]
  const allFoldNames = folds.map((f) => f.name)

  const pickCell = (fold: string, cell: CellRef) =>
    setSplitSel((prev) => {
      const base = prev.fold === fold ? prev.cells : []
      return {
        fold,
        cells: base.some((c) => sameCell(c, cell)) ? base.filter((c) => !sameCell(c, cell)) : [...base, cell],
      }
    })

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
          <Card title="Options / Actions">
            <div className="row">
              <Button variant="ghost" onClick={() => enter('merge')}>
                Merge folds
              </Button>
              <Button variant="ghost" onClick={() => enter('split')}>
                Split folds
              </Button>
              <Button variant="ghost" onClick={() => enter('bulk')}>
                Bulk annotate
              </Button>
              {mode !== 'none' && (
                <Button variant="ghost" onClick={() => enter('none')}>
                  Cancel
                </Button>
              )}
            </div>
            {mode === 'merge' && (
              <>
                <p>Select the folds to merge; the first one you select receives all cells.</p>
                <Button
                  disabled={pickedFolds.length < 2}
                  onClick={async () => {
                    if (await edit(() => mergeCellFolds(pipeline, pickedFolds))) enter('none')
                  }}
                >
                  Confirm merge
                </Button>
              </>
            )}
            {mode === 'split' && (
              <>
                <p>Show a fold and select the cells to split after (one fold at a time).</p>
                <Button
                  disabled={splitSel.cells.length === 0}
                  onClick={async () => {
                    if (await edit(() => splitCellFold(pipeline, splitSel.fold, splitSel.cells))) enter('none')
                  }}
                >
                  Confirm split
                </Button>
              </>
            )}
            {mode === 'bulk' && <p>Mark whole folds as correct or false; labels are used for error detection.</p>}
          </Card>

          {domains.map((domain) => (
            <section key={domain}>
              <h2>{domain}</h2>
              {folds
                .filter((f) => f.domain === domain)
                .map((fold) => (
                  <Card key={fold.name}>
                    <div className="row">
                      <span className={`fold-name label-${fold.label}`}>{fold.name}</span>
                      <span>{`${fold.cell_count} cells`}</span>
                      <Button
                        variant="ghost"
                        aria-label={`${shown[fold.name] ? 'Hide' : 'Show'} ${fold.name}`}
                        onClick={() => setShown({ ...shown, [fold.name]: !shown[fold.name] })}
                      >
                        {shown[fold.name] ? 'Hide' : 'Show'}
                      </Button>
                      {mode === 'merge' && (
                        <input
                          type="checkbox"
                          aria-label={`Select fold ${fold.name}`}
                          checked={pickedFolds.includes(fold.name)}
                          onChange={() =>
                            setPickedFolds(
                              pickedFolds.includes(fold.name)
                                ? pickedFolds.filter((f) => f !== fold.name)
                                : [...pickedFolds, fold.name],
                            )
                          }
                        />
                      )}
                      {mode === 'bulk' && (
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
                    </div>
                    {shown[fold.name] && (
                      <>
                        <ul>
                          {Object.entries(fold.tables).flatMap(([table, cols]) =>
                            Object.entries(cols).map(([col, n]) => (
                              <li key={`${table}|${col}`}>{`${table} · ${col}: ${n} cells`}</li>
                            )),
                          )}
                        </ul>
                        <FoldCells
                          key={`${fold.name}-${version}`}
                          pipeline={pipeline}
                          fold={fold.name}
                          splitMode={mode === 'split'}
                          picked={splitSel.fold === fold.name ? splitSel.cells : []}
                          onPick={(cell) => pickCell(fold.name, cell)}
                          onOpen={(cell) => setOpen({ cell, fold: fold.name })}
                        />
                      </>
                    )}
                  </Card>
                ))}
            </section>
          ))}
        </>
      )}

      {open && config.data && (
        <CellDialog
          dataset={config.data.selected_dataset}
          cell={open.cell}
          fold={open.fold}
          allFolds={allFoldNames}
          onClose={() => setOpen(null)}
          onMove={async (to) => {
            if (to !== open.fold && (await edit(() => moveCell(pipeline, refOf(open.cell), to)))) setOpen(null)
          }}
        />
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
