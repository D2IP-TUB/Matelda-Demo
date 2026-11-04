import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../components/foldBoard'
import { Button, Card, InfoButton, Loading, Notice, Prereq } from '../components/ui'
import { StepSlot } from '../components/StepSlot'
import { useT } from '../i18n'
import { fetchPropagation } from '../lib/api'
import { useSession } from '../session/SessionProvider'
import '../styles/pages/propagated-errors.css'

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

function VerdictBadge({ error }: { error?: boolean }) {
  const p = useT().propagatedErrors
  return (
    <span className={`pe-badge ${error ? 'is-error' : 'is-ok'}`}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {error ? <path d="M4 4l8 8M12 4l-8 8" /> : <path d="M3 8.5l3.2 3.2L13 4.8" />}
      </svg>
      {error ? p.error : p.correct}
    </span>
  )
}

function LabeledRow({ cell }: { cell: Labeled }) {
  const p = useT().propagatedErrors
  const tr = useT().ui
  const [open, setOpen] = useState(false)
  const n = cell.propagated_cells?.length ?? 0
  return (
    <li className="pe-item">
      <button type="button" className="pe-cell" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <VerdictBadge error={cell.is_error} />
        <span className="pe-cell-main">
          <span className="pe-cell-val">{p.cellLabel(String(cell.val ?? p.unknownValue))}</span>
          <span className="pe-cell-sub">{[cell.table, cell.col, cell.row !== undefined ? p.rowN(cell.row) : null].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="pe-count">{n > 0 ? p.nPropagated(n) : p.nonePropagated}</span>
        <svg className="pe-chev" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3l5 5-5 5" />
        </svg>
      </button>
      {open && (
        <Modal label={p.modalLabel} onClose={() => setOpen(false)}>
          <div className="propagated-page pe-modal">
          <h2 className="pe-modal-title">
            <VerdictBadge error={cell.is_error} />
            {p.cellLabel(String(cell.val ?? p.unknownValue))}
          </h2>
          <dl className="origin">
            {cell.table && (
              <>
                <dt>{p.dtTable}</dt>
                <dd>
                  <code>{cell.table}</code>
                </dd>
              </>
            )}
            {cell.col && (
              <>
                <dt>{p.dtColumn}</dt>
                <dd>
                  <code>{cell.col}</code>
                </dd>
              </>
            )}
            {cell.row !== undefined && (
              <>
                <dt>{p.dtRow}</dt>
                <dd>{cell.row}</dd>
              </>
            )}
            {cell.domain_fold && (
              <>
                <dt>{p.dtDomainFold}</dt>
                <dd>{cell.domain_fold}</dd>
              </>
            )}
            {cell.cell_fold && (
              <>
                <dt>{p.dtCellFold}</dt>
                <dd>{cell.cell_fold}</dd>
              </>
            )}
          </dl>
          {cell.propagated_cells && cell.propagated_cells.length > 0 ? (
            <>
              <h3>{p.propagatedTo(cell.propagated_cells.length)}</h3>
              <div className="pe-table-wrap">
              <table className="propagated">
                <thead>
                  <tr>
                    <th>{p.colTable}</th>
                    <th>{p.colRow}</th>
                    <th>{p.colColumn}</th>
                    <th>{p.colValue}</th>
                    <th>{p.colConfidence}</th>
                    <th>{p.colReason}</th>
                  </tr>
                </thead>
                <tbody>
                  {cell.propagated_cells.map((pc, i) => (
                    <tr key={i}>
                      <td>{pc.table ?? p.unknown}</td>
                      <td>{pc.row ?? '?'}</td>
                      <td>{pc.col ?? '?'}</td>
                      <td>{String(pc.val ?? '')}</td>
                      <td>
                        <span className="pill pe-conf" aria-label={p.confidenceAria(Math.round((pc.confidence ?? 0) * 100))}>
                          {`${Math.round((pc.confidence ?? 0) * 100)}%`}
                        </span>
                      </td>
                      <td>{pc.reason ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          ) : (
            <p>{p.noPropagated}</p>
          )}
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {tr.close}
          </Button>
          </div>
        </Modal>
      )}
    </li>
  )
}

export function PropagatedErrors() {
  const p = useT().propagatedErrors
  const session = useSession()
  const pipeline = session.data.pipeline_path as string | undefined
  const [offset, setOffset] = useState(0)
  const results = useQuery({
    queryKey: ['propagation', pipeline, offset],
    queryFn: () => fetchPropagation(pipeline as string, offset, PAGE),
    enabled: !!pipeline,
  })

  const head = (
    <header className="pe-head">
      <div className="title-row">
        <h1>Propagated Errors</h1>
        <InfoButton label={p.infoLabel} title={p.infoTitle}>
          <p>{p.infoIntro}</p>
          <h3>{p.whatToDo}</h3>
          <ol>
            <li>{p.infoStep1}</li>
            <li>{p.infoStep2}</li>
            <li>{p.infoStep3}</li>
          </ol>
        </InfoButton>
      </div>
      <p className="pe-lead">{p.lead}</p>
    </header>
  )
  if (!session.ready) return <div className="propagated-page">{head}</div>
  if (!pipeline) {
    return (
      <div className="propagated-page">
        {head}
        <Prereq title={p.prereqTitle} to="/configuration" action={p.backToConfig}>{p.prereqText}</Prereq>
      </div>
    )
  }
  const notYet = results.data === null

  return (
    <div className="propagated-page">
      {head}
      {results.isPending && <Loading className="pe-loading">{p.loading}</Loading>}
      {notYet && (
        <Prereq title={p.notYetTitle} to="/labeling" action={p.goToLabeling}>
          {p.notYetText}
        </Prereq>
      )}
      {results.isError && <Notice kind="error">{(results.error as Error).message}</Notice>}
      {results.data && (
        <>
          <div className="stats pe-stats">
            <div className="stat">
              <span>{p.labeledCells}</span>
              <b>{results.data.total}</b>
            </div>
            <div className="stat">
              <span>{p.propagatedLabels}</span>
              <b>{results.data.propagated_total}</b>
            </div>
          </div>
          <Card>
            <p className="pe-intro">{p.intro}</p>
            {results.data.labeled_cells.length === 0 && <p className="pe-empty">{p.empty}</p>}
            <ul className="pe-list">
              {(results.data.labeled_cells as Labeled[]).map((cell, i) => (
                <LabeledRow key={`${offset}-${i}`} cell={cell} />
              ))}
            </ul>
            <div className={`pager${results.data.total <= PAGE ? ' pager-single' : ''}`}>
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                {p.prevPage}
              </button>
              <span>{p.range(offset + 1, Math.min(offset + PAGE, results.data.total), results.data.total)}</span>
              <button disabled={offset + PAGE >= results.data.total} onClick={() => setOffset(offset + PAGE)}>
                {p.nextPage}
              </button>
            </div>
          </Card>
        </>
      )}
      <div className="nav-row">
        <Link className="btn btn-ghost" to="/labeling-stats">
          {p.back}
        </Link>
        <StepSlot />
        {results.data ? (
          <Link className="btn btn-primary" to="/error-detection">
            {p.continue}
          </Link>
        ) : (
          <span className="btn btn-primary" role="link" aria-disabled="true" title={p.notYetTitle}>
            {p.continue}
          </span>
        )}
      </div>
    </div>
  )
}
