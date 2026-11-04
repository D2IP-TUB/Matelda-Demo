import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import { PAGES } from '../routes'
import type { Page } from '../routes'

/**
 * `top`: the classic strip above the page. `bar`: a sideways-scrollable strip inside the floating footer with the
 * current step centred; the steps on either side are greyed and fade into shadows.
 */
export function StepTracker({
  currentPath,
  variant = 'top',
  pages = PAGES,
}: {
  currentPath: string
  variant?: 'top' | 'bar'
  pages?: Page[]
}) {
  const tr = useT().shell
  const current = pages.findIndex((p) => p.path === currentPath)
  const list = useRef<HTMLOListElement>(null)

  // Keep the current step in the middle of the strip (scroll the strip itself, never the page).
  useEffect(() => {
    if (variant !== 'bar') return
    const ol = list.current
    const item = ol?.querySelector<HTMLElement>('li.current')
    if (!ol || !item) return
    ol.scrollLeft = item.offsetLeft - (ol.clientWidth - item.offsetWidth) / 2
  }, [variant, currentPath])

  if (variant === 'bar') {
    return (
      <nav
        className="steps steps-bar"
        aria-label={tr.progress}
        data-edge={current === 0 ? 'first' : current === pages.length - 1 ? 'last' : undefined}
      >
        <ol ref={list}>
          {pages.map((page, i) => (
            <li key={page.path} className={i < current ? 'done' : i === current ? 'current' : ''}>
              <Link to={page.path} aria-current={i === current ? 'step' : undefined}>
                <span className="dot" aria-hidden="true" />
                <span className="step-title">{page.title}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>
    )
  }
  return (
    <nav className="steps" aria-label={tr.progress}>
      <ol>
        {pages.map((page, i) => (
          <li key={page.path} className={i < current ? 'done' : i === current ? 'current' : ''}>
            <Link to={page.path} aria-current={i === current ? 'step' : undefined}>
              <span className="dot" aria-hidden="true" />
              <span className="step-title">{page.title}</span>
            </Link>
          </li>
        ))}
      </ol>
      {current >= 0 && (
        <div className="steps-compact">
          <span>
            {tr.stepOf(current + 1, pages.length)}
          </span>
        </div>
      )}
    </nav>
  )
}
