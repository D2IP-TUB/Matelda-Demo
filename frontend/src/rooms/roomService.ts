import { randomToken } from '../lib/id'
import { generatePlayerName, generateRoomName, pickWinningDataset } from './names'

export interface Room {
  id: string
  name: string
  phase: 'lobby' | 'labeling' | 'ended'
  dataset: string
  pipeline?: string
  pool?: string[]
  host?: string
}

export interface Player {
  id: string
  room: string
  token: string
  name: string
  budget: number
  vote: string
}

export interface RoomLabelRecord {
  cell_id: string
  player: string
  value: boolean
  is_correct: boolean
  latency_ms: number
}

export interface PlayerStat {
  id: string
  name: string
  labels: number
  correct: number
  accuracy: number
  median_ms: number
  error_share: number
}

export class RoomError extends Error {}

// The slice of the PocketBase SDK this service needs (also satisfied by the test fake).
interface CollectionLike {
  getFullList(options?: { filter?: string; sort?: string }): Promise<any[]>
  create(body: Record<string, unknown>): Promise<any>
  update(id: string, body: Record<string, unknown>): Promise<any>
  delete(id: string): Promise<unknown>
  subscribe(topic: string, callback: (event?: any) => void): Promise<() => Promise<void>>
}
export interface PbLike {
  collection(name: string): CollectionLike
}

const eq = (field: string, value: string) => `${field}="${value.replace(/"/g, '\\"')}"`
const isConflict = (e: unknown) => (e as { status?: number })?.status === 400

const hashString = (s: string) => [...s].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)

export class RoomService {
  private pb: PbLike
  constructor(pb: PbLike) {
    this.pb = pb
  }

