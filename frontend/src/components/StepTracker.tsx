import { Link, useNavigate } from 'react-router-dom'
import { PAGES, stepIndex } from '../routes'

export function StepTracker({ currentPath }: { currentPath: string }) {
  const navigate = useNavigate()
  const current = stepIndex(currentPath)
  return (
    <nav className="steps" aria-label="Progress">
      <ol>
        {PAGES.map((page, i) => (
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
            Step {current + 1} of {PAGES.length}
          </span>
          <select
            aria-label="Go to step"
            value={currentPath}
            onChange={(e) => navigate(e.target.value)}
          >
            {PAGES.map((p) => (
              <option key={p.path} value={p.path}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      )}
    </nav>
  )
}
