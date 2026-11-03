import { render, screen } from '@testing-library/react'
import { StrategyChecklist } from './forms'

describe('StrategyChecklist', () => {
  it('shows a loading hint instead of a warning while strategies load', () => {
    render(<StrategyChecklist strategies={[]} selected={[]} onChange={() => {}} loading />)
    expect(screen.getByText('Loading strategies…')).toBeInTheDocument()
    expect(screen.queryByText(/Select at least one strategy/)).toBeNull()
  })

  it('warns when loaded and nothing is selected', () => {
    render(<StrategyChecklist strategies={['A']} selected={[]} onChange={() => {}} />)
    expect(screen.getByText(/Select at least one strategy/)).toBeInTheDocument()
    expect(screen.queryByText('Loading strategies…')).toBeNull()
  })
})
