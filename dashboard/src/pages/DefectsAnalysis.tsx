import { DefectHeatmap } from '@/components/charts/DefectHeatmap'
import { ErrorCodeTable } from '@/components/charts/ErrorCodeTable'
import { HorizontalBar } from '@/components/charts/HorizontalBar'
import { ChartCard } from '@/components/ui/ChartCard'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { Reveal } from '@/components/ui/Reveal'
import { useFilteredRecords } from '@/hooks/useDashboardData'
import {
  defectHeatmap,
  errorCodeFrequency,
  partTypeCounts,
  qualityGateCounts,
} from '@/lib/aggregate'
import { percent } from '@/lib/format'
import { useFilters } from '@/store/useFilters'
import { useRecords } from '@/store/useRecords'
import { useMemo } from 'react'

export function DefectsAnalysis() {
  const { records, hasDrilldown } = useFilteredRecords()
  const loading = useRecords((s) => s.loading)
  const errorCode = useFilters((s) => s.errorCode)
  const toggleErrorCode = useFilters((s) => s.toggleErrorCode)
  const partType = useFilters((s) => s.partType)
  const togglePartType = useFilters((s) => s.togglePartType)
  const clearDrilldown = useFilters((s) => s.clearDrilldown)

  const codes = useMemo(() => errorCodeFrequency(records), [records])
  const parts = useMemo(() => partTypeCounts(records), [records])
  const gates = useMemo(() => qualityGateCounts(records), [records])
  const heat = useMemo(() => defectHeatmap(records), [records])

  const reset = hasDrilldown ? clearDrilldown : undefined
  const busiest = useMemo(
    () => [...heat.cells].sort((a, b) => b[2] - a[2])[0],
    [heat],
  )

  return (
    <div className="space-y-5">
      <Reveal index={0}>
        <Card className="card-lift flex flex-col">
          <CardHeader
            title="Error code frequency"
            subtitle="Search, sort, and click a row to filter the page"
          />
          {loading ? (
            <div className="px-5 pb-5 text-xs text-ink-muted">Loading…</div>
          ) : codes.length === 0 ? (
            <EmptyState
              hint="No defect entries in the current selection."
              onReset={reset}
            />
          ) : (
            <ErrorCodeTable rows={codes} activeCode={errorCode} onSelect={toggleErrorCode} />
          )}
        </Card>
      </Reveal>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Reveal index={1}>
          <ChartCard
            title="Part type breakdown"
            subtitle="Which kinds of part fail most · click to filter"
            loading={loading}
            isEmpty={parts.length === 0}
            emptyHint="No part types in the current selection."
            onReset={reset}
            height={280}
            table={{
              columns: [
                { key: 'part', label: 'Part type' },
                { key: 'count', label: 'Records', numeric: true },
              ],
              rows: parts.map((p) => [p.label, p.value]),
            }}
          >
            <HorizontalBar
              buckets={parts}
              activeKey={partType}
              onSelect={togglePartType}
            />
          </ChartCard>
        </Reveal>

        <Reveal index={2}>
          <ChartCard
            title="Reworked from — quality gate"
            subtitle="Where the defect was caught"
            loading={loading}
            isEmpty={gates.length === 0}
            emptyHint="Quality gate is only captured by the live scraper — it stays empty on mock and demo data until SCRAPER_MODE=live."
            onReset={reset}
            height={280}
            table={{
              columns: [
                { key: 'gate', label: 'Quality gate' },
                { key: 'count', label: 'Records', numeric: true },
              ],
              rows: gates.map((g) => [g.label, g.value]),
            }}
          >
            <HorizontalBar buckets={gates} />
          </ChartCard>
        </Reveal>
      </div>

      <Reveal index={3}>
        <ChartCard
          title="Defect heatmap"
          subtitle="Day of week × shift — when defects cluster"
          loading={loading}
          isEmpty={heat.total === 0}
          emptyHint="No records carry both a date and a defect shift in this selection."
          onReset={reset}
          height={260}
          table={{
            columns: [
              { key: 'day', label: 'Day' },
              ...heat.shifts.map((s) => ({ key: s, label: s, numeric: true })),
            ],
            rows: heat.days.map((day, dayIndex) => [
              day,
              ...heat.shifts.map(
                (_, shiftIndex) =>
                  heat.cells.find(([d, s]) => d === dayIndex && s === shiftIndex)?.[2] ?? 0,
              ),
            ]),
          }}
        >
          <DefectHeatmap data={heat} />
        </ChartCard>
      </Reveal>

      {!loading && busiest && busiest[2] > 0 && (
        <p className="text-[0.6875rem] text-ink-muted">
          Busiest slot: {heat.days[busiest[0]]} on {heat.shifts[busiest[1]]} with{' '}
          {busiest[2]} defects ({percent((busiest[2] / heat.total) * 100, 0)} of the
          selection). Day is taken from the registration timestamp and the shift from
          “defect shift”, so records missing either are not plotted.
        </p>
      )}
    </div>
  )
}
