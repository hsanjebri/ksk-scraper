import type { RankedRow } from '@/lib/analysis'
import { duration } from '@/lib/format'
import { Badge } from '@/components/ui/primitives'
import clsx from 'clsx'

/**
 * Ranked list with an inline magnitude bar.
 *
 * One hue for every row — rank is already carried by position and by bar
 * length, so shading rows darker-where-bigger would triple-encode the same
 * number and spend the colour channel on nothing.
 */
export function RankedTable({
  rows,
  keyLabel,
  secondaryLabel,
  /** Rows above this count get a "repeat" flag — see topCars(). */
  repeatThreshold,
}: {
  rows: RankedRow[]
  keyLabel: string
  secondaryLabel: string
  repeatThreshold?: number
}) {
  const max = Math.max(...rows.map((r) => r.count), 1)
  const min = Math.min(...rows.map((r) => r.count), max)
  // With no spread, every bar would be full width and encode nothing — worse
  // than no bar, because it reads as "all at maximum".
  const showBars = max !== min

  return (
    <div className="overflow-x-auto px-2 pb-3">
      <table className="w-full min-w-[480px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-hairline">
            <th scope="col" className="px-3 py-2 font-medium text-ink-muted">
              #
            </th>
            <th scope="col" className="px-3 py-2 font-medium text-ink-muted">
              {keyLabel}
            </th>
            <th scope="col" className="px-3 py-2 font-medium text-ink-muted">
              {secondaryLabel}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium text-ink-muted">
              Count
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium text-ink-muted">
              Avg duration
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.key}
              className="border-b border-hairline/60 transition-colors last:border-0 hover:bg-ink/3"
            >
              <td className="px-3 py-2.5 tabular text-ink-muted">{index + 1}</td>
              <td className="px-3 py-2.5 font-medium text-ink">
                <span className="flex items-center gap-2">
                  <span className="truncate">{row.key}</span>
                  {repeatThreshold !== undefined && row.count >= repeatThreshold && (
                    <Badge tone="critical">repeat</Badge>
                  )}
                </span>
              </td>
              <td className="max-w-[160px] truncate px-3 py-2.5 text-ink-secondary">
                {row.secondary}
              </td>
              <td className="px-3 py-2.5 text-right">
                <div className="flex items-center justify-end gap-2">
                  {showBars && (
                    <span
                      className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-ink/8 sm:block"
                      aria-hidden
                    >
                      <span
                        className={clsx(
                          'block h-full rounded-full bg-s1 transition-[width] duration-500',
                        )}
                        style={{ width: `${(row.count / max) * 100}%` }}
                      />
                    </span>
                  )}
                  <span className="tabular text-ink">{row.count}</span>
                </div>
              </td>
              <td className="px-3 py-2.5 text-right tabular text-ink-secondary">
                {Number.isFinite(row.avgDurationMinutes) ? duration(row.avgDurationMinutes) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
