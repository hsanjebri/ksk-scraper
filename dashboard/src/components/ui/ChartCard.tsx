import { useState, type ReactNode } from 'react'
import { Card, CardHeader, ChartSkeleton, EmptyState, ViewToggle } from './primitives'

export interface TableColumn {
  key: string
  label: string
  numeric?: boolean
}

export interface ChartCardProps {
  title: string
  subtitle?: string
  loading?: boolean
  isEmpty?: boolean
  emptyHint?: string
  onReset?: () => void
  height?: number
  actions?: ReactNode
  /**
   * The chart's data as a plain table. Required, not optional: three light-mode
   * series colours sit below 3:1 contrast, and the table view is the mandated
   * relief so a value is never reachable by colour alone.
   */
  table: { columns: TableColumn[]; rows: (string | number)[][] }
  children: ReactNode
}

export function ChartCard({
  title,
  subtitle,
  loading = false,
  isEmpty = false,
  emptyHint,
  onReset,
  height = 280,
  actions,
  table,
  children,
}: ChartCardProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart')

  return (
    <Card className="card-lift flex flex-col">
      <CardHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {actions}
            <ViewToggle view={view} onChange={setView} />
          </>
        }
      />

      {loading ? (
        <ChartSkeleton height={height} />
      ) : isEmpty ? (
        <EmptyState hint={emptyHint} onReset={onReset} />
      ) : view === 'chart' ? (
        <div className="px-2 pb-2">{children}</div>
      ) : (
        <DataTable {...table} height={height} />
      )}
    </Card>
  )
}

function DataTable({
  columns,
  rows,
  height,
}: {
  columns: TableColumn[]
  rows: (string | number)[][]
  height: number
}) {
  return (
    <div className="overflow-auto px-5 pb-5" style={{ maxHeight: height + 40 }}>
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-hairline">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`py-2 pr-4 font-medium text-ink-muted ${column.numeric ? 'text-right' : ''}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-hairline/60 last:border-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`py-2 pr-4 text-ink-secondary ${
                    columns[cellIndex]?.numeric ? 'tabular text-right' : ''
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
