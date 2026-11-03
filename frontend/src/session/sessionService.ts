import { randomToken } from '../lib/id'
import type { PbLike } from '../rooms/roomService'

// Keys follow the Streamlit session keys (components/session_persistence.py), e.g.
// room_name, player_token, dataset_select, pipeline_path, labeling_budget,
// selected_strategies, domain_folds, cell_folds.
export type SessionData = Record<string, unknown>

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const SID_KEY = 'matelda.sid'
const ROOM_KEYS = ['room_name', 'player_token']

export class SessionService {
  private pb: PbLike
  private storage: StorageLike
  constructor(pb: PbLike, storage: StorageLike) {
    this.pb = pb
    this.storage = storage
  }

  private readSid(): string | null {
    try {
      return this.storage.getItem(SID_KEY)
    } catch {
      return null
    }
  }

  private writeSid(sid: string): void {
    try {
      this.storage.setItem(SID_KEY, sid)
    } catch {
      // Storage blocked: the session lives for this page load only.
    }
  }

  private async find(sid: string) {
    const rows = await this.pb
      .collection('sessions')
      .getFullList({ filter: `sid="${sid.replace(/"/g, '')}"` })
    return rows[0] ?? null
  }

  async load(): Promise<{ sid: string; data: SessionData }> {
    const stored = this.readSid()
    if (stored) {
      const rec = await this.find(stored)
      if (rec) return { sid: stored, data: rec.data ?? {} }
    }
    const sid = randomToken(16)
    await this.pb.collection('sessions').create({ sid, data: {} })
    this.writeSid(sid)
    return { sid, data: {} }
  }

  async save(sid: string, patch: SessionData): Promise<SessionData> {
    const rec = await this.find(sid)
    if (!rec) throw new Error('Session record missing')
    const data = { ...(rec.data ?? {}), ...patch }
    await this.pb.collection('sessions').update(rec.id, { data })
    return data
  }

  async clear(sid: string, keep: string[] = ROOM_KEYS): Promise<SessionData> {
    const rec = await this.find(sid)
    if (!rec) throw new Error('Session record missing')
    const old = (rec.data ?? {}) as SessionData
    const data = Object.fromEntries(Object.entries(old).filter(([k]) => keep.includes(k)))
    await this.pb.collection('sessions').update(rec.id, { data })
    return data
  }

  /** Delete the given keys from the persisted session data. */
  async remove(sid: string, keys: string[]): Promise<SessionData> {
    const rec = await this.find(sid)
    if (!rec) throw new Error('Session record missing')
    const old = (rec.data ?? {}) as SessionData
    const data = Object.fromEntries(Object.entries(old).filter(([k]) => !keys.includes(k)))
    await this.pb.collection('sessions').update(rec.id, { data })
    return data
  }
}
