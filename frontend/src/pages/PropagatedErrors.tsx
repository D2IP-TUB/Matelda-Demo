import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Notice } from '../components/ui'
import { fetchPropagation } from '../lib/api'
import { useSession } from '../session/SessionProvider'

const PAGE = 20

interface Propagated {
  table?: string
  row?: number
  col?: string
  val?: unknown
  confidence?: number
  reason?: string
}
interface Labeled {
  table?: string
  row?: number
  col?: string
  val?: unknown
  is_error?: boolean
  domain_fold?: string
  cell_fold?: string
  propagated_cells?: Propagated[]
}

function LabeledRow({ cell }: { cell: Labeled }) {
  const [open, setOpen] = useState(false)
  const icon = cell.is_error ? '❌' : '✅'
  return (
    <div className="labeled">
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {`${icon} Cell: ${String(cell.val ?? 'Unknown Value')}`}
      </button>
      {open && (
        <div className="labeled-details">
          <ul>
            {cell.table && <li>Table: {cell.table}</li>}
            {cell.row !== undefined && <li>Row: {cell.row}</li>}
            {cell.col && <li>Column: {cell.col}</li>}
            {cell.domain_fold && <li>Domain fold: {cell.domain_fold}</li>}
            {cell.cell_fold && <li>Cell fold: {cell.cell_fold}</li>}
          </ul>
          {cell.propagated_cells && cell.propagated_cells.length > 0 ? (
            <>
              <b>Propagated to:</b>
              <ul>
                {cell.propagated_cells.map((p, i) => (
                  <li key={i}>
                    {`${p.table ?? 'Unknown'} · row ${p.row ?? '?'} · ${p.col ?? '?'} · value ${String(p.val ?? '')}`}
                    <br />
                    Confidence: {Math.round((p.confidence ?? 0) * 100)}%
                    {p.reason ? ` — ${p.reason}` : ''}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No cells were propagated from this label</p>
          )}
        </div>
      )}
    </div>
  )
}

export function PropagatedErrors() {
  const session = useSession()
  const pipeline = session.data.pipeline_path as string | undefined
  const [offset, setOffset] = useState(0)
  const results = useQuery({
    queryKey: ['propagation', pipeline, offset],
    queryFn: () => fetchPropagation(pipeline as string, offset, PAGE),
    enabled: !!pipeline,
  })

  if (!session.ready) return <h1>Propagated Errors</h1>
  if (!pipeline) {
    return (
      <>
        <h1>Propagated Errors</h1>
        <Notice kind="warn">Pipeline not configured.</Notice>
        <Link to="/configuration">Go back to Configurations</Link>
      </>
    )
  }
  const notYet = results.isError && /label propagation first/i.test((results.error as Error).message)

  return (
    <>
      <h1>Propagated Errors</h1>
      {notYet && (
        <>
          <Notice kind="info">Run label propagation first: finish the labeling step and press Next.</Notice>
          <Link to="/labeling">Go to Labeling</Link>
        </>
      )}
      {results.isError && !notYet && <Notice kind="error">{(results.error as Error).message}</Notice>}
      {results.data && (
        <>
          <h2>Label Propagation Results</h2>
          <div className="stats">
            <div className="stat">
              <span>Labeled cells</span>
              <b>{results.data.total}</b>
            </div>
            <div className="stat">
              <span>Propagated labels</span>
              <b>{results.data.propagated_total}</b>
            </div>
          </div>
          <Card>
            <p>Below are the cells that were labeled and how their labels were propagated to other cells.</p>
            {(results.data.labeled_cells as Labeled[]).map((cell, i) => (
              <LabeledRow key={`${offset}-${i}`} cell={cell} />
            ))}
            <div className="pager">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                Previous page
              </button>
              <span>{`${offset + 1}–${Math.min(offset + PAGE, results.data.total)} of ${results.data.total}`}</span>
              <button disabled={offset + PAGE >= results.data.total} onClick={() => setOffset(offset + PAGE)}>
                Next page
              </button>
            </div>
          </Card>
        </>
      )}
      <div className="nav-row">
        <Link className="btn btn-ghost" to="/labeling">
          Back
        </Link>
        <Link className="btn btn-primary" to="/error-detection">
          Next → Error Detection
        </Link>
      </div>
    </>
  )
}
