import { fireEvent, render, screen } from '@testing-library/react'
import { SwipeCard } from './SwipeCard'

function drag(el: HTMLElement, dx: number) {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 0, pointerId: 1 })
  fireEvent.pointerMove(el, { clientX: 100 + dx, clientY: 0, pointerId: 1 })
  fireEvent.pointerUp(el, { clientX: 100 + dx, clientY: 0, pointerId: 1 })
}

describe('SwipeCard', () => {
  it('swipes right past the threshold', () => {
    const onSwipe = vi.fn()
    render(<SwipeCard onSwipe={onSwipe}><p>card</p></SwipeCard>)
    drag(screen.getByTestId('swipe-card'), 150)
    expect(onSwipe).toHaveBeenCalledWith('right')
  })

  it('swipes left past the threshold', () => {
    const onSwipe = vi.fn()
    render(<SwipeCard onSwipe={onSwipe}><p>card</p></SwipeCard>)
    drag(screen.getByTestId('swipe-card'), -150)
    expect(onSwipe).toHaveBeenCalledWith('left')
  })

  it('snaps back after a short drag', () => {
    const onSwipe = vi.fn()
    render(<SwipeCard onSwipe={onSwipe}><p>card</p></SwipeCard>)
    drag(screen.getByTestId('swipe-card'), 40)
    expect(onSwipe).not.toHaveBeenCalled()
    expect(screen.getByTestId('swipe-card').style.transform).toBe('')
  })

  it('ignores drags when disabled', () => {
    const onSwipe = vi.fn()
    render(<SwipeCard onSwipe={onSwipe} disabled><p>card</p></SwipeCard>)
    drag(screen.getByTestId('swipe-card'), 200)
    expect(onSwipe).not.toHaveBeenCalled()
  })
})
