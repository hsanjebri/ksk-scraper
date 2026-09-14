import clsx from 'clsx'
import type { CSSProperties, ReactNode } from 'react'

export function Card({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <div className={clsx('card', className)}>{children}</div>
}

export function CardHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h3 className="text-[0.9375rem] leading-tight font-semibold text-ink">{title}</h3>
        {subtitle && <p className="mt-1 text-xs text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}

export function Skeleton({
  className,
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return <div className={clsx('skeleton rounded-md', className)} style={style} />
}

/** Chart-shaped loading placeholder: a few bars of varying height. */
export function ChartSkeleton({ height = 260 }: { height?: number }) {
  const heights = [45, 70, 55, 85, 60, 95, 50, 75]
  return (
    <div className="flex items-end gap-3 px-5 pb-5" style={{ height }} aria-hidden>
      {heights.map((h, i) => (
        <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
      ))}
    </div>
  )
}

export function EmptyState({
  title = 'No data for this selection',
  hint,
  onReset,
}: {
  title?: string
  hint?: string
  onReset?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-ink/5">
        <svg viewBox="0 0 24 24" className="size-5 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 3v18h18" strokeLinecap="round" />
          <path d="M7 15l3-3 3 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs text-ink-muted">{hint}</p>}
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="mt-3 rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-ink/5"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'warning' | 'critical'
}) {
  const tones = {
    neutral: 'bg-ink/6 text-ink-secondary',
    good: 'bg-good/12 text-success-text',
    warning: 'bg-warning/18 text-ink',
    critical: 'bg-critical/12 text-critical',
  } as const
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

/**
 * Small toggle used for the chart/table view switch. The table view is not a
 * nicety — the light-mode palette sits below 3:1 contrast on three series
 * slots, and a table view is the required relief so no value is color-gated.
 */
export function ViewToggle({
  view,
  onChange,
}: {
  view: 'chart' | 'table'
  onChange: (view: 'chart' | 'table') => void
}) {
  return (
    <div className="flex rounded-md border border-hairline p-0.5" role="group" aria-label="View mode">
      {(['chart', 'table'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={view === option}
          className={clsx(
            'rounded px-2 py-1 text-[0.6875rem] font-medium capitalize transition',
            view === option
              ? 'bg-ink/8 text-ink'
              : 'text-ink-muted hover:text-ink-secondary',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )
}
