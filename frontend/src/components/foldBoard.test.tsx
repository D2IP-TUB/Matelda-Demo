import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DragGhost, FoldBox, edgeSpeed, useDragController } from './foldBoard'

describe('edgeSpeed', () => {
  it('is zero away from the edges', () => {
    expect(edgeSpeed(400, 800)).toBe(0)
  })
  it('scrolls towards the nearest edge', () => {
    expect(edgeSpeed(5, 800)).toBeLessThan(0)
    expect(edgeSpeed(795, 800)).toBeGreaterThan(0)
  })
  it('gets faster the closer the pointer is to the edge, up to a maximum', () => {
    const far = edgeSpeed(800 - 70, 800)
    const mid = edgeSpeed(800 - 40, 800)
    const edge = edgeSpeed(800 - 1, 800)
    expect(far).toBeLessThan(mid)
    expect(mid).toBeLessThan(edge)
    expect(edgeSpeed(800 + 50, 800)).toBe(26) // outside the window: capped at the maximum
  })
  it('is symmetric', () => {
    expect(edgeSpeed(20, 800)).toBe(-edgeSpeed(780, 800))
  })
})

function Board() {
  const dnd = useDragController()
  return (
    <>
      <FoldBox<string> name="A" dnd={dnd} onDropItem={() => {}} onMergeFold={() => {}} header={<b>A</b>}>
        <button {...dnd.source({ kind: 'item', fold: 'A', item: 'x' }, 'x')}>chip</button>
      </FoldBox>
      <FoldBox<string> name="B" dnd={dnd} onDropItem={() => {}} onMergeFold={() => {}} header={<b>B</b>}>
        <span />
      </FoldBox>
      <DragGhost dnd={dnd} />
    </>
  )
}

const ptr = { pointerId: 1, pointerType: 'mouse', button: 0 }
const W = () => window.innerWidth
const H = () => window.innerHeight

describe('auto-scroll while dragging', () => {
  let scroll: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  })
  afterEach(() => scroll.mockRestore())

  const startDrag = () => {
    render(<Board />)
    fireEvent.pointerDown(screen.getByText('chip'), { ...ptr, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { ...ptr, clientX: 120, clientY: 120 })
  }

  it('scrolls down at the bottom edge and up at the top edge', async () => {
    startDrag()
    fireEvent.pointerMove(window, { ...ptr, clientX: 200, clientY: H() - 5 })
    await waitFor(() => expect(scroll).toHaveBeenCalledWith(0, expect.toSatisfy((n: number) => n > 0)))
    scroll.mockClear()
    fireEvent.pointerMove(window, { ...ptr, clientX: 200, clientY: 5 })
    await waitFor(() => expect(scroll).toHaveBeenCalledWith(0, expect.toSatisfy((n: number) => n < 0)))
  })

  it('also scrolls sideways at the left and right edges', async () => {
    startDrag()
    fireEvent.pointerMove(window, { ...ptr, clientX: W() - 5, clientY: 300 })
    await waitFor(() => expect(scroll).toHaveBeenCalledWith(expect.toSatisfy((n: number) => n > 0), 0))
    scroll.mockClear()
    fireEvent.pointerMove(window, { ...ptr, clientX: 5, clientY: 300 })
    await waitFor(() => expect(scroll).toHaveBeenCalledWith(expect.toSatisfy((n: number) => n < 0), 0))
  })

  it('keeps scrolling while the pointer rests at the edge, and stops on release', async () => {
    startDrag()
    fireEvent.pointerMove(window, { ...ptr, clientX: 200, clientY: H() - 5 })
    await waitFor(() => expect(scroll.mock.calls.length).toBeGreaterThan(2)) // no further movement needed
    fireEvent.pointerUp(window, { ...ptr, clientX: 200, clientY: H() - 5 })
    scroll.mockClear()
    await new Promise((r) => setTimeout(r, 80))
    expect(scroll).not.toHaveBeenCalled()
  })

  it('moves the floating label without re-rendering the page', () => {
    let renders = 0
    function Counted() {
      renders++
      return <Board />
    }
    render(<Counted />)
    fireEvent.pointerDown(screen.getByText('chip'), { ...ptr, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { ...ptr, clientX: 120, clientY: 120 })
    const ghost = document.querySelector('.drag-ghost') as HTMLElement
    expect(ghost).toHaveStyle({ left: '120px', top: '120px' })
    const before = renders
    for (let i = 0; i < 20; i++) fireEvent.pointerMove(window, { ...ptr, clientX: 130 + i, clientY: 140 + i })
    expect(ghost).toHaveStyle({ left: '149px', top: '159px' })
    expect(renders).toBe(before)
  })

  it('does not scroll in the middle of the screen', async () => {
    startDrag()
    fireEvent.pointerMove(window, { ...ptr, clientX: W() / 2, clientY: H() / 2 })
    await new Promise((r) => setTimeout(r, 80))
    expect(scroll).not.toHaveBeenCalled()
  })

  it('does not scroll before a drag has started', async () => {
    render(<Board />)
    fireEvent.pointerDown(screen.getByText('chip'), { ...ptr, clientX: 100, clientY: H() - 5 })
    await new Promise((r) => setTimeout(r, 80))
    expect(scroll).not.toHaveBeenCalled()
  })
})
