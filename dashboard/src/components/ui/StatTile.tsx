import { useVizTokens } from '@/hooks/useDashboardData'
import { useCountUp } from '@/hooks/useMotion'
import { compactNumber, duration, percent } from '@/lib/format'
import type { Kpi } from '@/lib/metrics'
import clsx from 'clsx'
import { Card, Skeleton } from './primitives'

function formatValue(value: number, unit: Kpi['unit']): string {
  if (!Number.isFinite(value)) return '—'
  if (unit === 'percent') return percent(value)
  if (unit === 'minutes') return duration(value)
  return compactNumber(value)
}

/**
 * Sparkline drawn as an inline SVG rather than a chart library — it's a
 * 12-point trend cue, not a readable plot, so it carries no axes, no labels
 * and no tooltip. The value and the delta beside it are the readable channel.
 */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 88
  const height = 28
  const clean = values.filter(Number.isFinite)
  if (clean.length < 2) return <div style={{ width, height }} />

  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const span = max - min || 1
  const step = width / (clean.length - 1)

  const points = clean.map((value, index) => {
    const x = index * step
    const y = height - 2 - ((value - min) / span) * (height - 4)
    return [x, y] as const
  })

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const last = points.at(-1)!

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
    </svg>
  )
}

function DeltaChip({ kpi }: { kpi: Kpi }) {
  if (kpi.deltaPct === null || !Number.isFinite(kpi.deltaPct)) {
    return <span className="text-[0.6875rem] text-ink-muted">no prior week</span>
  }

  const rising = kpi.deltaPct > 0
  const isGood = rising === kpi.higherIsBetter
  const magnitude = Math.abs(kpi.deltaPct)

  // Direction is carried by the arrow glyph and the sign, not by colour alone.
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap text-[0.6875rem] font-medium tabular',
        isGood ? 'text-success-text' : 'text-critical',
      )}
      title={`${rising ? 'Up' : 'Down'} ${magnitude.toFixed(1)}% vs the previous complete week`}
    >
      <span aria-hidden>{rising ? '▲' : '▼'}</span>
      {/* Huge swings are real but unreadable as "1750.0%" — cap the display
          and let the title carry the exact figure. */}
      {magnitude >= 1000 ? '>999' : magnitude.toFixed(1)}%
      <span className="font-normal text-ink-muted">vs last wk</span>
    </span>
  )
}

export function StatTile({
  kpi,
  loading,
  breached,
}: {
  kpi: Kpi
  loading?: boolean
  /** Target threshold exceeded — shown with an icon + label, never colour alone. */
  breached?: boolean
}) {
  const tokens = useVizTokens()
  // Animates on mount and whenever live data moves the number — small ticks
  // are ignored inside the hook so the row doesn't twitch constantly.
  const animated = useCountUp(kpi.value)

  if (loading) {
    return (
      <Card className="card-lift h-full p-5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-4 h-8 w-24" />
        <Skeleton className="mt-4 h-3 w-32" />
      </Card>
    )
  }

  return (
    // h-full keeps the row even when only some tiles carry a threshold note.
    <Card className="card-interactive card-lift flex h-full flex-col justify-between p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink-secondary">{kpi.label}</p>
        {kpi.assumed && (
          <span
            className="shrink-0 rounded bg-ink/6 px-1.5 py-0.5 text-[0.625rem] font-medium text-ink-muted"
            title="Estimated against an assumed production volume — not a measured rate. See lib/config.ts."
          >
            est.
          </span>
        )}
      </div>

      <div className="mt-3">
        {/* Proportional figures on purpose — tabular-nums makes large
            standalone numbers look loose. */}
        <p className="text-[1.75rem] leading-none font-semibold tracking-tight whitespace-nowrap text-ink">
          {formatValue(animated, kpi.unit)}
        </p>
        {/* Delta and sparkline sit on their own row so a long value (e.g.
            "18h 12m") can never squeeze either one into truncation. */}
        <div className="mt-2.5 flex items-end justify-between gap-2">
          <DeltaChip kpi={kpi} />
          <Sparkline values={kpi.spark} color={tokens.series[0]} />
        </div>
      </div>

      {breached && (
        <p className="mt-3 flex items-center gap-1.5 border-t border-hairline pt-2.5 text-[0.6875rem] font-medium text-critical">
          <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor" aria-hidden>
            <path d="M8 1.5 15 14H1L8 1.5Zm0 4.2a.7.7 0 0 0-.7.75l.2 3.1a.5.5 0 0 0 1 0l.2-3.1A.7.7 0 0 0 8 5.7Zm0 5.3a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
          </svg>
          Outside target threshold
        </p>
      )}
    </Card>
  )
}
