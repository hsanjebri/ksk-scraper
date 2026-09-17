import { TargetTrend } from '@/components/charts/TargetTrend'
import { ChartCard } from '@/components/ui/ChartCard'
import { Reveal } from '@/components/ui/Reveal'
import { Card, Skeleton } from '@/components/ui/primitives'
import { useFilteredRecords } from '@/hooks/useDashboardData'
import { ASSUMED_UNITS_PRODUCED_PER_DAY } from '@/lib/config'
import { duration, percent, shortWeek } from '@/lib/format'
import { anomalyIndices, completeWeeks, weeklyBuckets, type WeekBucket } from '@/lib/metrics'
import { useFilters } from '@/store/useFilters'
import { useRecords } from '@/store/useRecords'
import { missesTarget, useTargets, type TargetKey } from '@/store/useTargets'
import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'

interface KpiDef {
  key: TargetKey
  label: string
  /** Label of the plotted series and table column. */
  seriesLabel: string
  pick: (week: WeekBucket) => number
  higherIsBetter: boolean
  assumed: boolean
  unit: string
  step: number
  format: (value: number) => string
  variant: 'bar' | 'line'
  ceiling?: number
  explain: string
}

// Module-level formatters: TargetTrend memoises on them.
const formatCount = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—')
const formatPct = (v: number) => percent(v, 2)
const formatMinutes = (v: number) => duration(v)

const KPIS: KpiDef[] = [
  {
    key: 'weeklyReworkQty',
    label: 'Weekly rework quantity',
    seriesLabel: 'Reworks',
    pick: (w) => w.total,
    higherIsBetter: false,
    assumed: false,
    unit: 'per week',
    step: 1,
    format: formatCount,
    variant: 'bar',
    explain: 'Records registered in the week. Measured directly from the rework site.',
  },
  {
    key: 'avgLeadTimeMinutes',
    label: 'Avg rework lead time',
    seriesLabel: 'Avg lead time',
    pick: (w) => w.avgDurationMinutes,
    higherIsBetter: false,
    assumed: false,
    unit: 'minutes',
    step: 5,
    format: formatMinutes,
    variant: 'line',
    explain: 'Registered → reworked, closed records only. An open record’s clock is still running.',
  },
  {
    key: 'reworkRatePct',
    label: 'Rework rate',
    seriesLabel: 'Rework rate',
    pick: (w) => w.reworkRatePct,
    higherIsBetter: false,
    assumed: true,
    unit: '%',
    step: 0.1,
    format: formatPct,
    variant: 'line',
    ceiling: 100,
    explain: `Reworks ÷ produced units. Production is assumed at ${ASSUMED_UNITS_PRODUCED_PER_DAY}/day until a real feed exists.`,
  },
  {
    key: 'firstPassYieldPct',
    label: 'First pass yield',
    seriesLabel: 'FPY',
    pick: (w) => w.firstPassYieldPct,
    higherIsBetter: true,
    assumed: true,
    unit: '%',
    step: 0.1,
    format: formatPct,
    variant: 'line',
    ceiling: 100,
    explain: `100% − rework rate, so it shares the assumed ${ASSUMED_UNITS_PRODUCED_PER_DAY} units/day.`,
  },
]

/**
 * Number field that commits on blur or Enter, so typing "2." on the way to
 * "2.5" never flashes every chart red for a moment. Empty clears the target.
 */
function TargetInput({
  value,
  onCommit,
  step,
  unit,
  label,
  max,
}: {
  value: number | null
  onCommit: (value: number | null) => void
  step: number
  unit: string
  label: string
  max?: number
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  useEffect(() => setDraft(value === null ? '' : String(value)), [value])

  const commit = () => {
    const trimmed = draft.trim().replace(',', '.')
    if (trimmed === '') return onCommit(null)
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0 || (max !== undefined && parsed > max)) {
      setDraft(value === null ? '' : String(value)) // reject, restore
      return
    }
    onCommit(parsed)
  }

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{label} target</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step={step}
        value={draft}
        placeholder="not set"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className="tabular w-24 rounded-md border border-hairline bg-plane px-2 py-1 text-right text-sm text-ink placeholder:text-ink-muted focus:border-s1 focus:outline-none"
      />
      <span className="text-xs text-ink-muted">{unit}</span>
    </label>
  )
}

function StatusPill({ state }: { state: 'on' | 'off' | 'none' | 'nodata' }) {
  const styles = {
    on: { text: 'On target', cls: 'bg-good/12 text-success-text', icon: 'M3.5 8.5l3 3 6-7' },
    off: { text: 'Off target', cls: 'bg-critical/12 text-critical', icon: 'M8 3v6m0 3.5v.5' },
    none: { text: 'No target', cls: 'bg-ink/6 text-ink-secondary', icon: 'M4 8h8' },
    nodata: { text: 'No complete week', cls: 'bg-ink/6 text-ink-secondary', icon: 'M4 8h8' },
  }[state]
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium', styles.cls)}>
      <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={styles.icon} />
      </svg>
      {styles.text}
    </span>
  )
}

