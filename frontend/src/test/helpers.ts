import type { FakePocketBase } from './fakePocketBase'

/** Pre-create a PocketBase session record and return a storage that points at it. */
export function seedSession(pb: FakePocketBase, data: Record<string, unknown>, sid = 's1234567890abcdef') {
  pb.data.sessions = [{ id: 'sess1', sid, data }]
  return { getItem: () => sid, setItem: () => {} }
}
