import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title && <h2 className="card-title">{title}</h2>}
      {children}
    </section>
  )
}

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  return <button className={`btn btn-${variant} ${className}`.trim()} {...rest} />
}

export function Notice({ kind, children }: { kind: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'info' ? undefined : 'alert'}>
      {children}
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
  if (state === 'running') return <p className="job job-running">Running…</p>
  if (state === 'failed') return <Notice kind="error">Failed: {error}</Notice>
  if (state === 'lost') return <Notice kind="warn">Job lost (the API restarted?). Run it again.</Notice>
  return null
}
