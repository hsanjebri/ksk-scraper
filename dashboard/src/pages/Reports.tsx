import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { Reveal } from '@/components/ui/Reveal'
import { useFilteredRecords } from '@/hooks/useDashboardData'
import { downloadCsv, toCsv } from '@/lib/csv'
import { duration, shortDateTime } from '@/lib/format'
import { elapsedMinutes } from '@/lib/metrics'
import { useFilters } from '@/store/useFilters'
import { useRecords } from '@/store/useRecords'
import clsx from 'clsx'
import { useMemo, useState } from 'react'

/** Site model code -> the project name people actually use. */
const PROJECT_NAMES: Record<string, string> = { MAM: 'MMA', MCM: 'MBEAM' }

const COLUMNS = [
  'No.',
  'Project',
  'Model',
  'CarID',
  'ZSB',
  'Registered',
  'Reworked',
  'Status',
  'Duration',
  'Error code',
  'Part type',
  'Part name',
  'Quality gate',
  'Defect shift',
  'Detect shift',
  'Recorded by',
  'Comment',
]

/** Rendering thousands of rows freezes the page; the export is never capped. */
const RENDER_LIMIT = 200

export function Reports() {
  const { records, hasDrilldown } = useFilteredRecords()
  const loading = useRecords((s) => s.loading)
  const demo = useRecords((s) => s.demo)
  const clearDrilldown = useFilters((s) => s.clearDrilldown)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const filtered = useMemo(() => {
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : null
    // Inclusive end date — a user picking "to 14 Sep" means through the 14th.
    const toTime = to ? new Date(`${to}T23:59:59`).getTime() : null

    return records
      .filter((record) => {
        const t = new Date(record.registered).getTime()
        if (Number.isNaN(t)) return false
        if (fromTime !== null && t < fromTime) return false
        if (toTime !== null && t > toTime) return false
        return true
      })
      .sort(
        (a, b) => new Date(b.registered).getTime() - new Date(a.registered).getTime(),
      )
  }, [records, from, to])

  const rows = useMemo(
    () =>
      filtered.map((r) => [
        r.no,
        PROJECT_NAMES[r.model] ?? r.model,
        r.model,
        r.carId,
        r.zsb,
        shortDateTime(r.registered),
        r.reworked ? shortDateTime(r.reworked) : '',
        r.status,
        duration(elapsedMinutes(r)),
        r.errorCode ?? '',
        r.partType ?? '',
        r.partName ?? '',
        r.qualityGate ?? '',
        r.defectShift ?? '',
        r.detectShift ?? '',
        r.defectBy ?? '',
        r.comment ?? '',
      ]),
    [filtered],
  )

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    const range = from || to ? `_${from || 'start'}_to_${to || 'now'}` : ''
    downloadCsv(`sebn-tn3-rework${range}_${stamp}.csv`, toCsv(COLUMNS, rows))
  }

  return (
    <div className="space-y-5">
      <Reveal index={0}>
        <Card className="card-lift flex flex-col">
          <CardHeader
            title="Full extraction"
            subtitle={
              loading
                ? undefined
                : `${filtered.length} record${filtered.length === 1 ? '' : 's'} in range · exports every row, not just the ones shown`
            }
            actions={
              <button
                type="button"
                onClick={exportCsv}
                disabled={rows.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-s1 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12v1.5h10V12" />
                </svg>
                Export CSV
              </button>
            }
          />

          <div className="flex flex-wrap items-end gap-3 px-5 pb-4">
            <label className="flex flex-col gap-1">
              <span className="text-[0.6875rem] font-medium text-ink-muted">From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs text-ink outline-none transition focus:border-s1/50"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[0.6875rem] font-medium text-ink-muted">To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs text-ink outline-none transition focus:border-s1/50"
              />
            </label>
            {(from || to) && (
              <button
                type="button"
                onClick={() => {
                  setFrom('')
                  setTo('')
                }}
                className="rounded-md border border-hairline px-2.5 py-1.5 text-[0.6875rem] font-medium text-ink-secondary transition hover:bg-ink/5"
              >
                Clear dates
              </button>
            )}
            {demo && (
              <span className="ml-auto rounded bg-warning/18 px-2 py-1 text-[0.6875rem] font-medium text-ink">
                Demo data — not from the factory
              </span>
            )}
          </div>

          {loading ? (
            <div className="px-5 pb-5 text-xs text-ink-muted">Loading…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No records in this range"
              hint="Widen the date range, or clear the model and drill-down filters."
              onReset={hasDrilldown ? clearDrilldown : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-hairline">
                    {COLUMNS.map((column) => (
                      <th
                        key={column}
                        scope="col"
                        className="px-3 py-2 font-medium whitespace-nowrap text-ink-muted"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, RENDER_LIMIT).map((row, index) => (
                    <tr
                      key={`${row[0]}-${row[2]}-${index}`}
                      className="border-b border-hairline/60 transition-colors last:border-0 hover:bg-ink/3"
                    >
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={clsx(
                            'px-3 py-2 text-ink-secondary',
                            cellIndex === 0 && 'tabular font-medium text-ink',
                            cellIndex === 16 && 'max-w-[280px] truncate',
                            [5, 6, 8].includes(cellIndex) && 'tabular whitespace-nowrap',
                          )}
                          title={cellIndex === 16 ? String(cell) : undefined}
                        >
                          {String(cell) || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {rows.length > RENDER_LIMIT && (
                <p className="px-5 py-2.5 text-[0.6875rem] text-ink-muted">
                  Showing the {RENDER_LIMIT} most recent of {rows.length} records. The CSV
                  export contains all {rows.length}.
                </p>
              )}
            </div>
          )}
        </Card>
      </Reveal>

      <p className="text-[0.6875rem] text-ink-muted">
        The export is written as UTF-8 with a byte-order mark so Excel reads the accented
        French comments correctly — without it they arrive as mojibake. Duration for an
        open record is time elapsed so far, not a final figure.
      </p>
    </div>
  )
}
