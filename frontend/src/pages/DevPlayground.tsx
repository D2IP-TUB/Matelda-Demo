import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useJob } from '../jobs/useJob'
import { fetchDatasets, startDomainFolding } from '../lib/api'

interface DomainFolds {
  domain_folds: Record<string, string[]>
}

export function DevPlayground() {
  const datasets = useQuery({ queryKey: ['datasets'], queryFn: fetchDatasets })
  const [dataset, setDataset] = useState('')
  const [budget, setBudget] = useState(10)
  const [jobId, setJobId] = useState<string | null>(null)
  const [startError, setStartError] = useState('')
  const job = useJob<DomainFolds>(jobId)
  const chosen = dataset || datasets.data?.[0] || ''

  const run = async () => {
    setStartError('')
    try {
      setJobId(await startDomainFolding(chosen, budget))
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Failed to start')
    }
  }

  return (
    <main>
      <h1>Dev playground</h1>
      <p>Runs the real domain folding as a background job.</p>
      <select aria-label="Dataset" value={chosen} onChange={(e) => setDataset(e.target.value)}>
        {(datasets.data ?? []).map((d) => (
          <option key={d}>{d}</option>
        ))}
      </select>
      <input
        aria-label="Labeling budget"
        type="number"
        min={1}
        value={budget}
        onChange={(e) => setBudget(Number(e.target.value))}
      />
      <button onClick={run} disabled={!chosen || budget < 1}>
        Run domain folding
      </button>
      {startError && <p role="alert">{startError}</p>}
      <p>Job state: {job.state}</p>
      {job.state === 'lost' && <p>Job lost (the API restarted?). Run it again.</p>}
      {job.state === 'failed' && <p role="alert">{job.error}</p>}
      {job.state === 'done' && (
        <ul>
          {Object.entries(job.result?.domain_folds ?? {}).map(([name, tables]) => (
            <li key={name}>
              {name}: {tables.length} tables
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
