import { generatePlayerName, generateRoomName } from './names'

describe('names', () => {
  it('generates lowercase adj-noun-NN room names', () => {
    expect(generateRoomName()).toMatch(/^[a-z]+-[a-z]+-\d{2}$/)
  })

  it('generates player names that avoid taken ones', () => {
    const first = generatePlayerName(new Set())!
    const second = generatePlayerName(new Set([first]))!
    expect(second).not.toBe(first)
    expect(first).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
  })

  it('returns null when every player name is taken', () => {
    const rng = () => 0
    const taken = new Set([generatePlayerName(new Set(), rng)!])
    expect(generatePlayerName(taken, rng)).toBeNull()
  })
})
