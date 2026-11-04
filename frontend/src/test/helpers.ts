import type { FakePocketBase } from './fakePocketBase'

/** Pre-create a PocketBase session record and return a storage that points at it. */
export function seedSession(pb: FakePocketBase, data: Record<string, unknown>, sid = 's1234567890abcdef') {
  pb.data.sessions = [{ id: 'sess1', sid, data }]
  return { getItem: () => sid, setItem: () => {} }
}

import { act, fireEvent } from '@testing-library/react'

const ptr = (type: string) => ({ pointerId: 1, pointerType: type, button: 0, isPrimary: true })

/** Drag `source` onto `target` with pointer events (happy-dom has no layout, so elementFromPoint is stubbed). */
export function pointerDrag(source: Element, target: Element, type: 'mouse' | 'touch' = 'mouse') {
  const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
  fireEvent.pointerDown(source, { ...ptr(type), clientX: 10, clientY: 10 })
  if (type === 'touch') act(() => void vi.advanceTimersByTime(250)) // press-and-hold
  fireEvent.pointerMove(window, { ...ptr(type), clientX: 40, clientY: 40 })
  fireEvent.pointerMove(window, { ...ptr(type), clientX: 60, clientY: 60 })
  fireEvent.pointerUp(window, { ...ptr(type), clientX: 60, clientY: 60 })
  spy.mockRestore()
}

/** A touch that moves before the hold time is a scroll, not a drag. */
export function touchSwipe(source: Element, target: Element) {
  const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
  fireEvent.pointerDown(source, { ...ptr('touch'), clientX: 10, clientY: 10 })
  fireEvent.pointerMove(window, { ...ptr('touch'), clientX: 10, clientY: 60 })
  act(() => void vi.advanceTimersByTime(250))
  fireEvent.pointerUp(window, { ...ptr('touch'), clientX: 10, clientY: 60 })
  spy.mockRestore()
}
