import { randomToken } from '../lib/id'
import { generatePlayerName, generateRoomName, pickWinningDataset } from './names'

export interface Room {
  id: string
  name: string
  phase: 'lobby' | 'labeling'
  dataset: string
}

export interface Player {
  id: string
  room: string
  token: string
  name: string
  budget: number
  vote: string
}

export class RoomError extends Error {}

// The slice of the PocketBase SDK this service needs (also satisfied by the test fake).
interface CollectionLike {
  getFullList(options?: { filter?: string; sort?: string }): Promise<any[]>
  create(body: Record<string, unknown>): Promise<any>
  update(id: string, body: Record<string, unknown>): Promise<any>
  subscribe(topic: string, callback: (event?: any) => void): Promise<() => Promise<void>>
}
export interface PbLike {
  collection(name: string): CollectionLike
}

const eq = (field: string, value: string) => `${field}="${value.replace(/"/g, '\\"')}"`
const isConflict = (e: unknown) => (e as { status?: number })?.status === 400

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
}