function TargetCard({ def, weeks, loading }: { def: KpiDef; weeks: WeekBucket[]; loading: boolean }) {
  const target = useTargets((s) => s.targets[def.key])
  const setTarget = useTargets((s) => s.setTarget)

  if (loading) {
    return (
      <Card className="h-full p-5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-4 h-8 w-24" />
        <Skeleton className="mt-4 h-6 w-40" />
      </Card>
    )
  }

  const values = weeks.map(def.pick)
  const latest = values.at(-1)
  const hasLatest = latest !== undefined && Number.isFinite(latest)
  const state = !hasLatest
    ? 'nodata'
    : target === null
      ? 'none'
      : missesTarget(latest, target, def.higherIsBetter)
        ? 'off'
        : 'on'

  const measured = values.filter(Number.isFinite)
  const onTarget = target === null ? 0 : measured.filter((v) => !missesTarget(v, target, def.higherIsBetter)).length

  return (
    <Card className="card-lift flex h-full flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink-secondary">{def.label}</p>
        {def.assumed && (
          <span
            className="shrink-0 rounded bg-ink/6 px-1.5 py-0.5 text-[0.625rem] font-medium text-ink-muted"
            title="Estimated against an assumed production volume — not a measured rate."
          >
            est.
          </span>
        )}
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[1.625rem] leading-none font-semibold tracking-tight text-ink">
            {hasLatest ? def.format(latest) : '—'}
          </p>
          <p className="mt-1.5 text-[0.6875rem] text-ink-muted">last complete week</p>
        </div>
        <StatusPill state={state} />
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-secondary">{def.higherIsBetter ? 'Min' : 'Max'}</span>
          <TargetInput
            value={target}
            onCommit={(v) => setTarget(def.key, v)}
            step={def.step}
            unit={def.unit}
            label={def.label}
            max={def.ceiling}
          />
        </div>
        {target !== null && measured.length > 0 && (
          <span className="text-[0.6875rem] text-ink-muted tabular">
            {onTarget}/{measured.length} weeks on target
          </span>
        )}
      </div>
    </Card>
  )
}

export function Kpi() {
  const { records, hasDrilldown } = useFilteredRecords()
  const loading = useRecords((s) => s.loading)
  const weeksToShow = useFilters((s) => s.weeks)
  const setWeeks = useFilters((s) => s.setWeeks)
  const clearDrilldown = useFilters((s) => s.clearDrilldown)
  const targets = useTargets((s) => s.targets)
  const reset = useTargets((s) => s.reset)

  // Complete weeks only: a half-finished week always looks like an improvement
  // on quantity and a regression on nothing, which is not a signal.
  const weeks = useMemo(
    () => completeWeeks(weeklyBuckets(records)).slice(-weeksToShow),
    [records, weeksToShow],
  )
  const labels = useMemo(() => weeks.map((w) => shortWeek(w.week)), [weeks])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs text-ink-secondary">
          Set a target per indicator; every week is checked against it and the Overview tiles flag
          a miss. Targets are saved in this browser only.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-hairline p-0.5" role="group" aria-label="Weeks shown">
            {[8, 12, 26, 52].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setWeeks(n)}
                aria-pressed={weeksToShow === n}
                className={clsx(
                  'rounded px-2 py-1 text-[0.6875rem] font-medium transition',
                  weeksToShow === n ? 'bg-ink/8 text-ink' : 'text-ink-muted hover:text-ink-secondary',
                )}
              >
                {n}w
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-hairline px-2.5 py-1 text-[0.6875rem] font-medium text-ink-secondary transition hover:bg-ink/5"
          >
            Reset targets
          </button>
        </div>
      </div>

      <section aria-label="Targets" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((def, index) => (
          <Reveal key={def.key} index={index}>
            <TargetCard def={def} weeks={weeks} loading={loading} />
          </Reveal>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {KPIS.map((def, index) => {
          const values = weeks.map(def.pick)
          const target = targets[def.key]
          const anomalies = anomalyIndices(values)
          return (
            <Reveal key={def.key} index={index + 4}>
              <ChartCard
                title={`${def.label}${def.assumed ? ' (est.)' : ''}`}
                subtitle={def.explain}
                loading={loading}
                isEmpty={weeks.length === 0}
                emptyHint="No complete week in the current selection yet."
                onReset={hasDrilldown ? clearDrilldown : undefined}
                height={260}
                table={{
                  columns: [
                    { key: 'week', label: 'Week' },
                    { key: 'value', label: def.seriesLabel, numeric: true },
                    { key: 'target', label: 'Target', numeric: true },
                    { key: 'status', label: 'Status' },
                    { key: 'anomaly', label: 'Anomaly' },
                  ],
                  rows: weeks.map((w, i) => [
                    shortWeek(w.week),
                    Number.isFinite(values[i]) ? def.format(values[i]) : '—',
                    target === null ? '—' : `${def.higherIsBetter ? '≥' : '≤'} ${def.format(target)}`,
                    target === null || !Number.isFinite(values[i])
                      ? '—'
                      : missesTarget(values[i], target, def.higherIsBetter)
                        ? 'Off target'
                        : 'On target',
                    anomalies.has(i) ? '>2σ' : '',
                  ]),
                }}
              >
                <TargetTrend
                  labels={labels}
                  values={values}
                  target={target}
                  higherIsBetter={def.higherIsBetter}
                  variant={def.variant}
                  seriesLabel={def.seriesLabel}
                  format={def.format}
                  ceiling={def.ceiling}
                />
              </ChartCard>
            </Reveal>
          )
        })}
      </div>

      <p className="text-[0.6875rem] text-ink-muted">
        Anomalies are weeks more than two standard deviations from the mean of the weeks before
        them — independent of the target, so a sudden break from normal is visible even while it is
        still within target.
      </p>
    </div>
  )
}
