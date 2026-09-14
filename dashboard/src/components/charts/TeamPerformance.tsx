import type { TeamRow } from '@/lib/analysis'
import { duration, percent } from '@/lib/format'
import clsx from 'clsx'
import { useMemo, useState } from 'react'

type SortKey = 'team' | 'count' | 'avgDurationMinutes' | 'openRatePct'

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'team', label: 'Recorded by', numeric: false },
  { key: 'count', label: 'Records', numeric: true },
  { key: 'avgDurationMinutes', label: 'Avg duration', numeric: true },
  { key: 'openRatePct', label: 'Still open', numeric: true },
]

/**
 * Rework volume and speed by the person/team who recorded the defect.
 *
 * A bar chart was the obvious choice and is the wrong one: colouring bars
 * darker-where-bigger on nominal categories double-encodes length as hue and
 * burns the only free channel. Four numbers per row also read faster in a
 * table than across four charts — and it sorts.
 *
 * Note this is "recorded by", not "responsible for". Treating it as a
 * performance ranking of people would be reading far more into the field than
 * it supports.
 */
export function TeamPerformance({ rows }: { rows: TeamRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('count')
  const [descending, setDescending] = useState(true)

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const left = a[sortKey]
      const right = b[sortKey]
      if (typeof left === 'string' && typeof right === 'string') {
        return descending ? right.localeCompare(left) : left.localeCompare(right)
      }
      const leftNum = Number.isFinite(left as number) ? (left as number) : -Infinity
      const rightNum = Number.isFinite(right as number) ? (right as number) : -Infinity
      return descending ? rightNum - leftNum : leftNum - rightNum
    })
    return copy
  }, [rows, sortKey, descending])

  const maxCount = Math.max(...rows.map((r) => r.count), 1)

  const toggle = (key: SortKey) => {
    if (key === sortKey) setDescending((d) => !d)
    else {
      setSortKey(key)
      setDescending(true)
    }
  }

  return (
    <div className="overflow-x-auto px-2 pb-3">
      <table className="w-full min-w-[520px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-hairline">
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={clsx('px-3 py-2 font-medium', column.numeric && 'text-right')}
              >
                <button
                  type="button"
                  onClick={() => toggle(column.key)}
                  className={clsx(
                    'inline-flex items-center gap-1 transition-colors hover:text-ink',
                    sortKey === column.key ? 'text-ink' : 'text-ink-muted',
                  )}
                  aria-sort={
                    sortKey === column.key ? (descending ? 'descending' : 'ascending') : 'none'
                  }
                >
                  {column.label}
                  <span aria-hidden className={clsx('text-[0.5rem]', sortKey !== column.key && 'opacity-30')}>
                    {sortKey === column.key && !descending ? '▲' : '▼'}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.team} className="border-b border-hairline/60 transition-colors last:border-0 hover:bg-ink/3">
              <td className="px-3 py-2.5 font-medium text-ink">{row.team}</td>
              <td className="px-3 py-2.5 text-right">
                <div className="flex items-center justify-end gap-2">
                  {/* Inline magnitude bar — one hue, length is the only encoding. */}
                  <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-ink/8 sm:block" aria-hidden>
                    <span
                      className="block h-full rounded-full bg-s1 transition-[width] duration-500"
                      style={{ width: `${(row.count / maxCount) * 100}%` }}
                    />
                  </span>
                  <span className="tabular text-ink">{row.count}</span>
                </div>
              </td>
              <td className="px-3 py-2.5 text-right tabular text-ink-secondary">
                {Number.isFinite(row.avgDurationMinutes) ? duration(row.avgDurationMinutes) : '—'}
              </td>
              <td className="px-3 py-2.5 text-right tabular text-ink-secondary">
                {row.open > 0 ? `${row.open} · ${percent(row.openRatePct, 0)}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
