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

export async function startDomainFolding(dataset: string, labelingBudget: number): Promise<string> {
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
