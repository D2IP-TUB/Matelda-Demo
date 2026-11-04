import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BudgetField, StrategyChecklist } from '../components/forms'
import { TableModal } from '../components/TableModal'
import '../styles/pages/configurations.css'
import { Button, InfoButton, Loading, Notice } from '../components/ui'
import { StepSlot } from '../components/StepSlot'
import { clampBudget, ensureSuffix, savePipelineChoice } from '../configurations/pipelineFlow'
import {
  copyPipeline,
  createPipeline,
  fetchDatasets,
  fetchPipeline,
  fetchPipelines,
  fetchStrategies,
  fetchTables,
  suggestPipelineName,
  updatePipeline,
} from '../lib/api'
import { RoomService } from '../rooms/roomService'
import { useRoomInfo } from '../rooms/useRoomInfo'
import { pb } from '../lib/pb'
import { useSession } from '../session/SessionProvider'
import { t, useT } from '../i18n'

const DbIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
    <path d="M4.5 5.5v6.5c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V5.5M4.5 12v6.5c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V12" />
  </svg>
)
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)
const TableIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M10 10v9.5" />
  </svg>
)

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="cfg-section">
      <header className="cfg-head">
        <h2>{title}</h2>
        {hint && <p>{hint}</p>}
      </header>
      <div className="cfg-body">{children}</div>
    </section>
  )
}

