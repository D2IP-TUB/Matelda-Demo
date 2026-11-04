import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useT } from '../i18n'

/** What is being dragged: one item out of a fold, a whole fold, or a whole domain. */
export type Drag<T = unknown> =
  | { kind: 'item'; fold: string; item: T }
  | { kind: 'fold'; name: string; domain?: string }
  | { kind: 'domain'; name: string }

/** A place something can be dropped: says what it accepts and what happens on a drop. */
type Target = { accepts: (d: Drag) => boolean; drop: (d: Drag) => void }

const MOVE_PX = 6 // mouse/pen: movement before a press turns into a drag
const HOLD_MS = 200 // touch: press-and-hold before a press turns into a drag (a quick swipe scrolls instead)
const EDGE_PX = 80 // auto-scroll starts when the pointer is this close to a screen edge
const MIN_SPEED = 2 // px per frame right at the start of the zone
const MAX_SPEED = 26 // px per frame at the very edge

/** Signed scroll speed for a pointer at `p` on an axis spanning 0..size: eases in the closer it gets to the edge. */
export function edgeSpeed(p: number, size: number): number {
  const depth = (d: number) => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.min(1, d / EDGE_PX) ** 2
  if (p < EDGE_PX) return -depth(EDGE_PX - p)
  if (p > size - EDGE_PX) return depth(p - (size - EDGE_PX))
  return 0
}


/**
 * Pointer-events drag and drop, so it works the same with mouse, pen and finger.
 * Items are picked up by dragging (mouse) or press-and-hold (touch); the fold handle drags at once.
 */
