import { ParetoChart } from '@/components/charts/ParetoChart'
import { RankedTable } from '@/components/charts/RankedTable'
import { ChartCard } from '@/components/ui/ChartCard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { Reveal } from '@/components/ui/Reveal'
import { useFilteredRecords } from '@/hooks/useDashboardData'
import { paretoByErrorCode, topCars, topParts } from '@/lib/analysis'
import { percent } from '@/lib/format'
import { useFilters } from '@/store/useFilters'
import { useRecords } from '@/store/useRecords'
import { useMemo } from 'react'

export function Pareto() {
  const { records, hasDrilldown } = useFilteredRecords()
  const loading = useRecords((s) => s.loading)
  const errorCode = useFilters((s) => s.errorCode)
  const toggleErrorCode = useFilters((s) => s.toggleErrorCode)
  const clearDrilldown = useFilters((s) => s.clearDrilldown)

  // The Pareto is built from the model-scoped set rather than the drilled one:
  // filtering to a single code would collapse the chart to one bar and destroy
  // the ranking it exists to show. The active code is highlighted instead.
  const pareto = useMemo(() => paretoByErrorCode(records), [records])
  const parts = useMemo(() => topParts(records, 10), [records])
  const cars = useMemo(() => topCars(records, 10), [records])

  const reset = hasDrilldown ? clearDrilldown : undefined
  const repeats = cars.filter((c) => c.count > 1).length

  return (
    <div className="space-y-5">
      <Reveal index={0}>
        <ChartCard
          title="Pareto — defect codes by frequency"
          subtitle="Bars ranked by count, cumulative line, 80% threshold marked"
          loading={loading}
          isEmpty={pareto.length === 0}
          emptyHint="No defect entries in the current selection."
          onReset={reset}
          height={320}
          table={{
            columns: [
              { key: 'code', label: 'Code' },
              { key: 'description', label: 'Description' },
              { key: 'count', label: 'Count', numeric: true },
              { key: 'cumulative', label: 'Cumulative', numeric: true },
              { key: 'pct', label: 'Cumulative %', numeric: true },
            ],
            rows: pareto.map((row) => [
              row.code,
              row.description || '—',
              row.count,
              row.cumulative,
              percent(row.cumulativePct),
            ]),
          }}
        >
          <ParetoChart rows={pareto} activeCode={errorCode} onSelect={toggleErrorCode} />
        </ChartCard>
      </Reveal>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Reveal index={1}>
          <Card className="card-lift flex flex-col">
            <CardHeader
              // Heading reflects what's actually there — a "Top 10" showing
              // five rows looks like the page failed to load the rest.
              title={`Top ${parts.length} most reworked parts`}
              subtitle="Which parts come back most often"
            />
            {loading ? (
              <div className="px-5 pb-5 text-xs text-ink-muted">Loading…</div>
            ) : parts.length === 0 ? (
              <div className="px-5 pb-5 text-xs text-ink-muted">No parts in this selection.</div>
            ) : (
              <RankedTable rows={parts} keyLabel="Part name" secondaryLabel="Part type" />
            )}
          </Card>
        </Reveal>

        <Reveal index={2}>
          <Card className="card-lift flex flex-col">
            <CardHeader
              title={`Top ${cars.length} most reworked cars`}
              subtitle={
                repeats > 0
                  ? `${repeats} car${repeats === 1 ? '' : 's'} reworked more than once`
                  : 'No repeats yet — every car appears once'
              }
            />
            {loading ? (
              <div className="px-5 pb-5 text-xs text-ink-muted">Loading…</div>
            ) : cars.length === 0 ? (
              <div className="px-5 pb-5 text-xs text-ink-muted">No cars in this selection.</div>
            ) : (
              <RankedTable
                rows={cars}
                keyLabel="CarID"
                secondaryLabel="Model"
                repeatThreshold={2}
              />
            )}
            <p className="px-5 pb-4 text-[0.6875rem] text-ink-muted">
              A CarID appearing twice means the same physical car came back — usually the
              strongest signal that a root cause wasn’t actually fixed.
            </p>
          </Card>
        </Reveal>
      </div>
    </div>
  )
}
