// In-memory stand-in for the parts of the PocketBase SDK that the app uses.
type Rec = Record<string, any>

const UNIQUE: Record<string, string[][]> = {
  rooms: [['name']],
  players: [['token'], ['room', 'name']],
  sessions: [['sid']],
  claims: [['room', 'cell_id']],
  labels: [['room', 'cell_id', 'player']],
}

function matches(rec: Rec, filter?: string): boolean {
  if (!filter) return true
  return filter.split(' && ').every((part) => {
    const m = part.trim().match(/^(\w+)="(.*)"$/)
    return m ? String(rec[m[1]]) === m[2].replace(/\\"/g, '"') : true
  })
}

export class FakeCollection {
  listeners: Array<() => void> = []
  private pb: FakePocketBase
  private name: string
  constructor(pb: FakePocketBase, name: string) {
    this.pb = pb
    this.name = name
  }
  private get rows(): Rec[] {
    return (this.pb.data[this.name] ??= [])
  }
  async getFullList(opts: { filter?: string; sort?: string } = {}): Promise<Rec[]> {
    return this.rows.filter((r) => matches(r, opts.filter)).map((r) => ({ ...r }))
  }
  async create(body: Rec): Promise<Rec> {
    const forced = this.pb.failures[this.name] ?? 0
    if (forced > 0) {
      this.pb.failures[this.name] = forced - 1
      throw Object.assign(new Error('unique'), { status: 400 })
    }
    for (const cols of UNIQUE[this.name] ?? []) {
      if (this.rows.some((r) => cols.every((c) => r[c] === body[c]))) {
        throw Object.assign(new Error('unique'), { status: 400 })
      }
    }
    const rec = { id: `id${this.pb.counter++}`, created: String(this.pb.counter), ...body }
    this.rows.push(rec)
    this.pb.notify(this.name)
    return { ...rec }
  }
  async update(id: string, body: Rec): Promise<Rec> {
    const rec = this.rows.find((r) => r.id === id)
    if (!rec) throw Object.assign(new Error('not found'), { status: 404 })
    Object.assign(rec, body)
    this.pb.notify(this.name)
    return { ...rec }
  }
  async delete(id: string): Promise<boolean> {
    const i = this.rows.findIndex((r) => r.id === id)
    if (i < 0) throw Object.assign(new Error('not found'), { status: 404 })
    this.rows.splice(i, 1)
    this.pb.notify(this.name)
    return true
  }
  async subscribe(_topic: string, cb: () => void): Promise<() => Promise<void>> {
    this.listeners.push(cb)
    return async () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }
}

export class FakePocketBase {
  data: Record<string, Rec[]> = {}
  failures: Record<string, number> = {}
  counter = 1
  private cols: Record<string, FakeCollection> = {}
  collection(name: string): FakeCollection {
    return (this.cols[name] ??= new FakeCollection(this, name))
  }
  failNextCreates(name: string, n: number) {
    this.failures[name] = n
  }
  notify(name: string) {
    this.collection(name).listeners.forEach((l) => l())
  }
}