  async createRoom(): Promise<Room> {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        return await this.pb
          .collection('rooms')
          .create({ name: generateRoomName(), phase: 'lobby', dataset: '' })
      } catch (e) {
        if (!isConflict(e)) throw e
      }
    }
    throw new RoomError('Could not allocate a room name')
  }

  async getRoom(name: string): Promise<Room | null> {
    const rooms = await this.pb.collection('rooms').getFullList({ filter: eq('name', name) })
    return rooms[0] ?? null
  }

  async joinRoom(roomName: string, token?: string): Promise<Player> {
    if (token) {
      const mine = await this.pb
        .collection('players')
        .getFullList({ filter: `${eq('token', token)} && ${eq('room', roomName)}` })
      if (mine[0]) return mine[0]
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      const taken = new Set((await this.listPlayers(roomName)).map((p) => p.name))
      const name = generatePlayerName(taken)
      if (!name) break
      try {
        return await this.pb.collection('players').create({
          room: roomName, token: randomToken(), name, budget: 10, vote: '',
        })
      } catch (e) {
        if (!isConflict(e)) throw e
      }
    }
    throw new RoomError('No free player names left in this room')
  }

  async listPlayers(roomName: string): Promise<Player[]> {
    return this.pb
      .collection('players')
      .getFullList({ filter: eq('room', roomName), sort: 'created' })
  }

  async setVote(player: Player, dataset: string): Promise<void> {
    await this.pb.collection('players').update(player.id, { vote: dataset })
  }

  async startRoom(room: Room): Promise<Room> {
    if (room.phase !== 'lobby') return room
    const players = await this.listPlayers(room.name)
    const dataset = pickWinningDataset(players.map((p) => p.vote))
    if (!dataset) throw new RoomError('Nobody picked a dataset yet')
    return this.pb.collection('rooms').update(room.id, { phase: 'labeling', dataset })
  }

  async subscribe(roomName: string, onChange: () => void): Promise<() => Promise<void>> {
    const stopPlayers = await this.pb.collection('players').subscribe('*', (e) => {
      if (!e?.record || e.record.room === roomName) onChange()
    })
    const stopRooms = await this.pb.collection('rooms').subscribe('*', (e) => {
      if (!e?.record || e.record.name === roomName) onChange()
    })
    return async () => {
      await Promise.all([stopPlayers(), stopRooms()])
    }
  }

  async getPlayer(roomName: string, token: string): Promise<Player | null> {
    const found = await this.pb
      .collection('players')
      .getFullList({ filter: `${eq('token', token)} && ${eq('room', roomName)}` })
    return found[0] ?? null
  }

  /**
   * Claim up to n of the candidates for this player. Own earlier claims come first (so a reload
   * keeps the same cells), then further candidates in order; the unique (room, cell_id) index
   * decides races between players.
   */
  async claimCells(roomName: string, playerId: string, candidates: string[], n: number): Promise<string[]> {
    const claims = this.pb.collection('claims')
    const mine = new Set(
      (await claims.getFullList({ filter: `${eq('room', roomName)} && ${eq('player', playerId)}` })).map(
        (c) => c.cell_id as string,
      ),
    )
    const got = candidates.filter((c) => mine.has(c)).slice(0, n)
    for (const cellId of candidates) {
      if (got.length >= n) break
      if (mine.has(cellId)) continue
      try {
        await claims.create({ room: roomName, cell_id: cellId, player: playerId })
        got.push(cellId)
      } catch (e) {
        if (!isConflict(e)) throw e
      }
    }
    return got
  }

  async claimHost(room: Room, player: Player): Promise<Room> {
    const current = (await this.getRoom(room.name)) ?? room
    if (current.host) return current
    return this.pb.collection('rooms').update(room.id, { host: player.id })
  }

  async publishPool(room: Room, hostPlayerId: string, pipeline: string, keys: string[]): Promise<Room> {
    const fresh = (await this.getRoom(room.name)) ?? room
    if (fresh.host !== hostPlayerId) throw new RoomError('Only the host can publish the pool')
    if (fresh.pool && fresh.pool.length > 0) return fresh
    return this.pb.collection('rooms').update(room.id, { pipeline, pool: keys, host: hostPlayerId })
  }

  async endRoom(room: Room, hostId: string): Promise<Room> {
    if (room.host !== hostId) throw new RoomError('Only the host can end the room')
    return this.pb.collection('rooms').update(room.id, { phase: 'ended' })
  }

  async leaveRoom(room: Room, player: Player): Promise<void> {
    await this.releasePlayerClaims(room.name, player.id)
    await this.pb.collection('players').delete(player.id)
    if (player.id === room.host) {
      const rest = (await this.listPlayers(room.name)).filter((p) => p.id !== player.id)
      await this.pb.collection('rooms').update(room.id, { host: rest[0]?.id ?? '' })
    }
  }

  async kickPlayer(room: Room, hostId: string, target: Player): Promise<void> {
    if (room.host !== hostId) throw new RoomError('Only the host can remove players')
    if (target.id === hostId) throw new RoomError('The host cannot be removed')
    await this.leaveRoom(room, target)
  }

  private async labeledCells(roomName: string): Promise<Set<string>> {
    const labels = await this.pb.collection('labels').getFullList({ filter: eq('room', roomName) })
    return new Set(labels.map((l) => `${l.cell_id}\u0000${l.player}`))
  }

  private async deleteClaims(stale: Array<{ id: string }>): Promise<number> {
    let n = 0
    for (const c of stale) {
      try {
        await this.pb.collection('claims').delete(c.id)
        n++
      } catch (e) {
        if ((e as { status?: number })?.status !== 404) throw e
      }
    }
    return n
  }

  private async releasePlayerClaims(roomName: string, playerId: string): Promise<number> {
    const claims = this.pb.collection('claims')
    const [mine, done] = await Promise.all([
      claims.getFullList({ filter: `${eq('room', roomName)} && ${eq('player', playerId)}` }),
      this.labeledCells(roomName),
    ])
    const stale = mine.filter((c) => !done.has(`${c.cell_id}\u0000${playerId}`))
    return this.deleteClaims(stale)
  }

  /** Deletes unlabeled claims; with `olderThanMs` only those created longer ago than that. */
  async releaseUnlabeledClaims(roomName: string, olderThanMs = 0): Promise<number> {
    const claims = this.pb.collection('claims')
    const [all, done] = await Promise.all([
      claims.getFullList({ filter: eq('room', roomName) }),
      this.labeledCells(roomName),
    ])
    const cutoff = Date.now() - olderThanMs
    const stale = all.filter(
      (c) =>
        !done.has(`${c.cell_id}\u0000${c.player}`) &&
        (olderThanMs <= 0 || !(Date.parse(String(c.created)) > cutoff)),
    )
    return this.deleteClaims(stale)
  }

  /** Oldest own unlabeled claim (except `skip`, cards the caller already has), else claim the first free pool key from a per-player offset. */
  async claimNext(
    roomName: string,
    playerId: string,
    pool: string[],
    skip: ReadonlySet<string> = new Set(),
  ): Promise<string | null> {
    const claims = this.pb.collection('claims')
    const [all, done] = await Promise.all([
      claims.getFullList({ filter: eq('room', roomName), sort: 'created' }),
      this.labeledCells(roomName),
    ])
    const own = all.find(
      (c) => c.player === playerId && !skip.has(c.cell_id as string) && !done.has(`${c.cell_id}\u0000${playerId}`),
    )
    if (own) return own.cell_id as string
    if (pool.length === 0) return null
    const taken = new Set(all.map((c) => c.cell_id as string))
    const start = hashString(playerId) % pool.length
    for (let i = 0; i < pool.length; i++) {
      const key = pool[(start + i) % pool.length]
      if (taken.has(key)) continue
      try {
        await claims.create({ room: roomName, cell_id: key, player: playerId })
        return key
      } catch (e) {
        if (!isConflict(e)) throw e
      }
    }
    return null
  }

  async saveLabel(
    roomName: string,
    playerId: string,
    cellId: string,
    value: boolean,
    isCorrect: boolean | null,
    latencyMs: number,
  ): Promise<void> {
    const labels = this.pb.collection('labels')
    const body = {
      room: roomName, player: playerId, cell_id: cellId, value,
      is_correct: !!isCorrect, latency_ms: latencyMs,
    }
    try {
      await labels.create(body)
    } catch (e) {
      if (!isConflict(e)) throw e
      const existing = await labels.getFullList({
        filter: `${eq('room', roomName)} && ${eq('cell_id', cellId)} && ${eq('player', playerId)}`,
      })
      if (existing[0]) await labels.update(existing[0].id, body)
    }
  }

  async roomLabels(roomName: string): Promise<RoomLabelRecord[]> {
    return this.pb.collection('labels').getFullList({ filter: eq('room', roomName) })
  }

  async playerStats(roomName: string): Promise<PlayerStat[]> {
    const [players, labels] = await Promise.all([this.listPlayers(roomName), this.roomLabels(roomName)])
    const stats: PlayerStat[] = []
    for (const p of players) {
      const mine = labels.filter((l) => l.player === p.id)
      if (mine.length === 0) continue
      const correct = mine.filter((l) => l.is_correct).length
      const times = mine.map((l) => l.latency_ms).sort((x, y) => x - y)
      const mid = Math.floor(times.length / 2)
      const median = times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2
      stats.push({
        id: p.id,
        name: p.name,
        labels: mine.length,
        correct,
        accuracy: correct / mine.length,
        median_ms: Math.trunc(median),
        error_share: mine.filter((l) => !l.value).length / mine.length,
      })
    }
    return stats.sort((x, y) => y.correct - x.correct || y.labels - x.labels)
  }

  async saveRun(
    room: Room,
    player: Player,
    budget: number,
    precision: number,
    recall: number,
    f1: number,
  ): Promise<void> {
    await this.pb.collection('runs').create({
      room: room.name, player: player.id, player_name: player.name, dataset: room.dataset ?? '',
      budget, precision, recall, f1,
    })
  }
}
