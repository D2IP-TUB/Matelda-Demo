import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { DataTable } from './DataTable'
import { Notice } from './ui'
import { useT } from '../i18n'
import { fetchCompare, fetchDirtyPage } from '../lib/api'

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
  const tr = useT().shell
  const last = Math.min(offset + PAGE_SIZE, total)
  return (
    <div className={`pager${total <= PAGE_SIZE ? ' pager-single' : ''}`}>
      <button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}>
        {tr.previousPage}
      </button>
      <span>
        {tr.rowsRange(total === 0 ? 0 : offset + 1, last, total)}
      </span>
      <button disabled={offset + PAGE_SIZE >= total} onClick={() => onChange(offset + PAGE_SIZE)}>
        {tr.nextPage}
      </button>
    </div>
  )
}

function InputTables({ dataset, table }: { dataset: string; table: string }) {
  const tr = useT().shell
  const [offset, setOffset] = useState(0)
  const preview = useQuery({
    queryKey: ['dirty', dataset, table, offset],
    queryFn: () => fetchDirtyPage(dataset, table, offset, PAGE_SIZE),
  })
  return (
    <>
      {preview.isError && <Notice kind="error">{(preview.error as Error).message}</Notice>}
      {preview.data && (
        <>
          <p>{tr.rowsColumns(preview.data.total_rows, preview.data.columns.length)}</p>
          <DataTable columns={preview.data.columns} rows={preview.data.rows} />
          <Pager offset={offset} total={preview.data.total_rows} onChange={setOffset} />
        </>
      )}
    </>
  )
}

function DirtyVsClean({ dataset, table }: { dataset: string; table: string }) {
  const tr = useT().shell
  const [offset, setOffset] = useState(0)
  const result = useQuery({
    queryKey: ['compare', dataset, table, offset],
    queryFn: () => fetchCompare(dataset, table, offset, PAGE_SIZE),
  })
  const data = result.data
  return (
    <>
      <p>{tr.diffHint}</p>
      {result.isError && <Notice kind="warn">{(result.error as Error).message}</Notice>}
      {data && (
        <>
          <div className="stats">
            <div className="stat">
              <span>{tr.totalCells}</span>
              <b>{data.total_cells.toLocaleString()}</b>
            </div>
            <div className="stat">
              <span>{tr.differingCells}</span>
              <b>{data.differing_cells.toLocaleString()}</b>
            </div>
            <div className="stat">
              <span>{tr.errorRate}</span>
              <b>{data.error_rate.toFixed(2)}%</b>
            </div>
          </div>
          <div className="split">
            <div>
              <h3>{tr.dirtyTable}</h3>
              <DataTable columns={data.columns} rows={data.dirty_rows} diff={data.diff} highlight="dirty" />
            </div>
            <div>
              <h3>{tr.cleanTable}</h3>
              <DataTable columns={data.columns} rows={data.clean_rows} diff={data.diff} highlight="clean" />
            </div>
          </div>
          <Pager offset={offset} total={data.total_rows} onChange={setOffset} />
        </>
      )}
    </>
  )
}


export function TableModal({
  dataset,
  table,
  onClose,
}: {
  dataset: string
  table: string
  onClose: () => void
}) {
  const tr = useT().shell
  const [tab, setTab] = useState<'input' | 'compare'>('input')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" data-testid="table-backdrop" onClick={onClose}>
      <dialog
        open
        role="dialog"
        aria-label={tr.tableLabel(table)}
        className="cell-dialog table-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row">
          <h2>{table}</h2>
          <button type="button" onClick={onClose}>
            {tr.close}
          </button>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'input'} onClick={() => setTab('input')}>
            {tr.inputTable}
          </button>
          <button role="tab" aria-selected={tab === 'compare'} onClick={() => setTab('compare')}>
            {tr.dirtyVsClean}
          </button>
        </div>
        {tab === 'input' ? (
          <InputTables dataset={dataset} table={table} />
        ) : (
          <DirtyVsClean dataset={dataset} table={table} />
        )}
      </dialog>
    </div>
  )
}
