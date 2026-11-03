import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BudgetField, StrategyChecklist } from '../components/forms'
import { Button, Card, Notice } from '../components/ui'
import { clampBudget, ensureSuffix, savePipelineChoice } from '../configurations/pipelineFlow'
import {
  copyPipeline,
  createPipeline,
  fetchDatasets,
  fetchPipeline,
  fetchPipelines,
  fetchStrategies,
  suggestPipelineName,
  updatePipeline,
} from '../lib/api'
import { useSession } from '../session/SessionProvider'

export function Configurations() {
  const session = useSession()
  const navigate = useNavigate()
  const suffix = session.sid.slice(0, 6)

  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [dataset, setDataset] = useState('')
  const [budget, setBudget] = useState(10)
  const [chosen, setChosen] = useState<string[] | null>(null) // null = all strategies
  const [typedName, setTypedName] = useState<string | null>(null)
  const [existing, setExisting] = useState('')
  const [saveAs, setSaveAs] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const datasets = useQuery({ queryKey: ['datasets'], queryFn: fetchDatasets })
  const strategies = useQuery({ queryKey: ['strategies'], queryFn: fetchStrategies })
  const pipelines = useQuery({ queryKey: ['pipelines'], queryFn: fetchPipelines })

  const sessionDataset = session.data.dataset_select as string | undefined
  const activeDataset = dataset || sessionDataset || datasets.data?.[0] || ''
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
      setError(e instanceof Error ? e.message : 'Could not load the pipeline')
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
      if (mode === 'new') await session.clear() // fresh pipeline starts without old folds
      await session.update({
        pipeline_path: finalName,
        dataset_select: activeDataset,
        labeling_budget: budget,
        selected_strategies: selected,
      })
      navigate('/domain-folding')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the pipeline')
      setSaving(false)
    }
  }

  return (
    <>
      <h1>Configurations</h1>

      <Card title="Pipeline">
        <div className="row">
          <label>
            <input type="radio" name="mode" checked={mode === 'new'} onChange={() => setMode('new')} />
            Create new pipeline
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
            />
            Use existing pipeline
          </label>
        </div>
        {mode === 'existing' && (
          <div className="field">
            <label htmlFor="existing">Existing pipeline</label>
            <select id="existing" value={existing} onChange={(e) => void chooseExisting(e.target.value)}>
              <option value="">— select a pipeline —</option>
              {(pipelines.data ?? []).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
        )}
      </Card>

      <Card title="Dataset">
        <div className="field">
          <label htmlFor="dataset">Dataset</label>
          <select id="dataset" value={activeDataset} onChange={(e) => setDataset(e.target.value)}>
            {(datasets.data ?? []).map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
      </Card>

      <Card title="Labeling budget">
        <BudgetField value={budget} onChange={setBudget} />
      </Card>

      <Card title="Error detection strategies">
        <StrategyChecklist
          strategies={strategies.data ?? []}
          selected={selected}
          onChange={setChosen}
          error={strategies.isError}
        />
      </Card>

      {mode === 'new' && (
        <Card title="Pipeline name">
          <div className="field">
            <label htmlFor="pipeline-name">Pipeline name</label>
            <input id="pipeline-name" value={name} onChange={(e) => setTypedName(e.target.value)} />
          </div>
          {nameTaken && (
            <Notice kind="warn">A pipeline with that name already exists. Please choose a different name.</Notice>
          )}
        </Card>
      )}
      {mode === 'existing' && existing && (
        <Card title="Save as (optional)">
          <div className="field">
            <label htmlFor="save-as">Save as</label>
            <input
              id="save-as"
              value={saveAs}
              placeholder={existing}
              onChange={(e) => setSaveAs(e.target.value)}
            />
          </div>
          <p>Leave blank to overwrite this pipeline. A different name makes a copy and keeps its results.</p>
        </Card>
      )}

      {error && <Notice kind="error">{error}</Notice>}

      <div className="nav-row">
        <Link className="btn btn-ghost" to="/intro">
          Back
        </Link>
        <Button disabled={!canSave} onClick={() => void save()}>
          Next
        </Button>
      </div>
    </>
  )
}
