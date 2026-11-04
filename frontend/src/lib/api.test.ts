import { api, fetchPropagation } from './api'

afterEach(() => vi.restoreAllMocks())

describe('fetchPropagation', () => {
  it('resolves to null when label propagation has not run yet (409), so the page does not retry it', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { detail: 'Run label propagation first' },
      response: new Response(null, { status: 409 }),
    } as any)
    await expect(fetchPropagation('p1', 0, 20)).resolves.toBeNull()
  })

  it('still throws on other errors', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      error: { detail: 'Unknown pipeline' },
      response: new Response(null, { status: 404 }),
    } as any)
    await expect(fetchPropagation('p1', 0, 20)).rejects.toThrow('Unknown pipeline')
  })
})
