import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'

interface DataTableProps {
  columns: string[]
  rows: string[][]
  /** diff[r][c] is true where the cell differs between dirty and clean. */
  diff?: boolean[][]
  highlight?: 'dirty' | 'clean'
}

// Built on TanStack Table (headless): sorting, column visibility or virtualization can be
// added here later without touching the pages. Paging is done by the API.
export function DataTable({ columns, rows, diff, highlight }: DataTableProps) {
  const defs = useMemo<ColumnDef<string[]>[]>(
    () => columns.map((name, i) => ({ id: String(i), header: name, accessorFn: (row) => row[i] })),
    [columns],
  )
  const table = useReactTable({ data: rows, columns: defs, getCoreRowModel: getCoreRowModel() })

  return (
    <div className="table-wrap">
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell, c) => (
                <td
                  key={cell.id}
                  className={diff?.[row.index]?.[c] && highlight ? `diff-${highlight}` : undefined}
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
