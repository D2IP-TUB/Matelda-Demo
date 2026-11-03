import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as api from '../lib/api'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { Configurations } from './Configurations'

vi.mock('../lib/api', () => ({
  fetchDatasets: vi.fn(),
  fetchStrategies: vi.fn(),
  fetchPipelines: vi.fn(),
  fetchPipeline: vi.fn(),
  suggestPipelineName: vi.fn(),
  createPipeline: vi.fn(),
  updatePipeline: vi.fn(),
  copyPipeline: vi.fn(),
}))

const m = vi.mocked(api)
const SID = 'abcdef0123456789'

function renderPage(session: Record<string, unknown> = { dataset_select: 'demo' }) {
  const pb = new FakePocketBase()
  const sessions = new SessionService(pb as any, seedSession(pb, session, SID))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider service={sessions}>
        <MemoryRouter initialEntries={['/configuration']}>
          <Routes>
            <Route path="/configuration" element={<Configurations />} />
            <Route path="/domain-folding" element={<h1>Domain Folding</h1>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return pb
}

beforeEach(() => {
  m.fetchDatasets.mockReset().mockResolvedValue(['demo', 'other'])
  m.fetchStrategies.mockReset().mockResolvedValue(['Typo Detector', 'Outlier Detector'])
  m.fetchPipelines.mockReset().mockResolvedValue(['taken-abcdef', 'old-abcdef'])
  m.fetchPipeline.mockReset().mockResolvedValue({
    selected_dataset: 'other',
    labeling_budget: 33,
    selected_strategies: ['Typo Detector'],
  })
  m.suggestPipelineName.mockReset().mockResolvedValue('demo-pipeline-01-abcdef')
  m.createPipeline.mockReset().mockImplementation(async (name) => name)
  m.updatePipeline.mockReset().mockResolvedValue(undefined)
  m.copyPipeline.mockReset().mockImplementation(async (_from, to) => to)
})

const next = () => screen.getByRole('button', { name: 'Next' })

describe('Configurations', () => {
  it('preselects all strategies and suggests a name with the session suffix', async () => {
    renderPage()
    expect(await screen.findByLabelText('Typo Detector')).toBeChecked()
    expect(screen.getByLabelText('Outlier Detector')).toBeChecked()
    await waitFor(() => expect(m.suggestPipelineName).toHaveBeenCalledWith('demo', 'abcdef'))
    expect(await screen.findByDisplayValue('demo-pipeline-01-abcdef')).toBeInTheDocument()
  })

  it('shows an error and blocks Next when strategies cannot be loaded', async () => {
    m.fetchStrategies.mockRejectedValue(new Error('Could not load strategies'))
    renderPage()
    expect(await screen.findByText(/Could not load strategies/)).toBeInTheDocument()
    expect(next()).toBeDisabled()
  })

  it('blocks Next when no strategy is selected', async () => {
    renderPage()
    fireEvent.click(await screen.findByLabelText('Typo Detector'))
    fireEvent.click(screen.getByLabelText('Outlier Detector'))
    expect(next()).toBeDisabled()
    expect(screen.getByText(/Select at least one strategy/)).toBeInTheDocument()
  })

  it('clamps the budget to 1..100', async () => {
    renderPage()
    const input = await screen.findByLabelText('Labeling budget')
    fireEvent.change(input, { target: { value: '0' } })
    expect(input).toHaveValue(1)
    fireEvent.change(input, { target: { value: '101' } })
    expect(input).toHaveValue(100)
  })

  it('warns and blocks Next when the pipeline name already exists', async () => {
    renderPage()
    const name = await screen.findByLabelText('Pipeline name')
    await screen.findByDisplayValue('demo-pipeline-01-abcdef')
    fireEvent.change(name, { target: { value: 'taken' } })
    expect(await screen.findByText(/already exists/)).toBeInTheDocument()
    expect(next()).toBeDisabled()
  })

  it('fills the form from an existing pipeline', async () => {
    renderPage()
    fireEvent.click(await screen.findByLabelText('Use existing pipeline'))
    fireEvent.change(await screen.findByLabelText('Existing pipeline'), {
      target: { value: 'old-abcdef' },
    })
    await waitFor(() => expect(screen.getByLabelText('Labeling budget')).toHaveValue(33))
    expect(screen.getByLabelText('Dataset')).toHaveValue('other')
    expect(screen.getByLabelText('Outlier Detector')).not.toBeChecked()
  })

  it('saves a new pipeline, stores it in the session and moves on', async () => {
    const pb = renderPage()
    await screen.findByDisplayValue('demo-pipeline-01-abcdef')
    await waitFor(() => expect(next()).toBeEnabled())
    fireEvent.click(next())
    await screen.findByRole('heading', { name: 'Domain Folding' })
    expect(m.createPipeline).toHaveBeenCalledTimes(1)
    expect(m.createPipeline).toHaveBeenCalledWith('demo-pipeline-01-abcdef', {
      selected_dataset: 'demo',
      labeling_budget: 10,
      selected_strategies: ['Typo Detector', 'Outlier Detector'],
    })
    const data = pb.data.sessions[0].data
    expect(data.pipeline_path).toBe('demo-pipeline-01-abcdef')
    expect(data.labeling_budget).toBe(10)
  })

  it('stays on the page and shows the error when saving fails', async () => {
    m.createPipeline.mockRejectedValue(new Error('A pipeline with that name already exists'))
    renderPage()
    await screen.findByDisplayValue('demo-pipeline-01-abcdef')
    await waitFor(() => expect(next()).toBeEnabled())
    fireEvent.click(next())
    expect(await screen.findByText(/A pipeline with that name already exists/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Domain Folding' })).toBeNull()
  })
})
