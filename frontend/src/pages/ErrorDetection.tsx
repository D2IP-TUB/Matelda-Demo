import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { Button, Card, JobStatus, Notice } from '../components/ui'
import { useJob } from '../jobs/useJob'
import {
  fetchDetectedErrors,
  fetchDirtyPage,
  fetchErrorDetection,
  fetchPipeline,
  startErrorDetection,
} from '../lib/api'
import { useSession } from '../session/SessionProvider'

const ROWS = 100
const LIST = 100
const SHADING = 200 // the API maximum; enough to shade the rows that are shown

function TableErrors({ pipeline, dataset, table }: { pipeline: string; dataset: string; table: string }) {
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
    <div>
      <p>The intensity of the highlighting shows how confident the detection is (darker = more confident).</p>
      {rows.isError && <Notice kind="error">{(rows.error as Error).message}</Notice>}
      {rows.data && (
        <DataTable
          columns={rows.data.columns}
          rows={rows.data.rows}
          cellStyle={(r, c) => {
            const conf = confidence.get(`${r}|${rows.data!.columns[c]}`)
            return conf === undefined ? undefined : { backgroundColor: `rgba(244, 177, 28, ${conf})` }
          }}
        />
      )}
      <h4>Error details</h4>
      {list.isError && <Notice kind="error">{(list.error as Error).message}</Notice>}
      {list.data && (
        <>
          <ul>
            {list.data.errors.map((e, i) => (
              <li key={`${offset}-${i}`}>
                {`Row ${e.row}, column ${e.col}, value ${String(e.val)}`}
                <br />
                {`Confidence: ${Math.round(Number(e.confidence ?? 0) * 100)}% — Source: ${e.source ?? 'Unknown'}`}
              </li>
            ))}
          </ul>
          <div className="pager">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIST))}>
              Previous page
            </button>
            <span>{`${list.data.total === 0 ? 0 : offset + 1}–${Math.min(offset + LIST, list.data.total)} of ${list.data.total}`}</span>
            <button disabled={offset + LIST >= list.data.total} onClick={() => setOffset(offset + LIST)}>
              Next page
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function TableSection({
  pipeline, dataset, table, count,
}: { pipeline: string; dataset: string; table: string; count: number }) {
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {`📊 ${table} (${count} potential errors)`}
      </button>
      {open && <TableErrors pipeline={pipeline} dataset={dataset} table={table} />}
    </Card>
  )
}

export function ErrorDetection({ pollMs = 1000 }: { pollMs?: number }) {
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

  if (!session.ready) return <h1>Error Detection</h1>
  if (!pipeline) {
    return (
      <>
        <h1>Error Detection</h1>
        <Notice kind="warn">Pipeline not configured.</Notice>
        <Link to="/configuration">Go back to Configurations</Link>
      </>
    )
  }

  const run = async () => {
    setStartError('')
    try {
      setJobId(await startErrorDetection(pipeline))
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Could not start error detection')
    }
  }

  const result = detection.data ?? null
  const metrics = (result?.metrics ?? {}) as Record<string, number | undefined>
  const needsPropagation = /label propagation first/i.test(startError)
  const tables = Object.entries(result?.tables ?? {})

  return (
    <>
      <h1>Error Detection</h1>
      <Card>
        <p>
          Run the error detection classifier to detect errors in your dataset from the user and propagated labels.
        </p>
        <Button onClick={() => void run()} disabled={job.state === 'running'}>
          {result ? 'Re-run error detection' : 'Run error detection'}
        </Button>
        <JobStatus state={job.state} error={job.error} />
        {startError && <Notice kind="warn">{startError}</Notice>}
        {needsPropagation && <Link to="/propagated-errors">Go to Propagated Errors</Link>}
      </Card>
      {detection.isError && <Notice kind="error">{(detection.error as Error).message}</Notice>}

      {result && (
        <>
          <h2>Detection metrics</h2>
          <div className="stats">
            <div className="stat">
              <span>Precision</span>
              <b>{(metrics.precision ?? 0).toFixed(3)}</b>
            </div>
            <div className="stat">
              <span>Recall</span>
              <b>{(metrics.recall ?? 0).toFixed(3)}</b>
            </div>
            <div className="stat">
              <span>F1 Score</span>
              <b>{(metrics.f1 ?? 0).toFixed(3)}</b>
            </div>
          </div>
          <h2>Detected errors</h2>
          {tables.length === 0 && <Notice kind="info">No errors detected in the dataset!</Notice>}
          {tables.map(([table, count]) => (
            <TableSection
              key={table}
              pipeline={pipeline}
              dataset={config.data?.selected_dataset ?? ''}
              table={table}
              count={count}
            />
          ))}
        </>
      )}

      <div className="nav-row">
        <Link className="btn btn-ghost" to="/propagated-errors">
          Back
        </Link>
        {result ? (
          <Link className="btn btn-primary" to="/results">
            Next: View results
          </Link>
        ) : (
          <Button disabled>Next: View results</Button>
        )}
      </div>
    </>
  )
}
