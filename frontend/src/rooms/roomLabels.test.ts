import { FakePocketBase } from '../test/fakePocketBase'
import { RoomService } from './roomService'
import type { Player, Room } from './roomService'

async function setup() {
  const pb = new FakePocketBase()
  const service = new RoomService(pb as any)
  const room = await service.createRoom()
  const a = await service.joinRoom(room.name)
  const b = await service.joinRoom(room.name)
  return { pb, service, room, a, b }
}

const KEYS = ['k1', 'k2', 'k3', 'k4']

describe('claimCells', () => {
  it('claims the first free candidates in order', async () => {
    const { service, room, a } = await setup()
    expect(await service.claimCells(room.name, a.id, KEYS, 2)).toEqual(['k1', 'k2'])
  })

  it('returns the player\'s own earlier claims first', async () => {
    const { service, room, a } = await setup()
    await service.claimCells(room.name, a.id, ['k3'], 1)
    expect(await service.claimCells(room.name, a.id, KEYS, 2)).toEqual(['k3', 'k1'])
  })

  it('a second call (reload) does not claim more', async () => {
    const { pb, service, room, a } = await setup()
    await service.claimCells(room.name, a.id, KEYS, 2)
    await service.claimCells(room.name, a.id, KEYS, 2)
    expect(pb.data.claims).toHaveLength(2)
  })

  it('skips cells claimed by another player', async () => {
    const { service, room, a, b } = await setup()
    await service.claimCells(room.name, b.id, ['k1'], 1)
    expect(await service.claimCells(room.name, a.id, KEYS, 2)).toEqual(['k2', 'k3'])
  })

  it('two players never hold the same cell', async () => {
    const { service, room, a, b } = await setup()
    const first = await service.claimCells(room.name, a.id, KEYS, 3)
    const second = await service.claimCells(room.name, b.id, KEYS, 3)
    expect(first).toEqual(['k1', 'k2', 'k3'])
    expect(second).toEqual(['k4'])
    expect(first.filter((k) => second.includes(k))).toEqual([])
  })

  it('returns what exists when there are fewer candidates than the budget', async () => {
    const { service, room, a } = await setup()
    expect(await service.claimCells(room.name, a.id, ['k1'], 5)).toEqual(['k1'])
  })
})

describe('labels, runs and stats', () => {
  it('saveLabel creates and then overwrites a single record per player and cell', async () => {
    const { pb, service, room, a } = await setup()
    await service.saveLabel(room.name, a.id, 'k1', true, true, 800)
    await service.saveLabel(room.name, a.id, 'k1', false, false, 500)
    expect(pb.data.labels).toHaveLength(1)
    expect(pb.data.labels[0]).toMatchObject({ value: false, is_correct: false, latency_ms: 500 })
  })

  it('roomLabels lists all labels of the room', async () => {
    const { service, room, a, b } = await setup()
    await service.saveLabel(room.name, a.id, 'k1', true, true, 1)
    await service.saveLabel(room.name, b.id, 'k1', false, false, 2)
    expect((await service.roomLabels(room.name)).map((l) => l.player).sort()).toEqual([a.id, b.id].sort())
  })

  it('getPlayer finds a player by token within the room only', async () => {
    const { service, room, a } = await setup()
    expect((await service.getPlayer(room.name, a.token))?.id).toBe(a.id)
    expect(await service.getPlayer('other-room', a.token)).toBeNull()
  })

  it('playerStats aggregates and sorts players', async () => {
    const { service, room, a, b } = await setup()
    for (const [i, correct] of [true, true, false].entries()) {
      await service.saveLabel(room.name, a.id, `x${i}`, correct, correct, 1000 + i * 1000)
    }
    await service.saveLabel(room.name, b.id, 'y0', false, true, 400)
    const stats = await service.playerStats(room.name)
    expect(stats.map((s) => s.id)).toEqual([a.id, b.id])
    expect(stats[0]).toMatchObject({ labels: 3, correct: 2, median_ms: 2000 })
    expect(stats[0].accuracy).toBeCloseTo(2 / 3)
    expect(stats[0].error_share).toBeCloseTo(1 / 3)
    expect(stats[1]).toMatchObject({ labels: 1, correct: 1, error_share: 1 })
  })

  it('players without labels are not in the stats', async () => {
    const { service, room } = await setup()
    expect(await service.playerStats(room.name)).toEqual([])
  })

  it('saveRun records the metrics with the room dataset', async () => {
    const { pb, service, room, a } = await setup()
    const started: Room = { ...room, phase: 'labeling', dataset: 'beers' }
    await service.saveRun(started, a as Player, 10, 0.5, 0.4, 0.44)
    expect(pb.data.runs[0]).toMatchObject({
      room: room.name, player: a.id, player_name: a.name, dataset: 'beers', budget: 10, precision: 0.5, recall: 0.4, f1: 0.44,
    })
  })
})
