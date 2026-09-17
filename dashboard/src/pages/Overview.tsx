import { DefectsDonut } from '@/components/charts/DefectsDonut'
import { ReworkTrend } from '@/components/charts/ReworkTrend'
import { LiveReworkTable } from '@/components/overview/LiveReworkTable'
import { ChartCard } from '@/components/ui/ChartCard'
import { Reveal } from '@/components/ui/Reveal'
import { StatTile } from '@/components/ui/StatTile'
import { Card } from '@/components/ui/primitives'
import { useFilteredRecords } from '@/hooks/useDashboardData'
import { duration, percent, shortWeek } from '@/lib/format'
import {
  allErrorEntries,
  buildKpis,
  countBy,
  topNWithOther,
  weeklyBuckets,
  type Kpi,
} from '@/lib/metrics'
import { useFilters } from '@/store/useFilters'
import { useRecords } from '@/store/useRecords'
import { missesTarget, useTargets, type Targets } from '@/store/useTargets'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

/**
 * Target breaches, shown on the tile as an icon + label (never colour alone).
 * Targets are the ones set on the KPI page.
 */
function isBreached(kpi: Kpi, targets: Targets): boolean {
  if (kpi.key === 'reworkRate') return missesTarget(kpi.value, targets.reworkRatePct, false)
  if (kpi.key === 'fpy') return missesTarget(kpi.value, targets.firstPassYieldPct, true)
  if (kpi.key === 'leadTime') return missesTarget(kpi.value, targets.avgLeadTimeMinutes, false)
  return false
}

export function Overview() {
  const { records, hasDrilldown } = useFilteredRecords()
  const loading = useRecords((s) => s.loading)
  const error = useRecords((s) => s.error)
  const weeksToShow = useFilters((s) => s.weeks)
  const errorCode = useFilters((s) => s.errorCode)
  const toggleErrorCode = useFilters((s) => s.toggleErrorCode)
  const clearDrilldown = useFilters((s) => s.clearDrilldown)
  const targets = useTargets((s) => s.targets)

  const kpis = useMemo(() => buildKpis(records), [records])

  const weeks = useMemo(
    () => weeklyBuckets(records).slice(-weeksToShow),
    [records, weeksToShow],
  )

  const defectBuckets = useMemo(() => {
    const entries = allErrorEntries(records)
    return topNWithOther(countBy(entries, ({ entry }) => entry.code), 5)
  }, [records])

  if (error) {
    return (
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-critical">Couldn’t reach the API</h2>
        <p className="mt-1 text-xs text-ink-secondary">{error}</p>
        <p className="mt-3 text-xs text-ink-muted">
          Check the backend is running (<code className="rounded bg-ink/6 px-1.5 py-0.5">npm run start:prod</code>{' '}
          in the project root), then reload.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <section aria-label="Key performance indicators">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {kpis.map((kpi, index) => (
            <Reveal key={kpi.key} index={index}>
              <StatTile kpi={kpi} loading={loading} breached={isBreached(kpi, targets)} />
            </Reveal>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Reveal index={5} className="xl:col-span-3">
          <ChartCard
            title="Rework quantity & rate"
            subtitle={`Last ${weeks.length} weeks · quantity and rate on separate scales`}
            loading={loading}
            isEmpty={weeks.length === 0}
            emptyHint="No records fall inside the current filter."
            onReset={hasDrilldown ? clearDrilldown : undefined}
            height={300}
            table={{
              columns: [
                { key: 'week', label: 'Week' },
                { key: 'total', label: 'Quantity', numeric: true },
                { key: 'rate', label: 'Rate (est.)', numeric: true },
                { key: 'closed', label: 'Closed', numeric: true },
                { key: 'open', label: 'Open', numeric: true },
              ],
              rows: weeks.map((w) => [
                shortWeek(w.week),
                w.total,
                percent(w.reworkRatePct),
                w.closed,
                w.open,
              ]),
            }}
          >
            <ReworkTrend weeks={weeks} />
          </ChartCard>
        </Reveal>

        <Reveal index={6} className="xl:col-span-2">
          <ChartCard
            title="Defects by error code"
            subtitle="Top 5 codes · remainder folded into Other"
            loading={loading}
            isEmpty={defectBuckets.length === 0}
            emptyHint="No defect entries in the current selection."
            onReset={hasDrilldown ? clearDrilldown : undefined}
            height={300}
            table={{
              columns: [
                { key: 'code', label: 'Error code' },
                { key: 'count', label: 'Defects', numeric: true },
                { key: 'share', label: 'Share', numeric: true },
              ],
              rows: (() => {
                const total = defectBuckets.reduce((sum, b) => sum + b.value, 0) || 1
                return defectBuckets.map((b) => [
                  b.label,
                  b.value,
                  percent((b.value / total) * 100),
                ])
              })(),
            }}
          >
            <DefectsDonut
              buckets={defectBuckets}
              activeKey={errorCode}
              onSelect={toggleErrorCode}
            />
          </ChartCard>
        </Reveal>
      </div>

      <Reveal index={7}>
        <LiveReworkTable records={records} loading={loading} />
      </Reveal>

      <p className="text-[0.6875rem] text-ink-muted">
        Avg lead time target{' '}
        {targets.avgLeadTimeMinutes === null ? 'not set' : duration(targets.avgLeadTimeMinutes)} ·
        rework rate target{' '}
        {targets.reworkRatePct === null ? 'not set' : `≤ ${percent(targets.reworkRatePct)}`} · FPY
        target{' '}
        {targets.firstPassYieldPct === null ? 'not set' : `≥ ${percent(targets.firstPassYieldPct)}`}{' '}
        (
        <Link to="/kpi" className="underline underline-offset-2 hover:text-ink">
          edit targets
        </Link>
        ). Metrics marked{' '}
        <span className="rounded bg-ink/6 px-1 py-0.5 font-medium">est.</span> are computed
        against an assumed production volume — swap in a real production feed before
        reporting them.
      </p>
    </div>
  )
}
