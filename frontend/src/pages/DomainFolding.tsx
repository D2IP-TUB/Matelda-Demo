import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { CutButton, DragGhost, FoldBox, Modal, useDragController } from '../components/foldBoard'
import { Button, Card, JobStatus, Notice } from '../components/ui'
import { mergeFolds, moveTable, splitFolds } from '../folds/domainOps'
import type { Folds } from '../folds/domainOps'
import { useJob } from '../jobs/useJob'
import { fetchDirtyPage, fetchPipeline, saveDomainFolds, startDomainFolding } from '../lib/api'
import { useSession } from '../session/SessionProvider'

function TablePreview({ dataset, table }: { dataset: string; table: string }) {
  const preview = useQuery({
    queryKey: ['preview', dataset, table],
    queryFn: () => fetchDirtyPage(dataset, table, 0, 20),
  })
  if (preview.isError) return <Notice kind="error">{(preview.error as Error).message}</Notice>
  if (!preview.data) return <p>Loading…</p>
  return <DataTable columns={preview.data.columns} rows={preview.data.rows} />
}

export function DomainFolding({ pollMs = 1000 }: { pollMs?: number }) {
  const session = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const pipeline = session.data.pipeline_path as string | undefined

  const config = useQuery({
    queryKey: ['pipeline', pipeline],
    queryFn: () => fetchPipeline(pipeline as string),
    enabled: !!pipeline,
  })
  const dataset = config.data?.selected_dataset ?? ''

  const [local, setLocal] = useState<Folds | null>(null)
  const folds: Folds = local ?? ((config.data?.domain_folds as Folds | undefined) || {})
  const foldNames = Object.keys(folds)

  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId, pollMs)
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (job.state === 'done' && jobId && handled.current !== jobId) {
      handled.current = jobId
      setLocal(null)
      void config.refetch()
    }
  }, [job.state, jobId, config])

  const [previewTable, setPreviewTable] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const dnd = useDragController()

  if (!session.ready) return <h1>Domain Folding</h1>
  if (!pipeline) {
    return (
      <>
        <h1>Domain Folding</h1>
        <Notice kind="warn">Pipeline not configured.</Notice>
        <Link to="/configuration">Go back to Configurations</Link>
      </>
    )
  }

  const run = async () => {
    setError('')
    try {
      setJobId(await startDomainFolding(pipeline))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start domain folding')
    }
  }

  const save = async (): Promise<boolean> => {
    setSaving(true)
    setError('')
    try {
      await saveDomainFolds(pipeline, folds)
      await queryClient.invalidateQueries({ queryKey: ['pipeline', pipeline] })
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the domain folds')
      return false
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <h1>Domain Folding</h1>
      <Card>
        <Button onClick={() => void run()} disabled={job.state === 'running' || config.isLoading}>
          Run domain based folding
        </Button>
        <JobStatus state={job.state} error={job.error} />
      </Card>
      {config.isError && <Notice kind="error">{(config.error as Error).message}</Notice>}

      {foldNames.length === 0 && !config.isLoading && (
        <Notice kind="info">No domain folds yet. Run domain based folding to create them.</Notice>
      )}

      {foldNames.length > 0 && (
        <>
          <p className="hint">
            Drag a table (touch: press and hold, then drag) onto another fold to move it, drag a fold's handle onto another fold to merge them, click ✂
            between two tables to split, click a table to preview it.
          </p>
          {foldNames.map((fold) => (
            <FoldBox<string>
              key={fold}
              name={fold}
              dnd={dnd}
              onDropItem={(table) => setLocal(moveTable(folds, table, fold))}
              onMergeFold={(source) => setLocal(mergeFolds(folds, [fold, source]))}
              header={<h3>{fold}</h3>}
            >
              <ul className="chips">
                {folds[fold].map((table, i) => (
                  <li key={table}>
                    <button
                      type="button"
                      className="chip"
                      {...dnd.source({ kind: 'item', fold, item: table }, table)}
                      onClick={() => setPreviewTable(table)}
                    >
                      {table}
                    </button>
                    {i < folds[fold].length - 1 && (
                      <CutButton
                        label={`Split ${fold} after ${table}`}
                        onCut={() => setLocal(splitFolds(folds, { [fold]: [table] }))}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </FoldBox>
          ))}
        </>
      )}

      <DragGhost dnd={dnd} />

      {previewTable && (
        <Modal label={`Preview ${previewTable}`} onClose={() => setPreviewTable(null)}>
          <h2>{previewTable}</h2>
          <TablePreview dataset={dataset} table={previewTable} />
          <Button variant="ghost" onClick={() => setPreviewTable(null)}>
            Close
          </Button>
        </Modal>
      )}

      {error && <Notice kind="error">{error}</Notice>}

      <div className="nav-row">
        <Link className="btn btn-ghost" to="/configuration">
          Back
        </Link>
        <div className="row">
          <Button variant="ghost" disabled={saving || foldNames.length === 0} onClick={() => void save()}>
            Save
          </Button>
          <Button
            disabled={saving || foldNames.length === 0}
            onClick={async () => {
              if (await save()) navigate('/quality-folding')
            }}
          >
            Next → Quality Folding
          </Button>
        </div>
      </div>
    </>
  )
}
