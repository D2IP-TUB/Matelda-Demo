import '../styles/pages/domain-folding.css'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { CutToggle, DragGhost, FoldBox, Modal, Seam, useCutMode, useDragController } from '../components/foldBoard'
import { Button, Card, InfoButton, JobStatus, Loading, Notice, Prereq } from '../components/ui'
import { StepSlot } from '../components/StepSlot'
import { mergeFolds, moveTable, splitFolds } from '../folds/domainOps'
import type { Folds } from '../folds/domainOps'
import { t, useT } from '../i18n'
import { useJob } from '../jobs/useJob'
import { fetchDirtyPage, fetchPipeline, saveDomainFolds, startDomainFolding } from '../lib/api'
import type { RoomService } from '../rooms/roomService'
import { useRoomInfo } from '../rooms/useRoomInfo'
import { useSession } from '../session/SessionProvider'
import { PAGES, stepIndex } from '../routes'

function TablePreview({ dataset, table }: { dataset: string; table: string }) {
  const preview = useQuery({
    queryKey: ['preview', dataset, table],
    queryFn: () => fetchDirtyPage(dataset, table, 0, 20),
  })
  if (preview.isError) return <Notice kind="error">{(preview.error as Error).message}</Notice>
  if (!preview.data) return <Loading>{t().domainFolding.loading}</Loading>
  return <DataTable columns={preview.data.columns} rows={preview.data.rows} />
}

export function DomainFolding({ pollMs = 1000, roomService }: { pollMs?: number; roomService?: RoomService }) {
  const tr = useT()
  const d = tr.domainFolding
  const session = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { room, me, isHost } = useRoomInfo(roomService)
  // A helper has no pipeline of their own: they look at the host's, read-only, for as long as they stay in the room.
  const readOnly = !!room && !!me && !isHost
  const pipeline = (readOnly ? room.pipeline : undefined) || (session.data.pipeline_path as string | undefined)

  const config = useQuery({
    queryKey: ['pipeline', pipeline],
    queryFn: () => fetchPipeline(pipeline as string),
    enabled: !!pipeline,
  })
  const dataset = config.data?.selected_dataset ?? ''

  // Unsaved edits live in the session, so leaving the page and coming back shows them as you left them.
  const draft = session.data.domain_folds_draft as { pipeline: string; folds: Folds } | undefined
  const local = draft && draft.pipeline === pipeline ? draft.folds : null
  const setLocal = (next: Folds | null) =>
    void (readOnly ? undefined : next ? session.update({ domain_folds_draft: { pipeline, folds: next } }) : session.remove(['domain_folds_draft']))
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

  const [cutting, setCutting] = useCutMode()

  if (!session.ready) return <h1>Domain Folding</h1>
  if (!pipeline) {
    return (
      <>
        <h1>Domain Folding</h1>
        {readOnly ? (
          <Prereq title={d.prereqTitle} to="/labeling" action={d.backToLabeling}>{d.prereqText}</Prereq>
        ) : (
          <Prereq title={d.prereqTitle} to="/configuration" action={d.backToConfig}>{d.prereqText}</Prereq>
        )}
      </>
    )
  }

  const run = async () => {
    setError('')
    try {
      setJobId(await startDomainFolding(pipeline))
    } catch (e) {
      setError(e instanceof Error ? e.message : d.startFailed)
    }
  }

  const save = async (): Promise<boolean> => {
    setSaving(true)
    setError('')
    try {
      await saveDomainFolds(pipeline, folds)
      setLocal(null) // saved: the pipeline is the source of truth again
      await queryClient.invalidateQueries({ queryKey: ['pipeline', pipeline] })
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : d.saveFailed)
      return false
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="domain-page">
      <header className="dp-head">
        <p className="dp-eyebrow">{tr.shell.stepOf(stepIndex('/domain-folding') + 1, PAGES.length)}</p>
        <div className="title-row">
          <h1>Domain Folding</h1>
          <InfoButton label={d.infoLabel} title="Domain folding">
            <p>
              {d.introA}<b>{d.introFolds}</b>{d.introB}
            </p>
            <h3>{d.editTitle}</h3>
            <ul>
              <li><b>{d.move}</b>{d.moveText}</li>
              <li><b>{d.merge}</b>{d.mergeA}<b>⠿</b>{d.mergeB}</li>
              <li><b>{d.split}</b>{d.splitA}<b>{`✂ ${tr.shell.splitFolds}`}</b>{d.splitB}</li>
              <li><b>{d.preview}</b>{d.previewText}</li>
            </ul>
            <p>{d.touch}</p>
          </InfoButton>
        </div>
        <p className="dp-lead">{d.lead}</p>
      </header>
      {!readOnly && <Card>
        <Button onClick={() => void run()} loading={job.state === 'running'} disabled={config.isLoading}>
          {d.run}
        </Button>
        <JobStatus state={job.state} error={job.error} />
      </Card>}
      {config.isError && <Notice kind="error">{(config.error as Error).message}</Notice>}

      {foldNames.length > 0 && (
        <>
          {!readOnly && (
            <CutToggle
              on={cutting}
              onToggle={() => setCutting((c) => !c)}
              hint={d.cutHint}
            />
          )}
          <div className={`fold-grid dp-board${cutting ? ' cutting' : ''}`}>
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
                      <Seam
                        cutting={cutting}
                        label={d.splitAfter(fold, table)}
                        onCut={() => setLocal(splitFolds(folds, { [fold]: [table] }))}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </FoldBox>
          ))}
          </div>
        </>
      )}

      <DragGhost dnd={dnd} />

      {previewTable && (
        <Modal label={d.previewLabel(previewTable)} onClose={() => setPreviewTable(null)}>
          <h2>{previewTable}</h2>
          <TablePreview dataset={dataset} table={previewTable} />
          <Button variant="ghost" onClick={() => setPreviewTable(null)}>
            {d.close}
          </Button>
        </Modal>
      )}

      {error && <Notice kind="error">{error}</Notice>}

      {readOnly ? (
        <div className="nav-row dp-nav">
          <Link className="btn" to="/labeling">
            {d.backToLabeling}
          </Link>
        <StepSlot />
        </div>
      ) : (
      <div className="nav-row dp-nav">
        <Link className="btn btn-ghost" to="/configuration">
          {d.back}
        </Link>
        <StepSlot />
        <div className="row">
          <Button
            loading={saving}
            disabled={saving || foldNames.length === 0}
            onClick={async () => {
              if (await save()) navigate('/quality-folding')
            }}
          >
            {d.continue}
          </Button>
        </div>
      </div>
      )}
    </div>
  )
}
