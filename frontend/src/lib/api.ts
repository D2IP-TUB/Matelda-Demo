import createClient from 'openapi-fetch'
import type { components, paths } from './schema'

// Types come from FastAPI's OpenAPI schema (npm run gen:api). Paths already include /api.
export const api = createClient<paths>({ baseUrl: '' })

export async function fetchDatasets(): Promise<string[]> {
  const { data, error } = await api.GET('/api/datasets')
  if (error || !data) throw new Error('Could not load datasets')
  return data
}

export interface JobInfo {
  id: string
  state: 'running' | 'done' | 'failed'
  result?: unknown
  error?: string | null
}

/** Returns the job, or 'lost' when the API no longer knows it (e.g. after a restart). */
export async function fetchJob(id: string): Promise<JobInfo | 'lost'> {
  const { data, response } = await api.GET('/api/jobs/{job_id}', {
    params: { path: { job_id: id } },
  })
  if (response.status === 404) return 'lost'
  if (!data) throw new Error(`Could not read job ${id}`)
  return data as JobInfo
}

export async function startDatasetDomainFolding(dataset: string, labelingBudget: number): Promise<string> {
  const { data, error } = await api.POST('/api/folding/domain', {
    body: { dataset, labeling_budget: labelingBudget },
  })
  if (error || !data) throw new Error('Could not start domain folding')
  return data.job_id
}

export type TablePage = components['schemas']['TablePage']
export type CompareResult = components['schemas']['CompareResult']

function detailOf(error: unknown, fallback: string): string {
  const detail = (error as { detail?: unknown } | undefined)?.detail
  return typeof detail === 'string' ? detail : fallback
}

export async function fetchTables(dataset: string): Promise<string[]> {
  const { data, error } = await api.GET('/api/datasets/{dataset}/tables', {
    params: { path: { dataset } },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not load tables'))
  return data
}

export async function fetchDirtyPage(
  dataset: string,
  table: string,
  offset: number,
  limit: number,
): Promise<TablePage> {
  const { data, error } = await api.GET('/api/datasets/{dataset}/tables/{table}/dirty', {
    params: { path: { dataset, table }, query: { offset, limit } },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not load the table'))
  return data
}

export async function fetchCompare(
  dataset: string,
  table: string,
  offset: number,
  limit: number,
): Promise<CompareResult> {
  const { data, error } = await api.GET('/api/datasets/{dataset}/tables/{table}/compare', {
    params: { path: { dataset, table }, query: { offset, limit } },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not compare the table'))
  return data
}

export type PipelineConfig = components['schemas']['PipelineConfig']
export type PipelineConfigView = PipelineConfig & Record<string, unknown>

export async function fetchStrategies(): Promise<string[]> {
  const { data, error } = await api.GET('/api/strategies')
  if (error || !data) throw new Error('Could not load strategies')
  return data
}

export async function fetchPipelines(): Promise<string[]> {
  const { data, error } = await api.GET('/api/pipelines')
  if (error || !data) throw new Error('Could not load pipelines')
  return data
}

export async function fetchPipeline(name: string): Promise<PipelineConfigView> {
  const { data, error } = await api.GET('/api/pipelines/{name}', { params: { path: { name } } })
  if (error || !data) throw new Error(detailOf(error, 'Could not load the pipeline'))
  return data as PipelineConfigView
}

export async function suggestPipelineName(dataset: string, suffix: string): Promise<string> {
  const { data, error } = await api.GET('/api/pipelines/suggest-name', {
    params: { query: { dataset, suffix } },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not suggest a pipeline name'))
  return data.name
}

export async function createPipeline(name: string, config: PipelineConfig): Promise<string> {
  const { data, error } = await api.POST('/api/pipelines', { body: { name, config } })
  if (error || !data) throw new Error(detailOf(error, 'Could not create the pipeline'))
  return data.name
}

export async function updatePipeline(name: string, config: PipelineConfig): Promise<void> {
  const { error } = await api.PUT('/api/pipelines/{name}', {
    params: { path: { name } },
    body: config,
  })
  if (error) throw new Error(detailOf(error, 'Could not save the pipeline'))
}

export async function copyPipeline(name: string, newName: string): Promise<string> {
  const { data, error } = await api.POST('/api/pipelines/{name}/copy', {
    params: { path: { name } },
    body: { new_name: newName },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not copy the pipeline'))
  return data.name
}


export type FoldSummary = components['schemas']['FoldSummary']
export type CellView = components['schemas']['CellView']
export type CellRef = components['schemas']['CellRef']
export type CellPage = components['schemas']['CellPage']

export async function saveDomainFolds(
  name: string,
  domainFolds: Record<string, string[]>,
): Promise<Record<string, string[]>> {
  const { data, error } = await api.PUT('/api/pipelines/{name}/domain-folds', {
    params: { path: { name } },
    body: { domain_folds: domainFolds },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not save the domain folds'))
  return data
}

export async function startDomainFolding(name: string): Promise<string> {
  const { data, error } = await api.POST('/api/pipelines/{name}/domain-folding', {
    params: { path: { name } },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not start domain folding'))
  return data.job_id
}

export async function startQualityFolding(
  name: string,
  body: { labeling_budget: number; selected_strategies: string[] },
): Promise<string> {
  const { data, error } = await api.POST('/api/pipelines/{name}/quality-folding', {
    params: { path: { name } },
    body,
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not start quality folding'))
  return data.job_id
}

export async function fetchCellFolds(name: string): Promise<FoldSummary[]> {
  const { data, error } = await api.GET('/api/pipelines/{name}/cell-folds', {
    params: { path: { name } },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not load the cell folds'))
  return data
}

export async function fetchFoldCells(
  name: string,
  fold: string,
  offset: number,
  limit: number,
): Promise<CellPage> {
  const { data, error } = await api.GET('/api/pipelines/{name}/cell-folds/cells', {
    params: { path: { name }, query: { fold, offset, limit } },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not load the cells'))
  return data
}

async function editFolds(promise: Promise<{ data?: FoldSummary[]; error?: unknown }>, fallback: string) {
  const { data, error } = await promise
  if (error || !data) throw new Error(detailOf(error, fallback))
  return data
}

export const moveCell = (name: string, cell: CellRef, toFold: string) =>
  editFolds(
    api.POST('/api/pipelines/{name}/cell-folds/move', {
      params: { path: { name } },
      body: { cell, to_fold: toFold },
    }),
    'Could not move the cell',
  )

export const mergeCellFolds = (name: string, folds: string[]) =>
  editFolds(
    api.POST('/api/pipelines/{name}/cell-folds/merge', { params: { path: { name } }, body: { folds } }),
    'Could not merge the folds',
  )

export const splitCellFold = (name: string, fold: string, after: CellRef[]) =>
  editFolds(
    api.POST('/api/pipelines/{name}/cell-folds/split', {
      params: { path: { name } },
      body: { fold, after },
    }),
    'Could not split the fold',
  )

export const setFoldLabel = (name: string, fold: string, label: 'correct' | 'false' | null) =>
  editFolds(
    api.PUT('/api/pipelines/{name}/cell-folds/label', {
      params: { path: { name } },
      body: { fold, label },
    }),
    'Could not set the label',
  )