export function useDragController() {
  // only the label is state; the position is written straight to the element so a mouse move never re-renders the page
  const [ghost, setGhost] = useState<string | null>(null)
  const ghostPos = useRef({ x: 0, y: 0 })
  const ghostEl = useRef<HTMLDivElement | null>(null)
  const moveGhost = (x: number, y: number) => {
    ghostPos.current = { x, y }
    if (ghostEl.current) {
      ghostEl.current.style.left = `${x}px`
      ghostEl.current.style.top = `${y}px`
    }
  }
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
        const el = e.currentTarget
        const touch = e.pointerType === 'touch'
        let pos = start
        let active = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let frame = 0

        const targetAt = (x: number, y: number) => {
          // the innermost drop place under the pointer that takes it: a fold box, or else the domain box around it
          const under = document.elementFromPoint(x, y)
          const fold = under?.closest('[data-fold]')
          const domain = under?.closest('[data-domain]')
          const keys = [fold && `fold:${fold.getAttribute('data-fold')}`, domain && `domain:${domain.getAttribute('data-domain')}`]
          return keys.find((k): k is string => !!k && !!targets.current.get(k)?.accepts(payload)) ?? null
        }
        // one animation frame at a time: scroll towards the nearest edge, then re-check what is under the pointer
        const tick = () => {
          const dx = edgeSpeed(pos.x, window.innerWidth)
          const dy = edgeSpeed(pos.y, window.innerHeight)
          if (dx || dy) {
            window.scrollBy(dx, dy)
            setHover(targetAt(pos.x, pos.y)) // the page moved under a still pointer
          }
          frame = requestAnimationFrame(tick)
        }
        const activate = () => {
          active = true
          moveGhost(pos.x, pos.y)
          setGhost(label)
          frame = requestAnimationFrame(tick)
        }
        const onMove = (ev: PointerEvent) => {
          pos = { x: ev.clientX, y: ev.clientY }
          if (!active) {
            const far = Math.hypot(pos.x - start.x, pos.y - start.y) > MOVE_PX
            if (!far) return
            if (touch && !opts.immediate) return finish() // moved before the hold: the user is scrolling
            activate()
          }
          moveGhost(pos.x, pos.y)
          setHover(targetAt(pos.x, pos.y))
        }
        const onUp = (ev: PointerEvent) => {
          const name = active ? targetAt(ev.clientX, ev.clientY) : null
          const wasActive = active
          finish()
          if (wasActive) {
            // the click that follows a drag must not open the preview
            const swallow = (c: Event) => el.contains(c.target as Node) && c.stopPropagation()
            window.addEventListener('click', swallow, { capture: true, once: true })
            setTimeout(() => window.removeEventListener('click', swallow, true), 0)
          }
          if (name) targets.current.get(name)?.drop(payload)
        }
        // once dragging, the page must not scroll under the finger
        const onTouchMove = (ev: TouchEvent) => (active || opts.immediate) && ev.cancelable && ev.preventDefault()
        const onContextMenu = (ev: Event) => touch && ev.preventDefault()

        function finish() {
          clearTimeout(timer)
          cancelAnimationFrame(frame)
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

  return { source, ghost, ghostPos, ghostEl, hover, targets }
}
export type DragController = ReturnType<typeof useDragController>

/** Floating label that follows the pointer while dragging. */
export function DragGhost({ dnd }: { dnd: DragController }) {
  const { ghost, ghostEl, ghostPos } = dnd
  useLayoutEffect(() => {
    if (ghost && ghostEl.current) {
      ghostEl.current.style.left = `${ghostPos.current.x}px`
      ghostEl.current.style.top = `${ghostPos.current.y}px`
    }
  }, [ghost, ghostEl, ghostPos])
  if (!ghost) return null
  return (
    <div className="drag-ghost" ref={ghostEl}>
      {ghost}
    </div>
  )
}

/** One rectangle per fold. Items dropped on it move into it; a fold dropped on it merges into it. */
export function FoldBox<T>({
  name,
  domain,
  dnd,
  onDropItem,
  onMergeFold,
  header,
  children,
}: {
  name: string
  /** The domain the fold currently belongs to, if folds are grouped in domains. */
  domain?: string
  dnd: DragController
  onDropItem: (item: T, fromFold: string) => void
  onMergeFold: (source: string) => void
  header: ReactNode
  children: ReactNode
}) {
  const tr = useT().shell
  const { targets } = dnd
  useEffect(() => {
    const key = `fold:${name}`
    targets.current.set(key, {
      accepts: (d) => (d.kind === 'item' ? d.fold !== name : d.kind === 'fold' && d.name !== name),
      drop: (d) => (d.kind === 'item' ? onDropItem(d.item as T, d.fold) : d.kind === 'fold' && onMergeFold(d.name)),
    })
    return () => void targets.current.delete(key)
  })
  return (
    <section className={`card fold-box${dnd.hover === `fold:${name}` ? ' over' : ''}`} data-fold={name}>
      <div className="row fold-head">
        <span
          className="handle"
          role="img"
          aria-label={tr.dragFold(name)}
          {...dnd.source({ kind: 'fold', name, domain }, name, { immediate: true })}
        >
          ⠿
        </span>
        {header}
      </div>
      {children}
    </section>
  )
}

/**
 * The rectangle around the folds of one domain. A fold dropped on it (not on a fold inside it) moves into the domain;
 * another domain dropped anywhere on it (by the handle next to its title) merges into it.
 */
export function DomainBox({
  name,
  title,
  dnd,
  onDropFold,
  onMergeDomain,
  children,
}: {
  name: string
  title: ReactNode
  dnd: DragController
  onDropFold: (fold: string) => void
  onMergeDomain: (source: string) => void
  children: ReactNode
}) {
  const tr = useT().shell
  const { targets } = dnd
  useEffect(() => {
    const key = `domain:${name}`
    targets.current.set(key, {
      accepts: (d) => (d.kind === 'fold' && d.domain !== name) || (d.kind === 'domain' && d.name !== name),
      drop: (d) => (d.kind === 'fold' ? onDropFold(d.name) : d.kind === 'domain' && onMergeDomain(d.name)),
    })
    return () => void targets.current.delete(key)
  })
  return (
    <section
      className={`domain-box${dnd.hover === `domain:${name}` ? ' over' : ''}`}
      aria-label={tr.domainLabel(name)}
      data-domain={name}
    >
      <div className="domain-head">
        <span
          className="handle"
          role="img"
          aria-label={tr.dragDomain(name)}
          {...dnd.source({ kind: 'domain', name }, name, { immediate: true })}
        >
          ⠿
        </span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  )
}

/**
 * Split mode: while it is on, the gaps between items turn into cut lines (see `Seam`). Any press outside a cut line or
 * the toggle (a drag, a click on an item or a fold, a click on the page) and Escape turn it off again.
 */
export function useCutMode() {
  const [cutting, setCutting] = useState(false)
  useEffect(() => {
    if (!cutting) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest('[data-cut-keep]'))) setCutting(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setCutting(false)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [cutting])
  return [cutting, setCutting] as const
}

/** A tool that is either on or off, like split mode or bulk annotation. */
export function ToolToggle({ on, onToggle, icon, children, keepCutting = false }: {
  on: boolean
  onToggle: () => void
  icon: ReactNode
  children: ReactNode
  /** Pressing it does not end split mode (true for the split toggle itself). */
  keepCutting?: boolean
}) {
  return (
    <button
      type="button"
      className={`btn btn-ghost tool-toggle${on ? ' on' : ''}`}
      aria-pressed={on}
      data-cut-keep={keepCutting ? '' : undefined}
      onClick={onToggle}
    >
      <span aria-hidden="true">{icon}</span> {children}
    </button>
  )
}

/** The button that turns split mode on and off, with a hint while it is on; `children` are more tools beside it. */
export function CutToggle({ on, onToggle, hint, children }: { on: boolean; onToggle: () => void; hint: string; children?: ReactNode }) {
  const tr = useT().shell
  return (
    <div className="cut-tools">
      <ToolToggle on={on} onToggle={onToggle} icon="✂" keepCutting>
        {tr.splitFolds}
      </ToolToggle>
      {children}
      {on && (
        <p className="cut-hint" role="status">
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * The gap after an item. In split mode it is a cut line: hovering it previews the cut, clicking it cuts right after
 * the item before it. Otherwise it is just spacing (`spacer`), or nothing.
 */
export function Seam({
  cutting,
  label,
  title,
  onCut,
  className = '',
  spacer = true,
}: {
  cutting: boolean
  label: string
  title?: string
  onCut: () => void
  className?: string
  spacer?: boolean
}) {
  const tr = useT().shell
  if (!cutting) return spacer ? <span className={`seam ${className}`.trim()} aria-hidden="true" /> : null
  return (
    <button
      type="button"
      className={`seam ${className}`.trim()}
      data-cut-keep=""
      aria-label={label}
      title={title ?? tr.splitHere}
      onClick={onCut}
    />
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
