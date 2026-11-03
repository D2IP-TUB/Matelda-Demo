import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { SwipeDeck, decideSwipe } from './SwipeDeck'
import type { SwipeDeckHandle } from './SwipeDeck'

const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }]

function setup(props: Partial<React.ComponentProps<typeof SwipeDeck<{ key: string }>>> = {}) {
  const ref = createRef<SwipeDeckHandle>()
  const onSwipe = vi.fn()
  const view = render(
    <SwipeDeck
      ref={ref}
      items={items}
      index={0}
      onSwipe={onSwipe}
      renderCard={(item, depth) => <p>{`${item.key}:${depth}`}</p>}
      {...props}
    />,
  )
  return { ref, onSwipe, ...view }
}

describe('decideSwipe', () => {
  it.each([
    [150, 0, 'right'],
    [-150, 0, 'left'],
    [40, 0, null],
    [30, 800, 'right'], // a quick flick counts even over a short distance
    [-30, -800, 'left'],
    [100, -200, null], // dragged right but flicked back
    [60, 250, 'right'],
  ])('offset %s with velocity %s -> %s', (offset, velocity, expected) => {
    expect(decideSwipe(offset, velocity)).toBe(expected)
  })
})

describe('SwipeDeck', () => {
  it('shows the current card and the two behind it', () => {
    setup()
    expect(screen.getByText('a:0')).toBeInTheDocument()
    expect(screen.getByText('b:1')).toBeInTheDocument()
    expect(screen.getByText('c:2')).toBeInTheDocument()
    expect(screen.queryByText('d:3')).toBeNull()
  })

  it('advances the stack when the index changes', async () => {
    const { rerender, onSwipe } = setup()
    rerender(
      <SwipeDeck items={items} index={1} onSwipe={onSwipe} renderCard={(i, d) => <p>{`${i.key}:${d}`}</p>} />,
    )
    expect(await screen.findByText('b:0')).toBeInTheDocument()
    expect(screen.getByText('d:2')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('a:0')).toBeNull())
  })

  it('a card that comes back enters from the side it was swiped to; forward moves and first render do not', async () => {
    const render3 = (index: number) => (
      <SwipeDeck
        items={items}
        index={index}
        onSwipe={vi.fn()}
        enterFrom={(item) => (item.key === 'a' ? 'right' : item.key === 'b' ? 'left' : undefined)}
        renderCard={(i, d) => <p>{`${i.key}:${d}`}</p>}
      />
    )
    const { rerender } = render(render3(1))
    const top = () => screen.getByText(/:0$/).closest('[data-testid="deck-card"]')
    expect(top()).not.toHaveAttribute('data-enter-from') // first render
    rerender(render3(0)) // back to "a", which was swiped right
    await waitFor(() => expect(screen.getByText('a:0')).toBeInTheDocument())
    expect(top()).toHaveAttribute('data-enter-from', 'right')
    rerender(render3(1)) // forward again: no entering animation for "b"
    await waitFor(() => expect(screen.getByText('b:0')).toBeInTheDocument())
    expect(top()).not.toHaveAttribute('data-enter-from')
    rerender(render3(0))
    rerender(render3(1))
    rerender(render3(0))
    await waitFor(() => expect(screen.getByText('a:0')).toBeInTheDocument())
    expect(top()).toHaveAttribute('data-enter-from', 'right')
  })

  it('a card with no known swipe direction comes back without a side', async () => {
    const view = (index: number) => (
      <SwipeDeck items={items} index={index} onSwipe={vi.fn()} enterFrom={() => undefined} renderCard={(i, d) => <p>{`${i.key}:${d}`}</p>} />
    )
    const { rerender } = render(view(1))
    rerender(view(0))
    await waitFor(() => expect(screen.getByText('a:0')).toBeInTheDocument())
    expect(screen.getByText('a:0').closest('[data-testid="deck-card"]')).not.toHaveAttribute('data-enter-from')
  })

  it('swipes right and left through the handle, passing the current item', () => {
    const { ref, onSwipe } = setup()
    act(() => ref.current!.swipe('right'))
    expect(onSwipe).toHaveBeenLastCalledWith('right', items[0])
    act(() => ref.current!.swipe('left'))
    expect(onSwipe).toHaveBeenLastCalledWith('left', items[0])
  })

  it('arrow keys swipe', () => {
    const { onSwipe } = setup()
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(onSwipe).toHaveBeenLastCalledWith('right', items[0])
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(onSwipe).toHaveBeenLastCalledWith('left', items[0])
  })

  it('ignores arrow keys typed into form fields', () => {
    const { onSwipe } = setup()
    const input = document.body.appendChild(document.createElement('input'))
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(onSwipe).not.toHaveBeenCalled()
    input.remove()
  })

  it('does nothing when disabled or when there is no current card', () => {
    const disabled = setup({ disabled: true })
    act(() => disabled.ref.current!.swipe('right'))
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(disabled.onSwipe).not.toHaveBeenCalled()
    disabled.unmount()
    const done = setup({ index: items.length })
    act(() => done.ref.current!.swipe('left'))
    expect(done.onSwipe).not.toHaveBeenCalled()
  })

  it('stops listening to the keyboard when it unmounts', () => {
    const { onSwipe, unmount } = setup()
    unmount()
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(onSwipe).not.toHaveBeenCalled()
  })
})
