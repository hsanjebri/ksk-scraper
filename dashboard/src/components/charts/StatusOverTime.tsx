import { useVizTokens } from '@/hooks/useDashboardData'
import type { StatusWeek } from '@/lib/analysis'
import { baseTooltip, categoryAxis, tooltipRows, valueAxis } from '@/lib/chart-base'
import { EChart } from '@/lib/echarts'
import { shortWeek } from '@/lib/format'
import { useMemo } from 'react'
import { LegendKey } from './LegendKey'

/**
 * En cours vs Terminé as a stacked area over time.
 *
 * Stacked is right here because the two states are parts of one whole (every
 * record is exactly one of them), so the stack top is a meaningful total.
 * Fills sit at ~18% so the boundary line carries the shape and the area reads
 * as a wash rather than a saturated block.
 */
export function StatusOverTime({ weeks }: { weeks: StatusWeek[] }) {
  const tokens = useVizTokens()

  const option = useMemo(() => {
    const labels = weeks.map((w) => shortWeek(w.week))

    const series = [
      { name: 'Terminé', values: weeks.map((w) => w.closed), color: tokens.series[2] },
      { name: 'En cours', values: weeks.map((w) => w.open), color: tokens.series[3] },
    ]

    return {
      backgroundColor: 'transparent',
      animationDuration: 600,
      animationEasing: 'cubicOut' as const,
      tooltip: {
        ...baseTooltip(tokens, 'axis'),
        axisPointer: { type: 'line' as const, lineStyle: { color: tokens.baseline, width: 1 } },
        formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
          const total = params.reduce((sum, p) => sum + p.value, 0)
          return tooltipRows(tokens, params[0]?.axisValue ?? '', [
            ...params.map((p) => ({ label: p.seriesName, value: String(p.value), color: p.color })),
            { label: 'Total', value: String(total) },
          ])
        },
      },
      grid: { left: 48, right: 20, top: 20, bottom: 34 },
      xAxis: categoryAxis(tokens, labels),
      yAxis: valueAxis(tokens, 'Records'),
      series: series.map((s) => ({
        name: s.name,
        type: 'line',
        stack: 'status',
        data: s.values,
        smooth: false,
        symbol: 'circle',
        symbolSize: 8,
        showSymbol: false,
        lineStyle: { width: 2, color: s.color },
        itemStyle: { color: s.color, borderColor: tokens.surface, borderWidth: 2 },
        areaStyle: { color: s.color, opacity: 0.18 },
        emphasis: { focus: 'series' as const },
      })),
    }
  }, [weeks, tokens])

  return (
    <div>
      <EChart
        option={option}
        style={{ height: 280 }}
      />
      <div className="flex flex-wrap items-center gap-4 px-3 pb-1">
        <LegendKey color={tokens.series[2]} label="Terminé" />
        <LegendKey color={tokens.series[3]} label="En cours" />
      </div>
    </div>
  )
}
