import createClient from 'openapi-fetch'
import type { paths } from './schema'

// Types come from FastAPI's OpenAPI schema (npm run gen:api). Paths already include /api.
export const api = createClient<paths>({ baseUrl: '' })

export async function fetchDatasets(): Promise<string[]> {
  const { data, error } = await api.GET('/api/datasets')
  if (error || !data) throw new Error('Could not load datasets')
  return data
}
