import { FakePocketBase } from '../test/fakePocketBase'
import { RoomError, RoomService } from './roomService'

function setup() {
  const pb = new FakePocketBase()
  return { pb, service: new RoomService(pb as any) }
}

describe('RoomService', () => {
  it('creates a lobby room and retries after a name conflict', async () => {
    const { pb, service } = setup()
    pb.failNextCreates('rooms', 2)
    const room = await service.createRoom()
    expect(room.phase).toBe('lobby')
    expect(room.name).toMatch(/^[a-z]+-[a-z]+-\d{2}$/)
  })

  it('returns null for an unknown room', async () => {
    expect(await setup().service.getRoom('nope')).toBeNull()
  })

  it('gives two joiners different names', async () => {
    const { service } = setup()
    const room = await service.createRoom()
    const a = await service.joinRoom(room.name)
    const b = await service.joinRoom(room.name)
    expect(a.name).not.toBe(b.name)
  })

  it('retries a join after a unique conflict', async () => {
    const { pb, service } = setup()
    const room = await service.createRoom()
    pb.failNextCreates('players', 1)
    const player = await service.joinRoom(room.name)
    expect(player.room).toBe(room.name)
  })

  it('rejoins with a token from the same room', async () => {
    const { service } = setup()
    const room = await service.createRoom()
    const a = await service.joinRoom(room.name)
    const again = await service.joinRoom(room.name, a.token)
    expect(again.id).toBe(a.id)
  })

  it('creates a new player when the token belongs to another room', async () => {
    const { service } = setup()
    const r1 = await service.createRoom()
    const r2 = await service.createRoom()
    const a = await service.joinRoom(r1.name)
    const b = await service.joinRoom(r2.name, a.token)
    expect(b.id).not.toBe(a.id)
    expect(b.token).not.toBe(a.token)
    expect(b.room).toBe(r2.name)
  })

  it('starts the room and is then a no-op', async () => {
    const { service } = setup()
    const room = await service.createRoom()
    await service.joinRoom(room.name)
    const started = await service.startRoom(room)
    expect(started.phase).toBe('labeling')
    const again = await service.startRoom(started)
    expect(again).toEqual(started)
  })

  it('notifies subscribers and stops after unsubscribe', async () => {
    const { service } = setup()
    const room = await service.createRoom()
    let calls = 0
    const stop = await service.subscribe(room.name, () => calls++)
    await service.joinRoom(room.name)
    expect(calls).toBeGreaterThan(0)
    const before = calls
    await stop()
    await service.joinRoom(room.name)
    expect(calls).toBe(before)
  })
})

