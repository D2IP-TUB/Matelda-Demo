import { render, screen } from '@testing-library/react'
import { Button, JobStatus, Notice } from './ui'

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

  it('JobStatus shows no separate spinner while running (the button shows it)', () => {
    const { container } = render(<JobStatus state="running" />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each(['idle', 'done'] as const)('JobStatus renders nothing for %s', (state) => {
    const { container } = render(<JobStatus state={state} />)
    expect(container).toBeEmptyDOMElement()
  })

  describe('Button loading', () => {
    it('shows a spinner inside the button, keeps the label (invisible) and disables it', () => {
      render(<Button loading>Continue</Button>)
      const button = screen.getByRole('button', { name: 'Continue' })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('aria-busy', 'true')
      expect(button.querySelector('.spinner')).not.toBeNull()
      expect(button).toHaveClass('is-loading')
      expect(button.querySelector('.btn-label')).toHaveTextContent('Continue')
    })

    it('is a plain button when not loading', () => {
      render(<Button onClick={() => {}}>Continue</Button>)
      const button = screen.getByRole('button', { name: 'Continue' })
      expect(button).toBeEnabled()
      expect(button).not.toHaveAttribute('aria-busy')
      expect(button.querySelector('.spinner')).toBeNull()
    })

    it('does not fire clicks while loading', () => {
      const onClick = vi.fn()
      render(<Button loading onClick={onClick}>Continue</Button>)
      screen.getByRole('button').click()
      expect(onClick).not.toHaveBeenCalled()
    })
  })
})
