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

export const moveFoldToDomain = (name: string, fold: string, toDomain: string) =>
  editFolds(
    api.POST('/api/pipelines/{name}/cell-folds/move-fold', {
      params: { path: { name } },
      body: { fold, to_domain: toDomain },
    }),
    'Could not move the fold',
  )

export const mergeDomains = (name: string, domain: string, into: string) =>
  editFolds(
    api.POST('/api/pipelines/{name}/cell-folds/merge-domain', {
      params: { path: { name } },
      body: { domain, into },
    }),
    'Could not merge the domains',
  )

export const splitDomain = (name: string, domain: string, afterFold: string) =>
  editFolds(
    api.POST('/api/pipelines/{name}/cell-folds/split-domain', {
      params: { path: { name } },
      body: { domain, after_fold: afterFold },
    }),
    'Could not split the domain',
  )

export const setFoldLabel = (name: string, fold: string, label: 'correct' | 'false' | null) =>
  editFolds(
    api.PUT('/api/pipelines/{name}/cell-folds/label', {
      params: { path: { name } },
      body: { fold, label },
    }),
    'Could not set the label',
  )

// ---------------------------------------------------------------- labeling, detection, results
export type Card = components['schemas']['Card']
export type LabeledCell = components['schemas']['LabeledCell']
export type RoomLabel = components['schemas']['RoomLabel']
export type Verdict = components['schemas']['Verdict']
export type PropagationPage = components['schemas']['PropagationPage']
export type DetectionSummary = components['schemas']['DetectionSummary']
export type ErrorsPage = components['schemas']['ErrorsPage']
export type ResultsSummary = components['schemas']['ResultsSummary']
export type AccuracyPage = components['schemas']['AccuracyPage']

export async function fetchLabelingSample(name: string) {
  const { data, error } = await api.GET('/api/pipelines/{name}/labeling/sample', {
    params: { path: { name } },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not load the cells to label'))
  return data
}

export async function fetchCandidates(name: string) {
  const { data, error } = await api.GET('/api/pipelines/{name}/labeling/candidates', {
    params: { path: { name } },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not load the candidate cells'))
  return data
}

export async function fetchCards(name: string, keys: string[]): Promise<Card[]> {
  const { data, error } = await api.POST('/api/pipelines/{name}/labeling/cards', {
    params: { path: { name } },
    body: { keys },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not load the cards'))
  return data
}

export async function judgeVerdicts(dataset: string, verdicts: Verdict[]): Promise<(boolean | null)[]> {
  const { data, error } = await api.POST('/api/datasets/{dataset}/judge', {
    params: { path: { dataset } },
    body: { verdicts },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not check the verdicts'))
  return data.correct
}

export async function startPropagation(
  name: string,
  body: { own: LabeledCell[]; room_labels?: RoomLabel[]; player_id?: string | null },
): Promise<string> {
  const { data, error } = await api.POST('/api/pipelines/{name}/labeling/propagate', {
    params: { path: { name } },
    body: { own: body.own, room_labels: body.room_labels ?? [], player_id: body.player_id ?? undefined },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not start label propagation'))
  return data.job_id
}

/**
 * Resolves to null when label propagation has not run yet (409). Throwing there would make react-query retry
 * a "not yet" answer three times with backoff, leaving the page on "Loading results…" for ~7 s.
 */
export async function fetchPropagation(name: string, offset: number, limit: number): Promise<PropagationPage | null> {
  const { data, error, response } = await api.GET('/api/pipelines/{name}/propagation', {
    params: { path: { name }, query: { offset, limit } },
  })
  if (response.status === 409) return null
  if (error || !data) throw new Error(detailOf(error, 'Could not load the propagation results'))
  return data
}

export async function startErrorDetection(name: string): Promise<string> {
  const { data, error } = await api.POST('/api/pipelines/{name}/error-detection', {
    params: { path: { name } },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not start error detection'))
  return data.job_id
}

/** Resolves to null when there is no result yet. */
export async function fetchErrorDetection(name: string): Promise<DetectionSummary | null> {
  const { data, response, error } = await api.GET('/api/pipelines/{name}/error-detection', {
    params: { path: { name } },
  })
  if (response.status === 404) return null
  if (error || !data) throw new Error(detailOf(error, 'Could not load the error detection result'))
  return data
}

export async function fetchDetectedErrors(
  name: string,
  table: string,
  offset: number,
  limit: number,
): Promise<ErrorsPage> {
  const { data, error } = await api.GET('/api/pipelines/{name}/error-detection/errors', {
    params: { path: { name }, query: { table, offset, limit } },
  })
  if (error || !data) throw new Error(detailOf(error, 'Could not load the detected errors'))
  return data
}

export async function fetchResults(name: string): Promise<ResultsSummary> {
  const { data, error } = await api.GET('/api/pipelines/{name}/results', { params: { path: { name } } })
  if (error || !data) throw new Error(detailOf(error, 'Could not load the results'))
  return data
}

/** The labels compared with the truth, or `null` when no labels are saved yet (the labeling step has not run). */
export async function fetchLabelAccuracy(name: string, offset: number, limit: number): Promise<AccuracyPage | null> {
  const { data, error, response } = await api.GET('/api/pipelines/{name}/label-accuracy', {
    params: { path: { name }, query: { offset, limit } },
  })
  if (response.status === 409) return null
  if (error || !data) throw new Error(detailOf(error, 'Could not load the labeling accuracy'))
  return data
}
