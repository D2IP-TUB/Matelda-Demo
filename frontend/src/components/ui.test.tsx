import { render, screen } from '@testing-library/react'
import { JobStatus, Notice } from './ui'

describe('ui', () => {
  it('warn notices are announced as alerts', () => {
    render(<Notice kind="warn">careful</Notice>)
    expect(screen.getByRole('alert')).toHaveTextContent('careful')
  })

  it('info notices are not alerts', () => {
    render(<Notice kind="info">fyi</Notice>)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('JobStatus explains a lost job', () => {
    render(<JobStatus state="lost" />)
    expect(screen.getByText(/Job lost/)).toBeInTheDocument()
  })

  it('JobStatus shows the error of a failed job', () => {
    render(<JobStatus state="failed" error="boom" />)
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })

  it('JobStatus shows running', () => {
    render(<JobStatus state="running" />)
    expect(screen.getByText(/Running/)).toBeInTheDocument()
  })

  it.each(['idle', 'done'] as const)('JobStatus renders nothing for %s', (state) => {
    const { container } = render(<JobStatus state={state} />)
    expect(container).toBeEmptyDOMElement()
  })
})
