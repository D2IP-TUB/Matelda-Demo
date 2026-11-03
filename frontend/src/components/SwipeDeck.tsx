import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react'
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'

export type Direction = 'left' | 'right'

export interface SwipeDeckHandle {
  swipe: (direction: Direction) => void
}

interface Props<T extends { key: string }> {
  items: T[]
  /** Index of the card on top. */
  index: number
  /** depth 0 is the card on top; 1 and 2 are the cards peeking out behind it. */
  renderCard: (item: T, depth: number) => ReactNode
  onSwipe: (direction: Direction, item: T) => void
  disabled?: boolean
  /**
   * When the index goes back, the card that returns slides in from the side it was swiped to.
   * Return the direction it was swiped (undefined = a plain fade-in).
   */
  enterFrom?: (item: T) => Direction | undefined
  ref?: Ref<SwipeDeckHandle>
}

const VISIBLE = 3
const DISTANCE = 110 // px (including a bit of fling) before a release counts as a swipe

/** Swipe if the release point, projected a little along the velocity, is far enough. */
export function decideSwipe(offsetX: number, velocityX: number): Direction | null {
  const projected = offsetX + velocityX * 0.25
  if (projected > DISTANCE) return 'right'
  if (projected < -DISTANCE) return 'left'
  return null
}

const ENTER_DISTANCE = 520

type ExitCustom = { direction: Direction; reduced: boolean; back: boolean }

const exitVariants = {
  exit: (custom: ExitCustom) => {
    // The card that drops out of the stack while going back just fades away.
    if (custom.back) return { opacity: 0, transition: { duration: 0.15 } }
    return {
      x: custom.reduced ? 0 : custom.direction === 'right' ? 520 : -520,
      rotate: custom.reduced ? 0 : custom.direction === 'right' ? 20 : -20,
      opacity: 0,
      transition: { duration: custom.reduced ? 0.15 : 0.32, ease: 'easeOut' as const },
    }
  },
}

function DeckCard({
  depth,
  draggable,
  fresh,
  enterFrom,
  reduced,
  onRelease,
  children,
}: {
  depth: number
  draggable: boolean
  fresh: boolean
  enterFrom?: Direction
  reduced: boolean
  onRelease: (offsetX: number, velocityX: number) => void
  children: ReactNode
}) {
  const x = useMotionValue(enterFrom && !reduced ? (enterFrom === 'right' ? ENTER_DISTANCE : -ENTER_DISTANCE) : 0)
  const rotate = useTransform(x, [-220, 0, 220], reduced ? [0, 0, 0] : [-14, 0, 14])
  const correct = useTransform(x, [20, 120], [0, 1])
  const wrong = useTransform(x, [-120, -20], [1, 0])
  const glow = useTransform(
    x,
    [-140, -20, 0, 20, 140],
    [
      'rgba(231, 76, 60, 0.75)',
      'rgba(231, 76, 60, 0)',
      'rgba(0, 0, 0, 0)',
      'rgba(46, 204, 113, 0)',
      'rgba(46, 204, 113, 0.75)',
    ],
  )
  const ring = useMotionTemplate`0 14px 34px rgba(0, 0, 0, 0.22), 0 0 0 4px ${glow}`

  return (
    <motion.div
      className="deck-card"
      data-testid="deck-card"
      data-depth={depth}
      data-enter-from={enterFrom}
      aria-hidden={depth > 0 ? true : undefined}
      style={{ x, rotate, boxShadow: ring, zIndex: VISIBLE - depth, pointerEvents: depth === 0 ? 'auto' : 'none' }}
      variants={exitVariants}
      initial={enterFrom ? { opacity: 0, scale: 1, y: 0 } : fresh ? { opacity: 0, scale: 0.9, y: 24 } : false}
      animate={{
        scale: 1 - depth * 0.04,
        y: depth * 14,
        opacity: depth === 0 ? 1 : 1 - depth * 0.15,
        ...(enterFrom ? { x: 0 } : {}),
      }}
      exit="exit"
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      drag={draggable ? 'x' : false}
      dragSnapToOrigin
      dragElastic={0.6}
      dragMomentum={false}
      whileDrag={{ cursor: 'grabbing' }}
      onDragEnd={(_, info) => onRelease(info.offset.x, info.velocity.x)}
    >
      {depth === 0 && (
        <>
          <motion.span className="stamp stamp-correct" style={{ opacity: correct }} aria-hidden="true">
            CORRECT
          </motion.span>
          <motion.span className="stamp stamp-error" style={{ opacity: wrong }} aria-hidden="true">
            ERROR
          </motion.span>
        </>
      )}
      {children}
    </motion.div>
  )
}

/**
 * A stack of cards. Drag the top card (or call `swipe`, press ←/→) to send it off to the
 * right ("correct") or left ("error"); the parent advances `index` in `onSwipe`.
 * Built on `motion` springs, like the React Bits components.
 */
export function SwipeDeck<T extends { key: string }>({
  items,
  index,
  renderCard,
  onSwipe,
  disabled = false,
  enterFrom,
  ref,
}: Props<T>) {
  const reduced = useReducedMotion() ?? false
  const [direction, setDirection] = useState<Direction>('right')
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Going back (the index decreased since the last commit) brings a card in from the side it left.
  const previousIndex = useRef(index)
  const wentBack = index < previousIndex.current
  useEffect(() => {
    previousIndex.current = index
  })

  const latest = useRef({ items, index, onSwipe, disabled })
  latest.current = { items, index, onSwipe, disabled }

  const swipe = (dir: Direction) => {
    const { items: list, index: i, onSwipe: handler, disabled: off } = latest.current
    const item = list[i]
    if (off || !item) return
    setDirection(dir)
    handler(dir, item)
  }
  useImperativeHandle(ref, () => ({ swipe }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) return
      if (e.key === 'ArrowRight') swipe('right')
      else if (e.key === 'ArrowLeft') swipe('left')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = items.slice(index, index + VISIBLE)
  return (
    <div className="deck" role="group" aria-label="Cards to label">
      <AnimatePresence custom={{ direction, reduced, back: wentBack }}>
        {visible
          .map((item, depth) => ({ item, depth }))
          .reverse()
          .map(({ item, depth }) => (
            <DeckCard
              key={item.key}
              depth={depth}
              draggable={depth === 0 && !disabled}
              fresh={mounted}
              enterFrom={wentBack && depth === 0 ? enterFrom?.(item) : undefined}
              reduced={reduced}
              onRelease={(offset, velocity) => {
                const dir = decideSwipe(offset, velocity)
                if (dir) swipe(dir)
              }}
            >
              {renderCard(item, depth)}
            </DeckCard>
          ))}
      </AnimatePresence>
    </div>
  )
}
