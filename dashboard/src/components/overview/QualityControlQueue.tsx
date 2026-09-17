import { Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/primitives'
import { useNow } from '@/hooks/useDashboardData'
import { durationLive, shortDateTime } from '@/lib/format'
import type { KskRecord } from '@/types'
import { useMemo } from 'react'

/**
 * Harnesses repaired but not yet released by quality control.
 *
 * The rework system closes a Rework ID in three stages — Rework In, Rework Out
 * (the repair), then Quality Control, which is the step that actually releases
 * the harness and prints the label (system manual §5). A record sitting here
 * is finished as far as the repair goes but still blocked in the rework zone,
 * which is invisible if you only look at "Terminé".
 *
 * Normally this list is empty or near-empty: in the captured data the quality
 * check followed the repair within seconds. A row that lingers is the signal.
 */
export function QualityControlQueue({
  records,
  loading,
}: {
  records: KskRecord[]
  loading: boolean
}) {
  const now = useNow(1000)

  const waiting = useMemo(
    () =>
      records
        .filter((record) => record.awaitingQualityControl && record.reworked)
        .map((record) => ({
          record,
          minutes: Math.max(0, (now - new Date(record.reworked as string).getTime()) / 60_000),
        }))
        .sort((a, b) => b.minutes - a.minutes),
    [records, now],
  )

  return (
    <Card className="card-lift flex flex-col">
      <CardHeader
        title="Awaiting quality control"
        subtitle={
          loading
            ? undefined
            : waiting.length === 0
              ? 'Repaired records are being released without delay'
              : `${waiting.length} repaired · longest wait ${durationLive(waiting[0].minutes)}`
        }
      />

      {loading ? (
        <div className="space-y-2 px-5 pb-5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : waiting.length === 0 ? (
        <EmptyState
          title="Nothing waiting for release"
          hint="Records appear here between the repair and the quality worker closing the Rework ID."
        />
      ) : (
        <div className="overflow-auto px-5 pb-5" style={{ maxHeight: 320 }}>
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-hairline">
                <th scope="col" className="py-2 pr-4 font-medium text-ink-muted">No.</th>
                <th scope="col" className="py-2 pr-4 font-medium text-ink-muted">CarID</th>
                <th scope="col" className="py-2 pr-4 font-medium text-ink-muted">Reworked</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium text-ink-muted">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {waiting.slice(0, 50).map(({ record, minutes }) => (
                <tr key={record.id} className="border-b border-hairline/60 last:border-0">
                  <td className="py-2 pr-4 font-medium text-ink tabular">{record.no}</td>
                  <td className="py-2 pr-4 text-ink-secondary">{record.carId || '—'}</td>
                  <td className="py-2 pr-4 text-ink-secondary tabular">
                    {shortDateTime(record.reworked as string)}
                  </td>
                  <td className="py-2 pr-4 text-right text-ink-secondary tabular">
                    {durationLive(minutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {waiting.length > 50 && (
            <p className="pt-2 text-[0.6875rem] text-ink-muted">
              Showing the 50 longest waits of {waiting.length}.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
