import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

/** What is being dragged: one item out of a fold, or a whole fold. */
export type Drag<T = unknown> = { kind: 'item'; fold: string; item: T } | { kind: 'fold'; name: string }

type Target = { onDropItem: (item: never, fromFold: string) => void; onMergeFold: (source: string) => void }

const MOVE_PX = 6 // mouse/pen: movement before a press turns into a drag
const HOLD_MS = 200 // touch: press-and-hold before a press turns into a drag (a quick swipe scrolls instead)
const EDGE_PX = 70 // auto-scroll when the pointer is this close to the top/bottom of the screen

const accepts = (d: Drag, fold: string) => (d.kind === 'item' ? d.fold !== fold : d.name !== fold)

/**
 * Pointer-events drag and drop, so it works the same with mouse, pen and finger.
 * Items are picked up by dragging (mouse) or press-and-hold (touch); the fold handle drags at once.
 */
export function useDragController() {
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const targets = useRef(new Map<string, Target>())
  const cleanup = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanup.current?.(), [])

  const source = useCallback(
    (payload: Drag, label: string, opts: { immediate?: boolean } = {}) => ({
      onPointerDown: (e: ReactPointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        cleanup.current?.()
        const start = { x: e.clientX, y: e.clientY }
        const touch = e.pointerType === 'touch'
        let pos = start
        let active = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let scroller: ReturnType<typeof setInterval> | undefined

        const targetAt = (x: number, y: number) => {
          const name = document.elementFromPoint(x, y)?.closest('[data-fold]')?.getAttribute('data-fold')
          return name && targets.current.has(name) && accepts(payload, name) ? name : null
        }
        const activate = () => {
          active = true
          setGhost({ ...pos, label })
          scroller = setInterval(() => {
            if (pos.y < EDGE_PX) window.scrollBy(0, -14)
            else if (pos.y > window.innerHeight - EDGE_PX) window.scrollBy(0, 14)
          }, 16)
        }
        const onMove = (ev: PointerEvent) => {
          pos = { x: ev.clientX, y: ev.clientY }
          if (!active) {
            const far = Math.hypot(pos.x - start.x, pos.y - start.y) > MOVE_PX
            if (!far) return
            if (touch && !opts.immediate) return finish() // moved before the hold: the user is scrolling
            activate()
          }
          setGhost({ ...pos, label })
          setHover(targetAt(pos.x, pos.y))
        }
        const onUp = (ev: PointerEvent) => {
          const name = active ? targetAt(ev.clientX, ev.clientY) : null
          const wasActive = active
          finish()
          if (wasActive) {
            // the click that follows a drag must not open the preview
            const swallow = (c: Event) => c.stopPropagation()
            window.addEventListener('click', swallow, { capture: true, once: true })
            setTimeout(() => window.removeEventListener('click', swallow, true), 0)
          }
          const t = name ? targets.current.get(name) : undefined
          if (!t) return
          if (payload.kind === 'item') t.onDropItem(payload.item as never, payload.fold)
          else t.onMergeFold(payload.name)
        }
        // once dragging, the page must not scroll under the finger
        const onTouchMove = (ev: TouchEvent) => (active || opts.immediate) && ev.cancelable && ev.preventDefault()
        const onContextMenu = (ev: Event) => touch && ev.preventDefault()

        function finish() {
          clearTimeout(timer)
          clearInterval(scroller)
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', finish)
          window.removeEventListener('touchmove', onTouchMove)
          window.removeEventListener('contextmenu', onContextMenu)
          cleanup.current = null
          setGhost(null)
          setHover(null)
        }
        cleanup.current = finish
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', finish)
        window.addEventListener('touchmove', onTouchMove, { passive: false })
        window.addEventListener('contextmenu', onContextMenu)
        if (touch) timer = setTimeout(activate, opts.immediate ? 0 : HOLD_MS)
      },
    }),
    [],
  )

  return { source, ghost, hover, targets }
}
export type DragController = ReturnType<typeof useDragController>

/** Floating label that follows the pointer while dragging. */
export function DragGhost({ dnd }: { dnd: DragController }) {
  if (!dnd.ghost) return null
  return (
    <div className="drag-ghost" style={{ left: dnd.ghost.x, top: dnd.ghost.y }}>
      {dnd.ghost.label}
    </div>
  )
}

/** One rectangle per fold. Items dropped on it move into it; a fold dropped on it merges into it. */
export function FoldBox<T>({
  name,
  dnd,
  onDropItem,
  onMergeFold,
  header,
  children,
}: {
  name: string
  dnd: DragController
  onDropItem: (item: T, fromFold: string) => void
  onMergeFold: (source: string) => void
  header: ReactNode
  children: ReactNode
}) {
  const { targets } = dnd
  useEffect(() => {
    targets.current.set(name, { onDropItem: onDropItem as Target['onDropItem'], onMergeFold })
    return () => void targets.current.delete(name)
  })
  return (
    <section className={`card fold-box${dnd.hover === name ? ' over' : ''}`} data-fold={name}>
      <div className="row fold-head">
        <span
          className="handle"
          role="img"
          aria-label={`Drag fold ${name}`}
          {...dnd.source({ kind: 'fold', name }, name, { immediate: true })}
        >
          ⠿
        </span>
        {header}
      </div>
      {children}
    </section>
  )
}

/** Scissors between two items; clicking it cuts the fold right after the item above. */
export function CutButton({ label, onCut }: { label: string; onCut: () => void }) {
  return (
    <button type="button" className="cut" aria-label={label} title="Split here" onClick={onCut}>
      ✂
    </button>
  )
}

/** Popup over the page; closes on Escape, on the backdrop and on its Close button. */
export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" data-testid="backdrop" onClick={onClose}>
      <dialog open role="dialog" aria-label={label} className="cell-dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </dialog>
    </div>
  )
}
