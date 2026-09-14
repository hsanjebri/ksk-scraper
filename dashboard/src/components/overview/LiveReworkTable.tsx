import { useNow } from '@/hooks/useDashboardData'
import { URGENCY_BANDS } from '@/lib/config'
import { durationLive, shortDateTime } from '@/lib/format'
import { elapsedMinutes, isOpen } from '@/lib/metrics'
import { useRecords } from '@/store/useRecords'
import type { KskRecord } from '@/types'
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/primitives'
import clsx from 'clsx'
import { useMemo } from 'react'

type Urgency = 'normal' | 'attention' | 'critical'

function urgencyOf(minutes: number): Urgency {
  if (minutes >= URGENCY_BANDS.critical) return 'critical'
  if (minutes >= URGENCY_BANDS.warning) return 'attention'
  return 'normal'
}

/**
 * Urgency is shown as dot + written label, never colour alone — two of the
 * status hues sit below 3:1 on the light surface, and a colour-only state
 * would be unreadable for CVD users regardless.
 */
const URGENCY_META: Record<Urgency, { label: string; dot: string; text: string }> = {
  normal: { label: 'Normal', dot: 'bg-good', text: 'text-success-text' },
  attention: { label: 'Attention', dot: 'bg-warning', text: 'text-ink' },
  critical: { label: 'Critique', dot: 'bg-critical', text: 'text-critical' },
}

export function LiveReworkTable({
  records,
  loading,
}: {
  records: KskRecord[]
  loading: boolean
}) {
  // 1s tick so elapsed times count up live instead of freezing at the value
  // the server computed when the page loaded.
  const now = useNow(1000)
  const recentlyChanged = useRecords((s) => s.recentlyChanged)

  const open = useMemo(() => {
    return records
      .filter(isOpen)
      .map((record) => ({ record, minutes: elapsedMinutes(record, now) }))
      .sort((a, b) => b.minutes - a.minutes)
  }, [records, now])

  const criticalCount = open.filter((row) => urgencyOf(row.minutes) === 'critical').length

  return (
    <Card className="card-lift flex flex-col">
      <CardHeader
        title="Cars currently in rework"
        subtitle={
          loading
            ? undefined
            : `${open.length} open · longest ${open[0] ? durationLive(open[0].minutes) : '—'}`
        }
        actions={
          criticalCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-critical/10 px-2.5 py-1 text-[0.6875rem] font-medium text-critical">
              <span className="size-1.5 rounded-full bg-critical" aria-hidden />
              {criticalCount} over {URGENCY_BANDS.critical / 60}h
            </span>
          ) : null
        }
      />

      {loading ? (
        <div className="space-y-2 px-5 pb-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : open.length === 0 ? (
        <EmptyState
          title="Nothing in rework right now"
          hint="Open records appear here the moment the scraper reports them."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-hairline">
                {['CarID', 'Model', 'Error', 'Part', 'Registered', 'Elapsed', 'Status'].map(
                  (heading, index) => (
                    <th
                      key={heading}
                      scope="col"
                      className={clsx(
                        'px-3 py-2 font-medium text-ink-muted',
                        index === 0 && 'pl-5',
                        heading === 'Elapsed' && 'text-right',
                      )}
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {open.slice(0, 12).map(({ record, minutes }) => {
                const urgency = urgencyOf(minutes)
                const meta = URGENCY_META[urgency]
                return (
                  <tr
                    key={record.id}
                    className={clsx(
                      'border-b border-hairline/60 transition-colors last:border-0 hover:bg-ink/3',
                      recentlyChanged.has(record.id) && 'animate-pulse-in',
                    )}
                  >
                    <td className="px-3 py-2.5 pl-5 font-medium text-ink">{record.carId}</td>
                    <td className="px-3 py-2.5 text-ink-secondary">{record.model}</td>
                    <td className="px-3 py-2.5 tabular text-ink-secondary">
                      {record.errorCode ?? '—'}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 text-ink-secondary" title={record.partName ?? ''}>
                      {record.partName ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 tabular text-ink-muted">
                      {shortDateTime(record.registered)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular font-medium text-ink">
                      {durationLive(minutes)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={clsx('inline-flex items-center gap-1.5 font-medium', meta.text)}>
                        <span className={clsx('size-1.5 shrink-0 rounded-full', meta.dot)} aria-hidden />
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {open.length > 12 && (
            <p className="px-5 py-2.5 text-[0.6875rem] text-ink-muted">
              Showing the 12 longest-running of {open.length} open records.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
