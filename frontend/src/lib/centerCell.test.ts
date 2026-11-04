import { centerOffset } from './centerCell'

describe('centerOffset', () => {
  it('moves the cell centre onto the box centre', () => {
    // box 400x500 -> centre (200, 250); cell centre (60, 35)
    expect(centerOffset({ width: 400, height: 500 }, { left: 10, top: 20, width: 100, height: 30 })).toEqual({ x: 140, y: 215 })
  })

  it('shifts left/up when the cell is far right/down in a large table', () => {
    expect(centerOffset({ width: 400, height: 500 }, { left: 1000, top: 800, width: 100, height: 40 })).toEqual({ x: -850, y: -570 })
  })

  it('needs no shift when the cell is already centred', () => {
    expect(centerOffset({ width: 400, height: 500 }, { left: 150, top: 235, width: 100, height: 30 })).toEqual({ x: 0, y: 0 })
  })
})
