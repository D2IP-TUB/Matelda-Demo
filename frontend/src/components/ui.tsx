import { Link } from 'react-router-dom'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title && <h2 className="card-title">{title}</h2>}
      {children}
    </section>
  )
}

/**
 * `loading` is for a button whose click starts something that takes a while: it is disabled and a spinner
 * replaces the label (the label stays in place, invisible, so the button keeps its width and its name).
 */
export function Button({
  variant = 'primary',
  className = '',
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost'; loading?: boolean }) {
  return (
    <button
      className={`btn btn-${variant}${loading ? ' is-loading' : ''} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <>
          <span className="btn-label">{children}</span>
          <span className="btn-spinner" aria-hidden="true">
            <span className="spinner" />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  )
}

export function Notice({ kind, children }: { kind: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'info' ? undefined : 'alert'}>
      {children}
    </div>
  )
}

/** A step that cannot work yet: says what to run first and links straight to it. */
export function Prereq({ title, to, action, children }: { title: string; to: string; action: string; children?: ReactNode }) {
  return (
    <div className="prereq" role="alert">
      <span className="prereq-ico" aria-hidden="true">!</span>
      <div className="prereq-text">
        <b>{title}</b>
        {children && <p>{children}</p>}
      </div>
      <Link className="btn btn-ghost" to={to}>
        {action}
      </Link>
    </div>
  )
}

/** A friendly "nothing here yet" panel: an icon, a title, a line of explanation and a button to the step to do first. */
export function EmptyState({
  icon,
  title,
  to,
  action,
  children,
  note,
  done = false,
}: {
  icon: ReactNode
  title: string
  /** The way on; left out when the page's own Continue button already leads there. */
  to?: string
  action?: string
  children: ReactNode
  /** A small live status line under the text. */
  note?: ReactNode
  /** A finished step rather than a missing one: a green check look. */
  done?: boolean
}) {
  return (
    <div className={`empty-state${done ? ' is-done' : ''}`}>
      <span className="empty-state-ico" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {note && (
        <p className="empty-state-note" role="status">
          {note}
        </p>
      )}
      {to && action && (
        <Link className="btn btn-primary" to={to}>
          {action}
        </Link>
      )}
    </div>
  )
}

export function JobStatus({
  state,
  error,
}: {
  state: 'idle' | 'running' | 'done' | 'failed' | 'lost'
  error?: string
}) {
  const tr = useT().ui
  // While it runs, the button that started it shows the spinner (Button `loading`); nothing else does.
  if (state === 'failed') return <Notice kind="error">{tr.failed(error)}</Notice>
  if (state === 'lost') return <Notice kind="warn">{tr.jobLost}</Notice>
  return null
}

/** The one loading indicator: a spinner with a short label. Use it everywhere something is on its way. */
export function Loading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`loading ${className}`.trim()} role="status">
      <span className="spinner" aria-hidden="true" />
      {children}
    </p>
  )
}

/** A centered help popup: dimmed backdrop, title, body. Closes on Escape, a backdrop click or the Close button. */
export function InfoPopup({
  title,
  onClose,
  children,
  id,
  testId,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  id?: string
  testId?: string
}) {
  const tr = useT().ui
  const closeBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    closeBtn.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="modal-backdrop info-backdrop" onClick={onClose}>
      <div
        className="info-dialog"
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="info-dialog-head">
          <span className="info-dialog-mark" aria-hidden="true">i</span>
          <h2>{title}</h2>
          <button type="button" className="info-dialog-close" aria-label={tr.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="info-dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** A small "i" button that opens a help popup. Put <p>, <ul>/<ol> and <h3> inside; see .info-dialog-body. */
export function InfoButton({
  label,
  title,
  children,
}: {
  label?: string
  title?: string
  children: ReactNode
}) {
  const tr = useT().ui
  label ??= tr.moreInfo
  const [open, setOpen] = useState(false)
  const id = useId()
  const close = useCallback(() => setOpen(false), [])
  return (
    <span className="info">
      <button
        type="button"
        className="info-btn"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        i
      </button>
      {open && (
        <InfoPopup title={title ?? label} onClose={close} id={id}>
          {children}
        </InfoPopup>
      )}
    </span>
  )
}
