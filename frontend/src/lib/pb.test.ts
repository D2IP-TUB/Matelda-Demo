import { describe, expect, it, vi } from 'vitest'

describe('pb client', () => {
  it('does not auto-cancel concurrent identical requests', async () => {
    const calls: Array<RequestInit | undefined> = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      calls.push(init)
      return new Response('{"items":[],"page":1,"perPage":500,"totalItems":0,"totalPages":0}', {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }))
    const { pb } = await import('./pb')
    await Promise.all([
      pb.collection('rooms').getFullList({ filter: 'a' }),
      pb.collection('rooms').getFullList({ filter: 'b' }),
    ])
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => !c?.signal?.aborted)).toBe(true)
  })
})
