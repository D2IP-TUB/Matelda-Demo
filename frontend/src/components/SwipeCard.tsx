import { useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'

const THRESHOLD = 100

// A small own component: react-tinder-card does not support React 19. Drag horizontally and
// release past the threshold to swipe; the page also offers buttons for the same actions.
export function SwipeCard({
  onSwipe,
  disabled = false,
  children,
}: {
  onSwipe: (direction: 'left' | 'right') => void
  disabled?: boolean
  children: ReactNode
}) {
  const startX = useRef<number | null>(null)
  const [dx, setDx] = useState(0)

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    startX.current = e.clientX
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (startX.current !== null) setDx(e.clientX - startX.current)
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (startX.current === null) return
    const delta = e.clientX - startX.current
    startX.current = null
    setDx(0)
    if (delta > THRESHOLD) onSwipe('right')
    else if (delta < -THRESHOLD) onSwipe('left')
  }

  return (
    <div
      data-testid="swipe-card"
      className="swipe-card"
      style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 20}deg)` } : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        startX.current = null
        setDx(0)
      }}
    >
      {children}
    </div>
  )
}
