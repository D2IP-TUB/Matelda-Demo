import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { Modal } from '../components/foldBoard'
import { Button, Card, InfoButton, JobStatus, Notice, Prereq } from '../components/ui'
import { StepSlot } from '../components/StepSlot'
import { useJob } from '../jobs/useJob'
import { useT } from '../i18n'
import {
  fetchDetectedErrors,
  fetchDirtyPage,
  fetchErrorDetection,
  fetchPipeline,
  startErrorDetection,
} from '../lib/api'
import { useSession } from '../session/SessionProvider'
import '../styles/pages/error-detection.css'

const ROWS = 100
const LIST = 100
const SHADING = 200 // the API maximum; enough to shade the rows that are shown

function TableErrors({ pipeline, dataset, table }: { pipeline: string; dataset: string; table: string }) {
  const d = useT().errorDetection
  const [offset, setOffset] = useState(0)
  const rows = useQuery({
    queryKey: ['dirty', dataset, table, 0, ROWS],
    queryFn: () => fetchDirtyPage(dataset, table, 0, ROWS),
    enabled: !!dataset,
  })
  const shading = useQuery({
    queryKey: ['detected-errors', pipeline, table, 'shading'],
    queryFn: () => fetchDetectedErrors(pipeline, table, 0, SHADING),
  })
  const list = useQuery({
    queryKey: ['detected-errors', pipeline, table, offset],
    queryFn: () => fetchDetectedErrors(pipeline, table, offset, LIST),
  })

  const confidence = new Map<string, number>()
  for (const e of shading.data?.errors ?? []) confidence.set(`${e.row}|${e.col}`, Number(e.confidence ?? 0))

  return (
    <div className="detection-page detection-modal">
      <p>{d.heatNote}</p>
      <div className="heat-legend" aria-hidden="true">
        <span>{d.low}</span>
        <span className="heat-bar" />
        <span>{d.high}</span>
      </div>
      {rows.isError && <Notice kind="error">{(rows.error as Error).message}</Notice>}
      {rows.data && (
        <DataTable
          columns={rows.data.columns}
          rows={rows.data.rows}
          cellStyle={(r, c) => {
            const conf = confidence.get(`${r}|${rows.data!.columns[c]}`)
            return conf === undefined ? undefined : { backgroundColor: `rgba(10, 132, 255, ${conf})` }
          }}
        />
      )}
      <h4>{d.errorDetails}</h4>
      {list.isError && <Notice kind="error">{(list.error as Error).message}</Notice>}
      {list.data && (
        <>
          <ul className="err-list">
            {list.data.errors.map((e, i) => (
              <li key={`${offset}-${i}`}>
                <span className="meter" aria-hidden="true">
                  <span style={{ width: `${Math.round(Number(e.confidence ?? 0) * 100)}%` }} />
                </span>
                {d.errorLine(e.row, e.col, String(e.val))}
                <br />
                {d.confidenceLine(Math.round(Number(e.confidence ?? 0) * 100), String(e.source ?? d.unknown))}
              </li>
            ))}
          </ul>
          <div className={`pager${list.data.total <= LIST ? ' pager-single' : ''}`}>
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIST))}>
              {d.prevPage}
            </button>
            <span>{d.range(list.data.total === 0 ? 0 : offset + 1, Math.min(offset + LIST, list.data.total), list.data.total)}</span>
            <button disabled={offset + LIST >= list.data.total} onClick={() => setOffset(offset + LIST)}>
              {d.nextPage}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function ErrorDetection({ pollMs = 1000 }: { pollMs?: number }) {
  const d = useT().errorDetection
  const tr = useT().ui
  const session = useSession()
  const queryClient = useQueryClient()
  const pipeline = session.data.pipeline_path as string | undefined

  const config = useQuery({
    queryKey: ['pipeline', pipeline],
    queryFn: () => fetchPipeline(pipeline as string),
    enabled: !!pipeline,
  })
  const detection = useQuery({
    queryKey: ['detection', pipeline],
    queryFn: () => fetchErrorDetection(pipeline as string),
    enabled: !!pipeline,
  })

  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId, pollMs)
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (job.state === 'done' && jobId && handled.current !== jobId) {
      handled.current = jobId
      void queryClient.invalidateQueries({ queryKey: ['detection', pipeline] })
      void queryClient.invalidateQueries({ queryKey: ['detected-errors', pipeline] })
    }
  }, [job.state, jobId, pipeline, queryClient])

  const [startError, setStartError] = useState('')
  // Spinner from the tap on: starting the job is a network round trip, slow on mobile.
  const [starting, setStarting] = useState(false)
  const [openTable, setOpenTable] = useState<string | null>(null)

  if (!session.ready) return <h1>Error Detection</h1>
  if (!pipeline) {
    return (
      <>
        <h1>Error Detection</h1>
        <Prereq title={d.prereqTitle} to="/configuration" action={d.backToConfig}>{d.prereqText}</Prereq>
      </>
    )
  }

  const run = async () => {
    if (starting) return
    setStarting(true)
    setStartError('')
    try {
      setJobId(await startErrorDetection(pipeline))
    } catch (e) {
      setStartError(e instanceof Error ? e.message : d.startFailed)
    } finally {
      setStarting(false)
    }
  }

  const result = detection.data ?? null
  const needsPropagation = /label propagation first/i.test(startError)
  const tables = Object.entries(result?.tables ?? {})

  return (
    <div className="detection-page">
      <div className="title-row">
        <h1>Error Detection</h1>
        <InfoButton label={d.infoLabel} title={d.infoTitle}>
          <p>{d.infoIntro}</p>
          <h3>{d.whatToDo}</h3>
          <ol>
            <li>{d.infoStep1}</li>
            <li>{d.infoStep2}</li>
            <li>{d.infoStep3a}<b>{d.infoStep3b}</b>{d.infoStep3c}</li>
          </ol>
        </InfoButton>
      </div>
      <p className="lede">{d.lead}</p>
      <Card>
        <Button onClick={() => void run()} loading={starting || job.state === 'running'}>
          {result ? d.rerun : d.run}
        </Button>
        <JobStatus state={job.state} error={job.error} />
        {needsPropagation ? (
          <Prereq title={d.needsPropTitle} to="/propagated-errors" action={d.goToPropagated}>
            {d.needsPropText}
          </Prereq>
        ) : (
          startError && <Notice kind="warn">{startError}</Notice>
        )}
      </Card>
      {detection.isError && <Notice kind="error">{(detection.error as Error).message}</Notice>}

      {result && (
        <>
          <h2>{d.detectedErrors}</h2>
          {tables.length === 0 && <Notice kind="info">{d.noneDetected}</Notice>}
          <div className="table-grid">
            {tables.map(([table, count]) => (
              <button
                key={table}
                type="button"
                className="table-tile"
                aria-haspopup="dialog"
                onClick={() => setOpenTable(table)}
              >
                <svg className="tile-ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <path d="M3 10h18M9 10v10" />
                </svg>
                <span className="table-tile-name">{table}</span>
                <span className="table-tile-count">{d.potentialErrors(count)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {openTable && (
        <Modal label={d.modalLabel(openTable)} onClose={() => setOpenTable(null)}>
          <h2>{openTable}</h2>
          <TableErrors pipeline={pipeline} dataset={config.data?.selected_dataset ?? ''} table={openTable} />
          <Button variant="ghost" onClick={() => setOpenTable(null)}>
            {tr.close}
          </Button>
        </Modal>
      )}

      <div className="nav-row">
        <Link className="btn btn-ghost" to="/propagated-errors">
          {d.back}
        </Link>
        <StepSlot />
        {result ? (
          <Link className="btn btn-primary" to="/results">
            {d.continue}
          </Link>
        ) : (
          <Button disabled>{d.continue}</Button>
        )}
      </div>
    </div>
  )
}
