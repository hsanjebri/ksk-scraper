/**
 * Shared legend swatch. Lives in its own module rather than inside one chart
 * so charts don't import UI primitives from each other — a legend is a shared
 * piece of chart anatomy, not something ReworkTrend owns.
 *
 * A legend is always present for two or more series: colour alone is never the
 * only identity channel.
 */
export function LegendKey({
  color,
  label,
  shape = 'bar',
}: {
  color: string
  label: string
  shape?: 'bar' | 'line' | 'dot'
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.6875rem] text-ink-secondary">
      <span
        aria-hidden
        className={
          shape === 'line'
            ? 'inline-block h-0.5 w-3.5 rounded-full'
            : 'inline-block size-2.5 rounded-sm'
        }
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}
