import { DurationHistogram } from '@/components/charts/DurationHistogram'
import { ShiftComparison } from '@/components/charts/ShiftComparison'
import { StatusOverTime } from '@/components/charts/StatusOverTime'
import { TeamPerformance } from '@/components/charts/TeamPerformance'
import { ChartCard } from '@/components/ui/ChartCard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { Reveal } from '@/components/ui/Reveal'
import { useFilteredRecords } from '@/hooks/useDashboardData'
import { durationHistogram, shiftComparison, statusByWeek, teamPerformance } from '@/lib/analysis'
import { duration, percent, shortWeek } from '@/lib/format'
import { modelsIn } from '@/lib/metrics'
import { useFilters } from '@/store/useFilters'
import { useRecords } from '@/store/useRecords'
import { useMemo } from 'react'

export function ReworkAnalysis() {
  const { records, hasDrilldown } = useFilteredRecords()
  const loading = useRecords((s) => s.loading)
  const shift = useFilters((s) => s.shift)
  const toggleShift = useFilters((s) => s.toggleShift)
  const clearDrilldown = useFilters((s) => s.clearDrilldown)

  const models = useMemo(() => modelsIn(records), [records])
  const bins = useMemo(() => durationHistogram(records, models), [records, models])
  const statusWeeks = useMemo(() => statusByWeek(records), [records])
  const shifts = useMemo(() => shiftComparison(records), [records])
  const teams = useMemo(() => teamPerformance(records), [records])

  /**
   * Share of defects caught on the shift that caused them. Comparing total
   * "caused" against total "detected" would always be 100% — every record has
   * both fields — so the real question is whether they MATCH per record.
   */
  const sameShiftPct = useMemo(() => {
    const withBoth = records.filter((r) => r.defectShift && r.detectShift)
    if (withBoth.length === 0) return null
    const same = withBoth.filter((r) => r.defectShift === r.detectShift).length
    return (same / withBoth.length) * 100
  }, [records])

  const reset = hasDrilldown ? clearDrilldown : undefined

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Reveal index={0}>
        <ChartCard
          title="Rework duration distribution"
          subtitle="How long closed repairs actually take, by model"
          loading={loading}
          isEmpty={bins.every((b) => b.total === 0)}
          emptyHint="No closed records in the current selection."
          onReset={reset}
          height={280}
          table={{
            columns: [
              { key: 'bin', label: 'Duration' },
              ...models.map((m) => ({ key: m, label: m, numeric: true })),
              { key: 'total', label: 'Total', numeric: true },
            ],
            rows: bins.map((bin) => [
              bin.label,
              ...models.map((m) => bin.countByModel[m] ?? 0),
              bin.total,
            ]),
          }}
        >
          <DurationHistogram bins={bins} models={models} />
        </ChartCard>
      </Reveal>

      <Reveal index={1}>
        <ChartCard
          title="Status over time"
          subtitle="En cours vs Terminé per week"
          loading={loading}
          isEmpty={statusWeeks.length === 0}
          emptyHint="No records in the current selection."
          onReset={reset}
          height={280}
          table={{
            columns: [
              { key: 'week', label: 'Week' },
              { key: 'closed', label: 'Terminé', numeric: true },
              { key: 'open', label: 'En cours', numeric: true },
              { key: 'total', label: 'Total', numeric: true },
            ],
            rows: statusWeeks.map((w) => [
              shortWeek(w.week),
              w.closed,
              w.open,
              w.closed + w.open,
            ]),
          }}
        >
          <StatusOverTime weeks={statusWeeks} />
        </ChartCard>
      </Reveal>

      <Reveal index={2}>
        <ChartCard
          title="Shift comparison"
          subtitle="Where defects are caused vs where they're caught"
          loading={loading}
          isEmpty={shifts.length === 0}
          emptyHint="No shift data in the current selection."
          onReset={reset}
          height={280}
          table={{
            columns: [
              { key: 'shift', label: 'Shift' },
              { key: 'defect', label: 'Caused', numeric: true },
              { key: 'detect', label: 'Detected', numeric: true },
              { key: 'avg', label: 'Avg duration', numeric: true },
            ],
            rows: shifts.map((row) => [
              `Shift ${row.shift}`,
              row.defect,
              row.detect,
              Number.isFinite(row.avgDurationMinutes) ? duration(row.avgDurationMinutes) : '—',
            ]),
          }}
        >
          <ShiftComparison rows={shifts} activeShift={shift} onSelect={toggleShift} />
        </ChartCard>
      </Reveal>

      <Reveal index={3}>
        <Card className="card-lift flex flex-col">
          <CardHeader
            title="Recorded by"
            subtitle="Volume and speed per person recording the defect · click a header to sort"
          />
          {loading ? (
            <div className="px-5 pb-5 text-xs text-ink-muted">Loading…</div>
          ) : teams.length === 0 ? (
            <div className="px-5 pb-5 text-xs text-ink-muted">
              No “defect by” values in the current selection.
            </div>
          ) : (
            <TeamPerformance rows={teams} />
          )}
          <p className="px-5 pb-4 text-[0.6875rem] text-ink-muted">
            This is who <em>recorded</em> the defect, not who caused it — the source field
            doesn’t support reading it as individual performance.
          </p>
        </Card>
      </Reveal>

      <div className="xl:col-span-2">
        <p className="text-[0.6875rem] text-ink-muted">
          Open records are excluded from duration statistics — their clock is still
          running, so binning them would place them in a range they may not end up in.
          {sameShiftPct !== null && (
            <>
              {' '}
              {percent(sameShiftPct, 0)} of defects were caught on the same shift that
              caused them — the rest escaped to a later shift.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
