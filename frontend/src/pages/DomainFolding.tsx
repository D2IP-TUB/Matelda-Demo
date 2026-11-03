import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
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

  const [mode, setMode] = useState<'none' | 'merge' | 'split'>('none')
  const [pickedFolds, setPickedFolds] = useState<string[]>([])
  const [pickedTables, setPickedTables] = useState<Record<string, string[]>>({})
  const [previewing, setPreviewing] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

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

  const enter = (next: 'merge' | 'split') => {
    setMode(next)
    setPickedFolds([])
    setPickedTables({})
  }

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

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

  const anySplitTable = Object.values(pickedTables).some((t) => t.length > 0)

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
          <Card title="Options / Actions">
            <div className="row">
              <Button variant="ghost" onClick={() => enter('merge')}>
                Merge folds
              </Button>
              <Button variant="ghost" onClick={() => enter('split')}>
                Split folds
              </Button>
              {mode !== 'none' && (
                <Button variant="ghost" onClick={() => setMode('none')}>
                  Cancel
                </Button>
              )}
            </div>
            {mode === 'merge' && (
              <p>Select the folds to merge; all their tables end up in the first selected fold.</p>
            )}
            {mode === 'split' && (
              <p>Select tables; every fold is split immediately after its selected tables.</p>
            )}
            {mode === 'merge' && (
              <Button
                disabled={pickedFolds.length < 2}
                onClick={() => {
                  setLocal(mergeFolds(folds, pickedFolds))
                  setMode('none')
                }}
              >
                Confirm merge
              </Button>
            )}
            {mode === 'split' && (
              <Button
                disabled={!anySplitTable}
                onClick={() => {
                  setLocal(splitFolds(folds, pickedTables))
                  setMode('none')
                }}
              >
                Confirm split
              </Button>
            )}
          </Card>

          {foldNames.map((fold) => (
            <Card key={fold}>
              <div className="row">
                <h3>{fold}</h3>
                {mode === 'merge' && (
                  <input
                    type="checkbox"
                    aria-label={`Select fold ${fold}`}
                    checked={pickedFolds.includes(fold)}
                    onChange={() => setPickedFolds(toggle(pickedFolds, fold))}
                  />
                )}
              </div>
              <ul className="tables">
                {folds[fold].map((table) => (
                  <li key={table}>
                    <div className="row">
                      <span>{table}</span>
                      <Button
                        variant="ghost"
                        aria-label={`Preview ${table}`}
                        onClick={() => setPreviewing({ ...previewing, [table]: !previewing[table] })}
                      >
                        {previewing[table] ? 'Hide' : 'Preview'}
                      </Button>
                      <select
                        aria-label={`Move ${table} to`}
                        value={fold}
                        onChange={(e) => setLocal(moveTable(folds, table, e.target.value))}
                      >
                        {foldNames.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                      {mode === 'split' && (
                        <input
                          type="checkbox"
                          aria-label={`Select table ${table}`}
                          checked={(pickedTables[fold] ?? []).includes(table)}
                          onChange={() =>
                            setPickedTables({ ...pickedTables, [fold]: toggle(pickedTables[fold] ?? [], table) })
                          }
                        />
                      )}
                    </div>
                    {previewing[table] && <TablePreview dataset={dataset} table={table} />}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </>
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
