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

  it('refuses to start without votes', async () => {
    const { service } = setup()
    const room = await service.createRoom()
    await service.joinRoom(room.name)
    await expect(service.startRoom(room)).rejects.toThrow(RoomError)
  })

  it('starts with the winning dataset and is then a no-op', async () => {
    const { service } = setup()
    const room = await service.createRoom()
    const a = await service.joinRoom(room.name)
    const b = await service.joinRoom(room.name)
    await service.setVote(a, 'beers')
    await service.setVote(b, 'beers')
    const started = await service.startRoom(room)
    expect(started.phase).toBe('labeling')
    expect(started.dataset).toBe('beers')
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
