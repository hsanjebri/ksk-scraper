import { useVizTokens } from '@/hooks/useDashboardData'
import type { ComparisonSeries } from '@/lib/aggregate'
import { baseTooltip, categoryAxis, tooltipRows, valueAxis } from '@/lib/chart-base'
import { EChart } from '@/lib/echarts'
import { colorForKey } from '@/lib/viz-tokens'
import { useMemo } from 'react'
import { LegendKey } from './LegendKey'

/**
 * The two programmes side by side over time.
 *
 * Colour is looked up by MODEL NAME against a stable ordered list, never by
 * the series' position in the array. If it were positional, filtering one
 * model out would repaint the survivor — and a reader who learned "MMA is
 * blue" would be quietly misled.
 */
export function ModelComparison({
  data,
  orderedModels,
  labelFor,
  height = 280,
}: {
  data: ComparisonSeries
  /** Stable model order — the colour key, independent of what's displayed. */
  orderedModels: string[]
  labelFor?: (model: string) => string
  height?: number
}) {
  const tokens = useVizTokens()
  const label = labelFor ?? ((m: string) => m)

  const option = useMemo(
    () => ({
      backgroundColor: 'transparent',
      animationDuration: 600,
      animationEasing: 'cubicOut' as const,
      tooltip: {
        ...baseTooltip(tokens, 'axis'),
        axisPointer: { type: 'line' as const, lineStyle: { color: tokens.baseline, width: 1 } },
        formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
          const total = params.reduce((sum, p) => sum + p.value, 0)
          return tooltipRows(tokens, params[0]?.axisValue ?? '', [
            ...params.map((p) => ({
              label: p.seriesName,
              value: String(p.value),
              color: p.color,
            })),
            { label: 'Total', value: String(total) },
          ])
        },
      },
      grid: { left: 52, right: 24, top: 24, bottom: 34 },
      xAxis: categoryAxis(tokens, data.periods, data.periods.length > 10 ? 35 : 0),
      yAxis: valueAxis(tokens, 'Records'),
      series: data.series.map((s) => {
        const color = colorForKey(s.key, orderedModels, tokens)
        return {
          name: label(s.key),
          type: 'line',
          data: s.values,
          smooth: false,
          symbol: 'circle',
          symbolSize: 8,
          showSymbol: data.periods.length <= 16,
          lineStyle: { width: 2, color },
          itemStyle: { color, borderColor: tokens.surface, borderWidth: 2 },
          emphasis: { focus: 'series' as const },
        }
      }),
    }),
    [data, orderedModels, label, tokens],
  )

  return (
    <div>
      <EChart option={option} style={{ height }} />
      <div className="flex flex-wrap items-center gap-4 px-3 pb-1">
        {data.series.map((s) => (
          <LegendKey
            key={s.key}
            color={colorForKey(s.key, orderedModels, tokens)}
            shape="line"
            label={label(s.key)}
          />
        ))}
      </div>
    </div>
  )
}