export function Configurations() {
  const session = useSession()
  const c = useT().configurations
  const navigate = useNavigate()
  const suffix = session.sid.slice(0, 6)
  const { room, me, isHost } = useRoomInfo()

  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [dataset, setDataset] = useState('')
  const [budget, setBudget] = useState(10)
  const [chosen, setChosen] = useState<string[] | null>(null) // null = all strategies
  const [typedName, setTypedName] = useState<string | null>(null)
  const [existing, setExisting] = useState('')
  const [saveAs, setSaveAs] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [openTable, setOpenTable] = useState<string | null>(null)

  // Coming back from a later step: keep the settings you had, but stay on "Create new pipeline" (the default).
  const restored = useRef(false)
  useEffect(() => {
    if (!session.ready || restored.current) return
    restored.current = true
    const d = session.data
    if (typeof d.pipeline_path !== 'string' || !d.pipeline_path) return
    if (typeof d.dataset_select === 'string') setDataset(d.dataset_select)
    if (d.labeling_budget !== undefined) setBudget(clampBudget(d.labeling_budget))
    if (Array.isArray(d.selected_strategies)) setChosen(d.selected_strategies as string[])
  }, [session.ready, session.data])

  const datasets = useQuery({ queryKey: ['datasets'], queryFn: fetchDatasets })
  const strategies = useQuery({ queryKey: ['strategies'], queryFn: fetchStrategies })
  const pipelines = useQuery({ queryKey: ['pipelines'], queryFn: fetchPipelines })

  const sessionDataset = session.data.dataset_select as string | undefined
  const activeDataset = dataset || sessionDataset || datasets.data?.[0] || ''
  const tables = useQuery({
    queryKey: ['tables', activeDataset],
    queryFn: () => fetchTables(activeDataset),
    enabled: !!activeDataset,
  })
  const suggestion = useQuery({
    queryKey: ['suggest', activeDataset, suffix],
    queryFn: () => suggestPipelineName(activeDataset, suffix),
    enabled: mode === 'new' && !!activeDataset && !!suffix,
  })

  const selected = chosen ?? strategies.data ?? []
  const name = typedName ?? suggestion.data ?? ''
  const nameTaken =
    mode === 'new' && !!name && (pipelines.data ?? []).includes(ensureSuffix(name, suffix))

  const setBudgetFrom = (value: unknown) => setBudget(clampBudget(value))

  const chooseExisting = async (pipeline: string) => {
    setExisting(pipeline)
    setSaveAs('')
    if (!pipeline) return
    try {
      const cfg = await fetchPipeline(pipeline)
      setDataset(cfg.selected_dataset)
      setBudgetFrom(cfg.labeling_budget)
      setChosen(cfg.selected_strategies)
    } catch (e) {
      setError(e instanceof Error ? e.message : t().configurations.loadFailed)
    }
  }

  const blockers: string[] = []
  if (strategies.isError) blockers.push('strategies')
  if (selected.length === 0 && !strategies.isError) blockers.push('strategies')
  if (!activeDataset) blockers.push('Pick a dataset.')
  if (mode === 'new' && (!name || nameTaken)) blockers.push('name')
  if (mode === 'existing' && !existing) blockers.push('Select an existing pipeline.')
  const canSave = blockers.length === 0 && !saving

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const config = {
        selected_dataset: activeDataset,
        labeling_budget: budget,
        selected_strategies: selected,
      }
      const finalName = await savePipelineChoice({
        mode,
        name: mode === 'new' ? name : saveAs,
        originalName: mode === 'existing' ? existing : undefined,
        suffix,
        config,
        api: { createPipeline, updatePipeline, copyPipeline },
      })
      const previous = session.data.pipeline_path as string | undefined
      if (mode === 'new') await session.clear() // fresh pipeline starts without old folds
      else if (previous && previous !== finalName) await session.remove(['labeling_results']) // another pipeline's answers
      // The room follows the pipeline: a different one starts without the old one's cards and labels.
      if (room && me && isHost) await new RoomService(pb).switchPipeline(room, me.id, finalName)
      await session.update({
        pipeline_path: finalName,
        dataset_select: activeDataset,
        labeling_budget: budget,
        selected_strategies: selected,
      })
      navigate('/domain-folding')
    } catch (e) {
      setError(e instanceof Error ? e.message : t().configurations.saveFailed)
      setSaving(false)
    }
  }

  const datasetList = datasets.data ?? []
  const blockerText = !activeDataset
    ? c.pickDataset
    : mode === 'existing' && !existing
      ? c.pickPipeline
      : selected.length === 0 && !strategies.isError
        ? c.pickStrategy
        : nameTaken
          ? c.otherName
          : mode === 'new' && !name
            ? c.giveName
            : ''

  return (
    <div className="config-page">
      <div className="title-row">
        <h1>Configurations</h1>
        <InfoButton label={c.aboutStep} title="Configurations">
          <p>{c.infoIntro}</p>
          <h3>{c.infoWhat}</h3>
          <ol>
            <li>{c.infoStep1}</li>
            <li>{c.infoStep2}</li>
            <li>{c.infoStep3}</li>
          </ol>
        </InfoButton>
      </div>
      <p className="cfg-lead">{c.lead}</p>

      <Section title={c.pipeline} hint={c.pipelineHint}>
        <div className="cfg-segment" role="group" aria-label={c.pipelineMode}>
          <label className={mode === 'new' ? 'on' : ''}>
            <input type="radio" name="mode" checked={mode === 'new'} onChange={() => setMode('new')} />
            {c.createNew}
          </label>
          <label className={mode === 'existing' ? 'on' : ''}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
            />
            {c.useExisting}
          </label>
        </div>
        {mode === 'existing' && (
          <div className="field">
            <label htmlFor="existing">{c.existingPipeline}</label>
            <select id="existing" value={existing} onChange={(e) => void chooseExisting(e.target.value)}>
              <option value="">{c.selectPipelineOption}</option>
              {(pipelines.data ?? []).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
        )}
      </Section>

      <Section title={c.dataset} hint={c.datasetHint}>
        <select hidden id="dataset" aria-label={c.dataset} value={activeDataset} onChange={(e) => setDataset(e.target.value)}>
          {datasetList.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <div className="cfg-tiles" role="radiogroup" aria-label={c.chooseDataset}>
          {datasetList.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={d === activeDataset}
              className={`cfg-tile${d === activeDataset ? ' on' : ''}`}
              onClick={() => setDataset(d)}
            >
              <span className="cfg-tile-icon"><DbIcon /></span>
              <span className="cfg-tile-name">{d}</span>
              <span className="cfg-tile-check"><CheckIcon /></span>
            </button>
          ))}
        </div>
        {datasets.isLoading && <Loading className="cfg-muted">{c.loadingDatasets}</Loading>}

        <h3 className="cfg-sub">{c.tables}</h3>
        {tables.isError && <Notice kind="error">{(tables.error as Error).message}</Notice>}
        {tables.data && tables.data.length === 0 && (
          <Notice kind="info">{c.noTables}</Notice>
        )}
        {tables.data && tables.data.length > 0 && (
          <ul className="tables cfg-chips">
            {tables.data.map((tbl) => (
              <li key={tbl}>
                <button type="button" className="link" onClick={() => setOpenTable(tbl)}>
                  <TableIcon />
                  {tbl}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={c.budget} hint={c.budgetHint}>
        <div className="cfg-budget">
          <BudgetField value={budget} onChange={setBudget} />
        </div>
      </Section>

      <Section title={c.strategies} hint={c.strategiesHint}>
        <div className="cfg-strategies">
          <StrategyChecklist
            strategies={strategies.data ?? []}
            selected={selected}
            onChange={setChosen}
            error={strategies.isError}
            loading={strategies.isLoading}
          />
        </div>
      </Section>

      {mode === 'new' && (
        <Section title={c.pipelineName} hint={c.pipelineNameHint}>
          <div className="field">
            <input
              id="pipeline-name"
              aria-label={c.pipelineName}
              aria-invalid={nameTaken || undefined}
              value={name}
              onChange={(e) => setTypedName(e.target.value)}
            />
          </div>
          {nameTaken && (
            <Notice kind="warn">{c.nameTaken}</Notice>
          )}
        </Section>
      )}
      {mode === 'existing' && existing && (
        <Section title={c.saveAsTitle}>
          <div className="field">
            <label htmlFor="save-as">{c.saveAs}</label>
            <input
              id="save-as"
              value={saveAs}
              placeholder={existing}
              onChange={(e) => setSaveAs(e.target.value)}
            />
          </div>
          <p className="cfg-muted">{c.saveAsHint}</p>
        </Section>
      )}

      {error && <Notice kind="error">{error}</Notice>}

      {openTable && activeDataset && (
        <TableModal dataset={activeDataset} table={openTable} onClose={() => setOpenTable(null)} />
      )}

      <div className="cfg-bar">
        <Link className="btn btn-ghost" to="/lobby">
          {c.back}
        </Link>
        <StepSlot />
        <span className="cfg-hint" aria-live="polite">{blockerText}</span>
        <Button loading={saving} disabled={!canSave} onClick={() => void save()}>
          {c.continue}
        </Button>
      </div>
    </div>
  )
}
