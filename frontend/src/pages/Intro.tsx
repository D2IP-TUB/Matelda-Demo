import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { Card, Notice } from '../components/ui'
import { fetchCompare, fetchDirtyPage, fetchTables } from '../lib/api'
import { useSession } from '../session/SessionProvider'

const PAGE_SIZE = 100

function Pager({
  offset,
  total,
  onChange,
}: {
  offset: number
  total: number
  onChange: (offset: number) => void
}) {
  const last = Math.min(offset + PAGE_SIZE, total)
  return (
    <div className="pager">
      <button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}>
        Previous page
      </button>
      <span>
        rows {total === 0 ? 0 : offset + 1}–{last} of {total}
      </span>
      <button disabled={offset + PAGE_SIZE >= total} onClick={() => onChange(offset + PAGE_SIZE)}>
        Next page
      </button>
    </div>
  )
}

function TablePicker({
  label,
  tables,
  value,
  onChange,
}: {
  label: string
  tables: string[]
  value: string
  onChange: (table: string) => void
}) {
  return (
    <div className="field">
      <label htmlFor={`pick-${label}`}>{label}</label>
      <select id={`pick-${label}`} value={value} onChange={(e) => onChange(e.target.value)}>
        {tables.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
    </div>
  )
}

function InputTables({ dataset, tables }: { dataset: string; tables: string[] }) {
  const [table, setTable] = useState(tables[0])
  const [offset, setOffset] = useState(0)
  const preview = useQuery({
    queryKey: ['dirty', dataset, table, offset],
    queryFn: () => fetchDirtyPage(dataset, table, offset, PAGE_SIZE),
  })
  return (
    <Card title="Input tables (dirty)">
      <TablePicker
        label="Preview table"
        tables={tables}
        value={table}
        onChange={(t) => {
          setTable(t)
          setOffset(0)
        }}
      />
      {preview.isError && <Notice kind="error">{(preview.error as Error).message}</Notice>}
      {preview.data && (
        <>
          <p>{`Rows: ${preview.data.total_rows} · Columns: ${preview.data.columns.length}`}</p>
          <DataTable columns={preview.data.columns} rows={preview.data.rows} />
          <Pager offset={offset} total={preview.data.total_rows} onChange={setOffset} />
        </>
      )}
    </Card>
  )
}

function DirtyVsClean({ dataset, tables }: { dataset: string; tables: string[] }) {
  const [table, setTable] = useState(tables[0])
  const [offset, setOffset] = useState(0)
  const result = useQuery({
    queryKey: ['compare', dataset, table, offset],
    queryFn: () => fetchCompare(dataset, table, offset, PAGE_SIZE),
  })
  const data = result.data
  return (
    <Card title="Dirty vs clean">
      <p>Cells that differ between the dirty and the clean version are highlighted.</p>
      <TablePicker
        label="Select table"
        tables={tables}
        value={table}
        onChange={(t) => {
          setTable(t)
          setOffset(0)
        }}
      />
      {result.isError && <Notice kind="warn">{(result.error as Error).message}</Notice>}
      {data && (
        <>
          <div className="stats">
            <div className="stat">
              <span>Total cells</span>
              <b>{data.total_cells.toLocaleString()}</b>
            </div>
            <div className="stat">
              <span>Differing cells</span>
              <b>{data.differing_cells.toLocaleString()}</b>
            </div>
            <div className="stat">
              <span>Error rate</span>
              <b>{data.error_rate.toFixed(2)}%</b>
            </div>
          </div>
          <div className="split">
            <div>
              <h3>Dirty table</h3>
              <DataTable columns={data.columns} rows={data.dirty_rows} diff={data.diff} highlight="dirty" />
            </div>
            <div>
              <h3>Clean table</h3>
              <DataTable columns={data.columns} rows={data.clean_rows} diff={data.diff} highlight="clean" />
            </div>
          </div>
          <Pager offset={offset} total={data.total_rows} onChange={setOffset} />
        </>
      )}
    </Card>
  )
}

export function Intro() {
  const session = useSession()
  const dataset = session.data.dataset_select as string | undefined
  const [tab, setTab] = useState<'input' | 'compare'>('input')
  const tables = useQuery({
    queryKey: ['tables', dataset],
    queryFn: () => fetchTables(dataset as string),
    enabled: !!dataset,
  })

  if (!session.ready) return <h1>Intro</h1>

  return (
    <>
      <h1>Intro</h1>
      {!dataset && (
        <>
          <Notice kind="warn">No dataset yet. Create or join a room and start it in the Lobby first.</Notice>
          <Link to="/lobby">Go to the Lobby →</Link>
        </>
      )}
      {dataset && tables.isError && <Notice kind="error">{(tables.error as Error).message}</Notice>}
      {dataset && tables.data && tables.data.length === 0 && (
        <Notice kind="info">No tables found in this dataset.</Notice>
      )}
      {dataset && tables.data && tables.data.length > 0 && (
        <>
          <p>
            <b>Dataset:</b> <code>{dataset}</code> — <b>{tables.data.length} table(s)</b>
          </p>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'input'} onClick={() => setTab('input')}>
              Input tables
            </button>
            <button role="tab" aria-selected={tab === 'compare'} onClick={() => setTab('compare')}>
              Dirty vs Clean
            </button>
          </div>
          {tab === 'input' ? (
            <InputTables dataset={dataset} tables={tables.data} />
          ) : (
            <DirtyVsClean dataset={dataset} tables={tables.data} />
          )}
        </>
      )}
      <div className="nav-row">
        <span />
        <Link className="btn btn-primary" to="/configuration">
          Next → Configurations
        </Link>
      </div>
    </>
  )
}
