import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fetchJob } from '../lib/api'
import { useJob } from './useJob'

vi.mock('../lib/api', () => ({ fetchJob: vi.fn() }))
const mockFetchJob = vi.mocked(fetchJob)

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const running = { id: 'j', state: 'running' as const }

describe('useJob', () => {
  beforeEach(() => mockFetchJob.mockReset())

  it('is idle without a job id and never fetches', () => {
    const { result } = renderHook(() => useJob(null, 5), { wrapper })
    expect(result.current.state).toBe('idle')
    expect(mockFetchJob).not.toHaveBeenCalled()
  })

  it('polls while running and returns the result when done', async () => {
    mockFetchJob
      .mockResolvedValueOnce(running)
      .mockResolvedValue({ id: 'j', state: 'done', result: { domain_folds: { a: ['t'] } } })
    const { result } = renderHook(() => useJob<{ domain_folds: object }>('j', 5), { wrapper })
    expect(result.current.state).toBe('running')
    await waitFor(() => expect(result.current.state).toBe('done'))
    expect(result.current.result).toEqual({ domain_folds: { a: ['t'] } })
  })

  it('exposes the error of a failed job', async () => {
    mockFetchJob.mockResolvedValue({ id: 'j', state: 'failed', error: 'boom' })
    const { result } = renderHook(() => useJob('j', 5), { wrapper })
    await waitFor(() => expect(result.current.state).toBe('failed'))
    expect(result.current.error).toBe('boom')
  })

  it('reports a lost job and stops polling', async () => {
    mockFetchJob.mockResolvedValue('lost')
    const { result } = renderHook(() => useJob('j', 5), { wrapper })
    await waitFor(() => expect(result.current.state).toBe('lost'))
    const calls = mockFetchJob.mock.calls.length
    await new Promise((r) => setTimeout(r, 50))
    expect(mockFetchJob.mock.calls.length).toBe(calls)
  })
})
