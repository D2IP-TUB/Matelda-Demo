import { useQuery } from '@tanstack/react-query'
import { fetchJob } from '../lib/api'

export type JobView<T> = {
  state: 'idle' | 'running' | 'done' | 'failed' | 'lost'
  result?: T
  error?: string
}

/** Polls GET /api/jobs/{id} until the job is done, failed or lost. */
export function useJob<T = unknown>(jobId: string | null, intervalMs = 1000): JobView<T> {
  const query = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => fetchJob(jobId as string),
    enabled: jobId !== null,
    retry: false,
    refetchInterval: (q) => {
      const data = q.state.data
      return data && data !== 'lost' && data.state === 'running' ? intervalMs : false
    },
  })
  if (jobId === null) return { state: 'idle' }
  if (query.isError) return { state: 'failed', error: (query.error as Error).message }
  const data = query.data
  if (!data) return { state: 'running' }
  if (data === 'lost') return { state: 'lost' }
  return {
    state: data.state,
    result: data.result as T | undefined,
    error: data.error ?? undefined,
  }
}
