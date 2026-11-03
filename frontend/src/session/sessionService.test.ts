import { FakePocketBase } from '../test/fakePocketBase'
import { SessionService } from './sessionService'

function memoryStorage(initial: Record<string, string> = {}) {
  const store = { ...initial }
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    store,
  }
}

describe('SessionService', () => {
  it('creates a session on first load and remembers the sid', async () => {
    const storage = memoryStorage()
    const service = new SessionService(new FakePocketBase() as any, storage)
    const { sid, data } = await service.load()
    expect(data).toEqual({})
    expect(storage.store['matelda.sid']).toBe(sid)
  })

  it('restores the same session and data on a second load', async () => {
    const pb = new FakePocketBase()
    const storage = memoryStorage()
    const first = await new SessionService(pb as any, storage).load()
    await new SessionService(pb as any, storage).save(first.sid, { room_name: 'r1' })
    const second = await new SessionService(pb as any, storage).load()
    expect(second.sid).toBe(first.sid)
    expect(second.data).toEqual({ room_name: 'r1' })
  })

  it('merges saves without dropping other keys', async () => {
    const service = new SessionService(new FakePocketBase() as any, memoryStorage())
    const { sid } = await service.load()
    await service.save(sid, { a: 1 })
    expect(await service.save(sid, { b: 2 })).toEqual({ a: 1, b: 2 })
  })

  it('creates a fresh session when the stored sid has no record', async () => {
    const storage = memoryStorage({ 'matelda.sid': 'ghost' })
    const service = new SessionService(new FakePocketBase() as any, storage)
    const { sid, data } = await service.load()
    expect(sid).not.toBe('ghost')
    expect(data).toEqual({})
  })

  it('still works when storage throws', async () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const service = new SessionService(new FakePocketBase() as any, broken)
    const { sid } = await service.load()
    expect(await service.save(sid, { a: 1 })).toEqual({ a: 1 })
  })

  it('clear keeps only the room keys by default', async () => {
    const service = new SessionService(new FakePocketBase() as any, memoryStorage())
    const { sid } = await service.load()
    await service.save(sid, { room_name: 'r', player_token: 't', domain_folds: { x: 1 } })
    expect(await service.clear(sid)).toEqual({ room_name: 'r', player_token: 't' })
  })
})
