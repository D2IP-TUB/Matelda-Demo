import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

interface DataTableProps {
  columns: string[]
  rows: string[][]
  /** diff[r][c] is true where the cell differs between dirty and clean. */
  diff?: boolean[][]
  highlight?: 'dirty' | 'clean'
  /** Inline style per cell, e.g. shading by confidence. */
  cellStyle?: (row: number, col: number) => CSSProperties | undefined
  /** Click a header to sort by that column. */
  sortable?: boolean
  /** Class for a whole row, by the row's original index. */
  rowClassName?: (row: number) => string | undefined
}

// Built on TanStack Table (headless): sorting, column visibility or virtualization can be
// added here later without touching the pages. Paging is done by the API.
export function DataTable({ columns, rows, diff, highlight, cellStyle, sortable, rowClassName }: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const defs = useMemo<ColumnDef<string[]>[]>(
    () => columns.map((name, i) => ({ id: String(i), header: name, accessorFn: (row) => row[i] })),
    [columns],
  )
  const table = useReactTable({
    data: rows,
    columns: defs,
    getCoreRowModel: getCoreRowModel(),
    ...(sortable
      ? { state: { sorting }, onSortingChange: setSorting, getSortedRowModel: getSortedRowModel() }
      : {}),
  })

  return (
    <div className="table-wrap">
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
                  style={sortable ? { cursor: 'pointer' } : undefined}
                  aria-sort={
                    header.column.getIsSorted() === 'asc'
                      ? 'ascending'
                      : header.column.getIsSorted() === 'desc'
                        ? 'descending'
                        : undefined
                  }
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() === 'asc' ? ' ▲' : header.column.getIsSorted() === 'desc' ? ' ▼' : ''}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={rowClassName?.(row.index)}>
              {row.getVisibleCells().map((cell, c) => (
                <td
                  key={cell.id}
                  className={diff?.[row.index]?.[c] && highlight ? `diff-${highlight}` : undefined}
                  style={cellStyle?.(row.index, c)}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
