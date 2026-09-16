import { ModelComparison } from '@/components/charts/ModelComparison'
import { PeriodTrend } from '@/components/charts/PeriodTrend'
import { ChartCard } from '@/components/ui/ChartCard'
import { Reveal } from '@/components/ui/Reveal'
import { useFilteredRecords } from '@/hooks/useDashboardData'
import { avgDurationByPeriod, countsByModelOverPeriods, monthlyBuckets } from '@/lib/aggregate'
import { duration } from '@/lib/format'
import { modelsIn, weeklyBuckets } from '@/lib/metrics'
import { useFilters } from '@/store/useFilters'
import { useRecords } from '@/store/useRecords'
import { useMemo, useState } from 'react'
import clsx from 'clsx'

/** Site model code -> the project name people actually use. */
const PROJECT_NAMES: Record<string, string> = { MAM: 'MMA', MCM: 'MBEAM' }
const projectLabel = (model: string) => PROJECT_NAMES[model] ?? model

function PeriodToggle({
  period,
  onChange,
}: {
  period: 'week' | 'month'
  onChange: (p: 'week' | 'month') => void
}) {
  return (
    <div className="flex rounded-md border border-hairline p-0.5" role="group" aria-label="Period">
      {(['week', 'month'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={period === option}
          className={clsx(
            'rounded px-2 py-1 text-[0.6875rem] font-medium capitalize transition',
            period === option ? 'bg-ink/8 text-ink' : 'text-ink-muted hover:text-ink-secondary',
          )}
        >
          {option}ly
        </button>
      ))}
    </div>
  )
}

export function Trends() {
  const { records, hasDrilldown } = useFilteredRecords()
  const allRecords = useRecords((s) => s.records)
  const loading = useRecords((s) => s.loading)
  const clearDrilldown = useFilters((s) => s.clearDrilldown)

  const [qtyPeriod, setQtyPeriod] = useState<'week' | 'month'>('month')
  const [durPeriod, setDurPeriod] = useState<'week' | 'month'>('week')
  const [cmpPeriod, setCmpPeriod] = useState<'week' | 'month'>('week')

  // Colour key: every model ever seen, not just the filtered ones, so a model
  // filter can never repaint the survivor.
  const orderedModels = useMemo(() => modelsIn(allRecords), [allRecords])

  const months = useMemo(() => monthlyBuckets(records), [records])
  const weeks = useMemo(() => weeklyBuckets(records), [records])
  const qty = qtyPeriod === 'month'
    ? { labels: months.map((m) => m.label), values: months.map((m) => m.total) }
    : { labels: weeks.map((w) => w.week.replace(/^\d{4}-/, '')), values: weeks.map((w) => w.total) }

  const durations = useMemo(
    () => avgDurationByPeriod(records, durPeriod),
    [records, durPeriod],
  )

  const comparison = useMemo(
    () => countsByModelOverPeriods(records, orderedModels, cmpPeriod),
    [records, orderedModels, cmpPeriod],
  )

  const reset = hasDrilldown ? clearDrilldown : undefined

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Reveal index={0}>
          <ChartCard
            title="Reworked quantity"
            subtitle={`Volume per ${qtyPeriod}`}
            loading={loading}
            isEmpty={qty.labels.length === 0}
            emptyHint="No records in the current selection."
            onReset={reset}
            height={280}
            actions={<PeriodToggle period={qtyPeriod} onChange={setQtyPeriod} />}
            table={{
              columns: [
                { key: 'period', label: qtyPeriod === 'month' ? 'Month' : 'Week' },
                { key: 'qty', label: 'Records', numeric: true },
              ],
              rows: qty.labels.map((label, i) => [label, qty.values[i]]),
            }}
          >
            <PeriodTrend labels={qty.labels} values={qty.values} variant="bar" axisName="Records" />
          </ChartCard>
        </Reveal>

        <Reveal index={1}>
          <ChartCard
            title="Average rework time"
            subtitle={`Mean duration of closed reworks per ${durPeriod}`}
            loading={loading}
            isEmpty={durations.length === 0}
            emptyHint="No closed records in the current selection."
            onReset={reset}
            height={280}
            actions={<PeriodToggle period={durPeriod} onChange={setDurPeriod} />}
            table={{
              columns: [
                { key: 'period', label: durPeriod === 'month' ? 'Month' : 'Week' },
                { key: 'avg', label: 'Avg duration', numeric: true },
                { key: 'sample', label: 'Closed records', numeric: true },
              ],
              rows: durations.map((d) => [
                d.label,
                duration(d.avgDurationMinutes),
                d.sample,
              ]),
            }}
          >
            <PeriodTrend
              labels={durations.map((d) => d.label)}
              values={durations.map((d) => d.avgDurationMinutes)}
              variant="line"
              axisName="Minutes"
              format={(v) => duration(v)}
            />
          </ChartCard>
        </Reveal>
      </div>

      <Reveal index={2}>
        <ChartCard
          title="MMA vs MBEAM"
          subtitle={`Rework volume per ${cmpPeriod}, both programmes on one scale`}
          loading={loading}
          isEmpty={comparison.periods.length === 0 || comparison.series.length === 0}
          emptyHint="No records in the current selection."
          onReset={reset}
          height={300}
          actions={<PeriodToggle period={cmpPeriod} onChange={setCmpPeriod} />}
          table={{
            columns: [
              { key: 'period', label: cmpPeriod === 'month' ? 'Month' : 'Week' },
              ...comparison.series.map((s) => ({
                key: s.key,
                label: projectLabel(s.key),
                numeric: true,
              })),
            ],
            rows: comparison.periods.map((label, i) => [
              label,
              ...comparison.series.map((s) => s.values[i]),
            ]),
          }}
        >
          <ModelComparison
            data={comparison}
            orderedModels={orderedModels}
            labelFor={projectLabel}
            height={300}
          />
        </ChartCard>
      </Reveal>

      <p className="text-[0.6875rem] text-ink-muted">
        Average rework time counts closed records only — an open record’s clock is still
        running, so including it would drag the current period down and make the trend
        look like it is improving when the work simply hasn’t finished yet.
      </p>
    </div>
  )
}