describe('RoomService shared pool', () => {
  const KEYS = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6']

  async function pooled() {
    const pb = new FakePocketBase()
    const service = new RoomService(pb as any)
    const room = await service.createRoom()
    const a = await service.joinRoom(room.name)
    const b = await service.joinRoom(room.name)
    const hosted = await service.claimHost(room, a)
    return { pb, service, room: hosted, a, b }
  }

  it('claimHost: first caller wins, second is a no-op', async () => {
    const { service, room, a, b } = await pooled()
    expect(room.host).toBe(a.id)
    const again = await service.claimHost(room, b)
    expect(again.host).toBe(a.id)
  })

  it('publishPool stores fields once; first publisher wins', async () => {
    const { service, room, a } = await pooled()
    const pub = await service.publishPool(room, a.id, 'pipe1', KEYS)
    expect(pub.pipeline).toBe('pipe1')
    expect(pub.pool).toEqual(KEYS)
    const again = await service.publishPool(room, a.id, 'pipe2', ['x'])
    expect(again.pool).toEqual(KEYS)
    expect((await service.getRoom(room.name))!.pipeline).toBe('pipe1')
  })

  it('publishPool does not overwrite when the passed room is stale', async () => {
    const { service, room, a } = await pooled()
    await service.publishPool(room, a.id, 'pipe1', KEYS)
    const stale = { ...room, pool: [] as string[] }
    const res = await service.publishPool(stale, a.id, 'pipe2', ['x'])
    expect(res.pool).toEqual(KEYS)
    expect((await service.getRoom(room.name))!.pipeline).toBe('pipe1')
  })

  it('publishPool checks host against the fresh room', async () => {
    const { service, room, a, b } = await pooled()
    await expect(service.publishPool({ ...room, host: b.id }, b.id, 'p', KEYS)).rejects.toThrow(RoomError)
    expect(a.id).toBe(room.host)
  })

  it('release ignores claims that vanish before delete', async () => {
    const { pb, service, room, a, b } = await pooled()
    await service.claimNext(room.name, a.id, ['k1'])
    await service.claimNext(room.name, b.id, ['k2'])
    const col = pb.collection('claims')
    const orig = col.delete.bind(col)
    let first = true
    col.delete = async (id: string) => {
      if (first) {
        first = false
        await orig(id)
      }
      return orig(id)
    }
    expect(await service.releaseUnlabeledClaims(room.name)).toBe(1)
    expect(pb.data.claims).toHaveLength(0)
  })

  it('publishPool rejects non-hosts', async () => {
    const { service, room, b } = await pooled()
    await expect(service.publishPool(room, b.id, 'p', KEYS)).rejects.toThrow(RoomError)
  })

  it('claimNext skips own claims the caller already has', async () => {
    const { service, room, a } = await pooled()
    const first = await service.claimNext(room.name, a.id, KEYS)
    const second = await service.claimNext(room.name, a.id, KEYS, new Set([first as string]))
    expect(second).not.toBe(first)
    expect(second).not.toBeNull()
  })

  it('claimNext returns own unlabeled claim before taking a new one', async () => {
    const { service, room, a } = await pooled()
    const first = await service.claimNext(room.name, a.id, KEYS)
    expect(await service.claimNext(room.name, a.id, KEYS)).toBe(first)
    await service.saveLabel(room.name, a.id, first!, true, true, 10)
    const next = await service.claimNext(room.name, a.id, KEYS)
    expect(next).not.toBe(first)
    expect(next).not.toBeNull()
  })

  it('claimNext skips keys claimed by another player', async () => {
    const { pb, service, room, a, b } = await pooled()
    const theirs = await service.claimNext(room.name, b.id, KEYS)
    const mine = await service.claimNext(room.name, a.id, KEYS)
    expect(mine).not.toBe(theirs)
    expect(pb.data.claims).toHaveLength(2)
  })

  it('players with different ids start at different pool positions', async () => {
    const { service, room } = await pooled()
    const x = await service.claimNext(room.name, 'a', KEYS)
    const y = await service.claimNext(room.name, 'b', KEYS)
    expect(x).toBe(KEYS['a'.charCodeAt(0) % KEYS.length])
    expect(y).toBe(KEYS['b'.charCodeAt(0) % KEYS.length])
    expect(x).not.toBe(y)
  })

  it('claimNext moves on after a unique conflict', async () => {
    const { pb, service, room, a } = await pooled()
    pb.failNextCreates('claims', 1)
    const start = await service.claimNext(room.name, a.id, ['k1'])
    expect(start).toBeNull()
    pb.failNextCreates('claims', 1)
    const got = await service.claimNext(room.name, a.id, KEYS)
    expect(got).not.toBeNull()
    const off = [...a.id].reduce((s, ch) => s + ch.charCodeAt(0), 0) % KEYS.length
    expect(got).toBe(KEYS[(off + 1) % KEYS.length])
  })

  it('claimNext returns null when every key is claimed by others', async () => {
    const { service, room, a, b } = await pooled()
    for (let i = 0; i < 2; i++) await service.claimNext(room.name, b.id, ['k1', 'k2'])
    await service.saveLabel(room.name, b.id, 'k1', true, true, 1)
    await service.claimNext(room.name, b.id, ['k1', 'k2'])
    expect(await service.claimNext(room.name, a.id, ['k1', 'k2'])).toBeNull()
  })

  describe('progress', () => {
    const POOL = ['a', 'b', 'c']
    const label = (cell: string, player = 'p1') => ({ room: 'r1', cell_id: cell, player, value: true, is_correct: true, latency_ms: 1 })

    it('counts the pool cells that have a label and is done only when every one has', async () => {
      const { pb, service } = setup()
      pb.data.labels = [label('a'), label('b', 'p2')]
      expect(await service.progress('r1', POOL)).toEqual({ total: 3, labeled: 2, done: false })
      pb.data.labels.push(label('c'))
      expect(await service.progress('r1', POOL)).toEqual({ total: 3, labeled: 3, done: true })
    })

    it('ignores labels of other rooms and cells outside the pool', async () => {
      const { pb, service } = setup()
      pb.data.labels = [label('a'), { ...label('b'), room: 'other' }, label('zzz')]
      expect(await service.progress('r1', POOL)).toEqual({ total: 3, labeled: 1, done: false })
    })

    it('is never done for an empty pool', async () => {
      expect(await setup().service.progress('r1', [])).toEqual({ total: 0, labeled: 0, done: false })
    })
  })

  it('releaseUnlabeledClaims deletes only unlabeled claims and counts them', async () => {
    const { pb, service, room, a, b } = await pooled()
    await service.claimNext(room.name, a.id, ['k1'])
    await service.claimNext(room.name, b.id, ['k2'])
    await service.saveLabel(room.name, a.id, 'k1', true, true, 1)
    expect(await service.releaseUnlabeledClaims(room.name)).toBe(1)
    expect(pb.data.claims.map((c) => c.cell_id)).toEqual(['k1'])
  })

  it('releaseUnlabeledClaims(room, ms) keeps fresh claims and releases old ones', async () => {
    const { pb, service, room, a, b } = await pooled()
    await service.claimNext(room.name, a.id, ['k1'])
    await service.claimNext(room.name, b.id, ['k2'])
    pb.data.claims.find((c) => c.cell_id === 'k2')!.created = new Date(Date.now() - 300_000).toISOString()
    expect(await service.releaseUnlabeledClaims(room.name, 120_000)).toBe(1)
    expect(pb.data.claims.map((c) => c.cell_id)).toEqual(['k1'])
  })

  it('releaseUnlabeledClaims handles PocketBase timestamps and treats unparseable ones as fresh', async () => {
    const { pb, service, room, a, b } = await pooled()
    await service.claimNext(room.name, a.id, ['k1'])
    await service.claimNext(room.name, b.id, ['k2'])
    const pbTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ')
    pb.data.claims.find((c) => c.cell_id === 'k1')!.created = 'garbage'
    pb.data.claims.find((c) => c.cell_id === 'k2')!.created = pbTime(Date.now() - 300_000)
    expect(await service.releaseUnlabeledClaims(room.name, 120_000)).toBe(1)
    expect(pb.data.claims.map((c) => c.cell_id)).toEqual(['k1'])
  })

  it('escapes backslashes before quotes in filters', async () => {
    const pb = new FakePocketBase()
    const seen: string[] = []
    const col = pb.collection('rooms')
    const orig = col.getFullList.bind(col)
    col.getFullList = async (o: any = {}) => (seen.push(o.filter), orig(o))
    await new RoomService(pb as any).getRoom('a\\"b')
    expect(seen).toEqual(['name="a\\\\\\"b"'])
  })

  it('leaveRoom removes player and unlabeled claims, keeps labels', async () => {
    const { pb, service, room, a, b } = await pooled()
    await service.claimNext(room.name, a.id, ['k1'])
    await service.saveLabel(room.name, a.id, 'k1', true, true, 1)
    await service.claimNext(room.name, a.id, ['k1', 'k2'])
    await service.leaveRoom(room, a)
    expect(pb.data.claims.map((c) => c.cell_id)).toEqual(['k1'])
    expect(pb.data.labels).toHaveLength(1)
    expect((await service.listPlayers(room.name)).map((p) => p.id)).toEqual([b.id])
    expect((await service.getRoom(room.name))!.phase).toBe('ended')
  })

  it('keeps the room open when a non-host leaves, ends it when the host leaves', async () => {
    const { service, room, a, b } = await pooled()
    await service.leaveRoom(room, b)
    expect((await service.getRoom(room.name))!.phase).not.toBe('ended')
    await service.leaveRoom(room, a)
    expect((await service.getRoom(room.name))!.phase).toBe('ended')
  })

  it('kickPlayer rejects non-hosts and host-kick, otherwise cleans up', async () => {
    const { pb, service, room, a, b } = await pooled()
    await service.claimNext(room.name, b.id, ['k3'])
    await expect(service.kickPlayer(room, b.id, a)).rejects.toThrow(RoomError)
    await expect(service.kickPlayer(room, a.id, a)).rejects.toThrow(RoomError)
    await service.kickPlayer(room, a.id, b)
    expect(pb.data.claims).toHaveLength(0)
    expect((await service.listPlayers(room.name)).map((p) => p.id)).toEqual([a.id])
  })
})
