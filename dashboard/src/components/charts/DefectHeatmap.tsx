import { useVizTokens } from '@/hooks/useDashboardData'
import type { Heatmap } from '@/lib/aggregate'
import { baseTooltip, tooltipRows } from '@/lib/chart-base'
import { EChart } from '@/lib/echarts'
import { useTheme } from '@/store/useTheme'
import { useMemo } from 'react'

/**
 * When defects cluster: day of week x shift.
 *
 * Magnitude, so the encoding is a SEQUENTIAL single-hue ramp — not categorical
 * colours, which would imply the cells are different kinds of thing rather
 * than more or less of the same thing.
 *
 * The ramp is our validated palette, handed to a HIDDEN visualMap. ECharts'
 * heatmap refuses to render on category axes without a visualMap registered
 * (it throws "Heatmap must use with visualMap"), so the component is bundled
 * but its default UI is suppressed and the scale legend below is our own HTML
 * — readable, themed, and present even if the chart fails to draw.
 */
export function DefectHeatmap({ data, height = 260 }: { data: Heatmap; height?: number }) {
  const tokens = useVizTokens()
  const resolved = useTheme((s) => s.resolved)
  const ramp = tokens.sequential

  const option = useMemo(() => {
    const max = Math.max(1, data.max)

    /**
     * A label sitting inside a coloured fill is the one place text may leave
     * the ink tokens: it has to flip with the cell's luminance or it fails
     * contrast at one end of the ramp. Light mode darkens as values rise;
     * dark mode lightens — so the flip runs opposite ways.
     */
    const labelColor = (count: number): string => {
      const strong = count / max > 0.55
      if (resolved === 'dark') return strong ? '#0b0b0b' : tokens.ink
      return strong ? '#ffffff' : tokens.ink
    }

    return {
      backgroundColor: 'transparent',
      animationDuration: 500,
      tooltip: {
        ...baseTooltip(tokens, 'item'),
        formatter: (p: { data: { value: [number, number, number] } }) => {
          const [day, shift, count] = p.data.value
          return tooltipRows(tokens, `${data.days[day]} · ${data.shifts[shift]}`, [
            { label: 'Defects', value: String(count) },
            {
              label: 'Share',
              value: data.total ? `${((count / data.total) * 100).toFixed(1)}%` : '—',
            },
          ])
        },
      },
      grid: { left: 8, right: 8, top: 10, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: data.days,
        splitArea: { show: false },
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: tokens.inkMuted, fontSize: 11 },
      },
      yAxis: {
        type: 'category' as const,
        data: data.shifts,
        splitArea: { show: false },
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: tokens.inkSecondary, fontSize: 11 },
      },
      visualMap: {
        show: false, // our own HTML legend renders below
        type: 'continuous' as const,
        min: 0,
        max,
        inRange: { color: ramp },
      },
      series: [
        {
          type: 'heatmap',
          data: data.cells.map(([day, shift, count]) => ({
            value: [day, shift, count],
            label: { color: labelColor(count) },
          })),
          // 2px surface gap does the separating — never a stroke on the mark.
          itemStyle: { borderColor: tokens.surface, borderWidth: 2, borderRadius: 4 },
          label: {
            show: true,
            fontSize: 11,
            formatter: (p: { data: { value: [number, number, number] } }) =>
              p.data.value[2] === 0 ? '' : String(p.data.value[2]),
          },
          emphasis: { itemStyle: { borderColor: tokens.ink, borderWidth: 2 } },
        },
      ],
    }
  }, [data, tokens, ramp, resolved])

  return (
    <div>
      <EChart option={option} style={{ height }} />
      {/* A sequential encoding is unreadable without a scale. */}
      <div className="flex items-center gap-2 px-3 pb-1">
        <span className="tabular text-[0.6875rem] text-ink-muted">0</span>
        <span className="flex h-2 flex-1 overflow-hidden rounded-full" aria-hidden>
          {ramp.map((c) => (
            <span key={c} className="flex-1" style={{ backgroundColor: c }} />
          ))}
        </span>
        <span className="tabular text-[0.6875rem] text-ink-muted">{data.max}</span>
        <span className="ml-1 text-[0.6875rem] text-ink-muted">defects per cell</span>
      </div>
    </div>
  )
}
