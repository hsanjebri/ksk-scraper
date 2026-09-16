import type { ErrorCodeRow } from '@/lib/aggregate'
import { percent } from '@/lib/format'
import clsx from 'clsx'
import { useMemo, useState } from 'react'

type SortKey = 'code' | 'count' | 'sharePct'

/**
 * Error-code frequency, searchable and sortable.
 *
 * The trend arrow ships with a glyph AND a word in its tooltip, never colour
 * alone — two of the status hues sit below 3:1 on the light surface, and a
 * colour-only indicator is invisible to a CVD reader regardless.
 */
export function ErrorCodeTable({
  rows,
  activeCode,
  onSelect,
}: {
  rows: ErrorCodeRow[]
  activeCode?: string | null
  onSelect?: (code: string) => void
}) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('count')
  const [descending, setDescending] = useState(true)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? rows.filter(
          (r) =>
            r.code.toLowerCase().includes(needle) ||
            r.description.toLowerCase().includes(needle),
        )
      : rows

    return [...filtered].sort((a, b) => {
      if (sortKey === 'code') {
        return descending ? b.code.localeCompare(a.code) : a.code.localeCompare(b.code)
      }
      const left = a[sortKey]
      const right = b[sortKey]
      return descending ? right - left : left - right
    })
  }, [rows, query, sortKey, descending])

  const max = Math.max(...rows.map((r) => r.count), 1)

  const toggle = (key: SortKey) => {
    if (key === sortKey) setDescending((d) => !d)
    else {
      setSortKey(key)
      setDescending(true)
    }
  }

  const TREND = {
    up: { glyph: '▲', title: 'More frequent than last week', cls: 'text-critical' },
    down: { glyph: '▼', title: 'Less frequent than last week', cls: 'text-success-text' },
    flat: { glyph: '–', title: 'Unchanged vs last week', cls: 'text-ink-muted' },
  } as const

  const columns: { key: SortKey; label: string; numeric: boolean }[] = [
    { key: 'code', label: 'Code', numeric: false },
    { key: 'count', label: 'Occurrences', numeric: true },
    { key: 'sharePct', label: 'Share', numeric: true },
  ]

  return (
    <div className="px-2 pb-3">
      <div className="px-3 pb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code or description…"
          aria-label="Search error codes"
          className="w-full rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs text-ink outline-none transition focus:border-s1/50"
        />
      </div>

      <div className="max-h-[320px] overflow-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-hairline">
              {columns.map((column) => (
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
                  >
                    {column.label}
                    <span
                      aria-hidden
                      className={clsx('text-[0.5rem]', sortKey !== column.key && 'opacity-30')}
                    >
                      {sortKey === column.key && !descending ? '▲' : '▼'}
                    </span>
                  </button>
                </th>
              ))}
              <th scope="col" className="px-3 py-2 font-medium text-ink-muted">
                Description
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-ink-muted">
                Trend
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const trend = TREND[row.trend]
              return (
                <tr
                  key={row.code}
                  onClick={onSelect ? () => onSelect(row.code) : undefined}
                  className={clsx(
                    'border-b border-hairline/60 transition-colors last:border-0',
                    onSelect && 'cursor-pointer hover:bg-ink/3',
                    activeCode === row.code && 'bg-s1/8',
                  )}
                >
                  <td className="px-3 py-2.5 font-medium tabular text-ink">{row.code}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span
                        className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-ink/8 sm:block"
                        aria-hidden
                      >
                        <span
                          className="block h-full rounded-full bg-s1"
                          style={{ width: `${(row.count / max) * 100}%` }}
                        />
                      </span>
                      <span className="tabular text-ink">{row.count}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular text-ink-secondary">
                    {percent(row.sharePct)}
                  </td>
                  <td
                    className="max-w-[260px] truncate px-3 py-2.5 text-ink-secondary"
                    title={row.description}
                  >
                    {row.description || '—'}
                  </td>
                  <td className={clsx('px-3 py-2.5 text-right font-medium', trend.cls)}>
                    <span title={trend.title}>{trend.glyph}</span>
                    <span className="sr-only">{trend.title}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-ink-muted">
            No code matches “{query}”.
          </p>
        )}
      </div>
    </div>
  )
}
