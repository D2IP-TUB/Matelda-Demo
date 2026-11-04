// Word lists copied from components/room_store.py.
const ADJECTIVES = [
  'Blue', 'Sneaky', 'Fluffy', 'Grumpy', 'Cosmic', 'Wobbly', 'Turbo', 'Sleepy',
  'Dizzy', 'Funky', 'Spicy', 'Mighty', 'Lazy', 'Jolly', 'Quirky', 'Salty',
]
const NOUNS = [
  'Banana', 'Penguin', 'Waffle', 'Llama', 'Pickle', 'Narwhal', 'Muffin', 'Otter',
  'Taco', 'Walrus', 'Noodle', 'Badger', 'Pretzel', 'Koala', 'Falafel', 'Yeti',
]

type Rng = () => number
const pick = <T,>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)]

export function generateRoomName(rng: Rng = Math.random): string {
  const number = 10 + Math.floor(rng() * 90)
  return `${pick(ADJECTIVES, rng)}-${pick(NOUNS, rng)}-${number}`.toLowerCase()
}

export function generatePlayerName(taken: Set<string>, rng: Rng = Math.random): string | null {
  for (let attempt = 0; attempt < 50; attempt++) {
    const name = `${pick(ADJECTIVES, rng)} ${pick(NOUNS, rng)}`
    if (!taken.has(name)) return name
  }
  return null
}
