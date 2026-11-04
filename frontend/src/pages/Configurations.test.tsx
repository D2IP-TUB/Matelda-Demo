import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as api from '../lib/api'
import { SessionProvider } from '../session/SessionProvider'
import { SessionService } from '../session/sessionService'
import { FakePocketBase } from '../test/fakePocketBase'
import { seedSession } from '../test/helpers'
import { Configurations } from './Configurations'
import { act } from '@testing-library/react'
import { setLang } from '../i18n'
import { de } from '../i18n/de'

vi.mock('../lib/api', () => ({
  fetchDatasets: vi.fn(),
  fetchStrategies: vi.fn(),
  fetchTables: vi.fn(),
  fetchDirtyPage: vi.fn(),
  fetchCompare: vi.fn(),
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
  m.fetchTables.mockReset().mockResolvedValue(['t1', 't2'])
  m.fetchDirtyPage.mockReset().mockResolvedValue({ columns: ['a', 'b'], rows: [['1', '2']], total_rows: 250, offset: 0 })
  m.fetchCompare.mockReset().mockResolvedValue({
    columns: ['a', 'b'], dirty_rows: [['1', 'x']], clean_rows: [['1', '2']], diff: [[false, true]],
    offset: 0, total_rows: 1, total_cells: 2, differing_cells: 1, error_rate: 50,
  })
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

const next = () => screen.getByRole('button', { name: 'Continue' })

describe('Configurations', () => {
  it('preselects all strategies and suggests a name with the session suffix', async () => {
    renderPage()
    expect(await screen.findByLabelText('Typo Detector')).toBeChecked()
    expect(screen.getByLabelText('Outlier Detector')).toBeChecked()
    await waitFor(() => expect(m.suggestPipelineName).toHaveBeenCalledWith('demo', 'abcdef'))
    expect(await screen.findByDisplayValue('demo-pipeline-01-abcdef')).toBeInTheDocument()
  })

  it('shows an error and blocks Continue when strategies cannot be loaded', async () => {
    m.fetchStrategies.mockRejectedValue(new Error('Could not load strategies'))
    renderPage()
    expect(await screen.findByText(/Could not load strategies/)).toBeInTheDocument()
    expect(next()).toBeDisabled()
  })

  it('blocks Continue when no strategy is selected', async () => {
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

  it('Continue shows the spinner while the pipeline is being saved, with no separate Saving text', async () => {
    m.createPipeline.mockImplementation(() => new Promise(() => {}))
    renderPage()
    await screen.findByDisplayValue('demo-pipeline-01-abcdef')
    await waitFor(() => expect(next()).toBeEnabled())
    fireEvent.click(next())
    await waitFor(() => expect(next()).toHaveAttribute('aria-busy', 'true'))
    expect(next().querySelector('.spinner')).not.toBeNull()
    expect(screen.queryByText('Saving…')).toBeNull()
  })

  it('warns and blocks Continue when the pipeline name already exists', async () => {
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

  it('defaults to a new pipeline but keeps the settings you had when you come back', async () => {
    renderPage({
      pipeline_path: 'old-abcdef', dataset_select: 'other', labeling_budget: 33, selected_strategies: ['Typo Detector'],
    })
    await waitFor(() => expect(screen.getByLabelText('Labeling budget')).toHaveValue(33)) // restored
    expect(screen.getByLabelText('Create new pipeline')).toBeChecked()
    expect(screen.getByLabelText('Use existing pipeline')).not.toBeChecked()
    expect(screen.getByLabelText('Dataset')).toHaveValue('other')
    await waitFor(() => expect(screen.getByLabelText('Outlier Detector')).not.toBeChecked())
    expect(screen.getByLabelText('Typo Detector')).toBeChecked()
  })

  it('continuing after coming back creates a new pipeline with those settings', async () => {
    const pb = renderPage({
      pipeline_path: 'old-abcdef', dataset_select: 'other', labeling_budget: 33, selected_strategies: ['Typo Detector'],
    })
    await screen.findByDisplayValue('demo-pipeline-01-abcdef')
    await waitFor(() => expect(next()).toBeEnabled())
    fireEvent.click(next())
    await screen.findByRole('heading', { name: 'Domain Folding' })
    expect(m.updatePipeline).not.toHaveBeenCalled()
    expect(m.createPipeline).toHaveBeenCalledWith('demo-pipeline-01-abcdef', {
      selected_dataset: 'other', labeling_budget: 33, selected_strategies: ['Typo Detector'],
    })
    expect(pb.data.sessions[0].data.pipeline_path).toBe('demo-pipeline-01-abcdef')
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

  it('lists the dataset tables and opens one in a pop-up', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 't1' }))
    expect(await screen.findByRole('dialog', { name: 'Table t1' })).toBeInTheDocument()
    expect(await screen.findByText('Rows: 250 · Columns: 2')).toBeInTheDocument()
    expect(m.fetchTables).toHaveBeenCalledWith('demo')
    expect(m.fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 0, 100)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(m.fetchDirtyPage).toHaveBeenCalledWith('demo', 't1', 100, 100))
  })

  it('shows dirty vs clean with highlighted cells in the pop-up', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 't1' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Dirty vs Clean' }))
    expect(await screen.findByText('50.00%')).toBeInTheDocument()
    expect(document.querySelectorAll('td.diff-dirty')).toHaveLength(1)
    expect(document.querySelectorAll('td.diff-clean')).toHaveLength(1)
  })

  it('warns when the table has no clean version', async () => {
    m.fetchCompare.mockRejectedValue(new Error('No clean.csv for this table'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 't1' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Dirty vs Clean' }))
    expect(await screen.findByText(/No clean.csv/)).toBeInTheDocument()
  })

  it('closes the pop-up with Close, Escape or a backdrop click', async () => {
    renderPage()
    for (const close of [
      () => fireEvent.click(screen.getByRole('button', { name: 'Close' })),
      () => fireEvent.keyDown(document, { key: 'Escape' }),
      () => fireEvent.click(screen.getByTestId('table-backdrop')),
    ]) {
      fireEvent.click(await screen.findByRole('button', { name: 't1' }))
      await screen.findByRole('dialog')
      close()
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
  })

  it('handles a dataset without tables', async () => {
    m.fetchTables.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No tables found in this dataset.')).toBeInTheDocument()
  })
})

describe('Configurations (German)', () => {
  beforeEach(() => act(() => setLang('de')))
  afterEach(() => act(() => setLang('en')))

  it('shows the German primary action and section titles', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: de.configurations.continue })).toBeInTheDocument()
    expect(screen.getByText(de.configurations.lead)).toBeInTheDocument()
  })

  it('keeps dataset, table and detector names unchanged', async () => {
    renderPage()
    expect(await screen.findByLabelText('Typo Detector')).toBeChecked()
    expect(screen.getByRole('radio', { name: 'demo' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 't1' })).toBeInTheDocument()
  })

  it('warns in German when the pipeline name already exists', async () => {
    renderPage()
    const name = await screen.findByLabelText(de.configurations.pipelineName)
    await screen.findByDisplayValue('demo-pipeline-01-abcdef')
    fireEvent.change(name, { target: { value: 'taken' } })
    expect(await screen.findByText(de.configurations.nameTaken)).toBeInTheDocument()
  })
})
