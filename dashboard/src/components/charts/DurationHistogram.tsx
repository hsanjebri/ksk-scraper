import { useVizTokens } from '@/hooks/useDashboardData'
import type { DurationBin } from '@/lib/analysis'
import {
  BAR_MAX_WIDTH,
  BAR_RADIUS_UP,
  baseTooltip,
  categoryAxis,
  seriesEntrance,
  tooltipRows,
  valueAxis,
} from '@/lib/chart-base'
import { EChart } from '@/lib/echarts'
import { useMemo } from 'react'
import { LegendKey } from './LegendKey'

/**
 * How long closed reworks actually take, binned and split by model.
 *
 * Grouped rather than stacked: the question is "does one model take longer
 * than the other", and a stack makes per-model shape impossible to compare
 * because only the bottom segment shares a baseline.
 */
export function DurationHistogram({
  bins,
  models,
}: {
  bins: DurationBin[]
  models: string[]
}) {
  const tokens = useVizTokens()

  const option = useMemo(() => {
    return {
      backgroundColor: 'transparent',
      ...seriesEntrance,
      tooltip: {
        ...baseTooltip(tokens, 'axis'),
        formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) =>
          tooltipRows(
            tokens,
            `${params[0]?.axisValue ?? ''} in rework`,
            params.map((p) => ({
              label: p.seriesName,
              value: `${p.value} records`,
              color: p.color,
            })),
          ),
      },
      grid: { left: 48, right: 20, top: 20, bottom: 34 },
      xAxis: categoryAxis(tokens, bins.map((b) => b.label)),
      yAxis: valueAxis(tokens, 'Records'),
      series: models.map((model, index) => ({
        name: model,
        type: 'bar',
        data: bins.map((bin) => bin.countByModel[model] ?? 0),
        barMaxWidth: BAR_MAX_WIDTH,
        barGap: '12%',
        itemStyle: {
          color: tokens.series[index % tokens.series.length],
          borderRadius: BAR_RADIUS_UP,
        },
        ...seriesEntrance,
      })),
    }
  }, [bins, models, tokens])

  return (
    <div>
      <EChart
        option={option}
        style={{ height: 280 }}
      />
      <div className="flex flex-wrap items-center gap-4 px-3 pb-1">
        {models.map((model, index) => (
          <LegendKey
            key={model}
            color={tokens.series[index % tokens.series.length]}
            label={model}
          />
        ))}
        <span className="text-[0.6875rem] text-ink-muted">Closed records only</span>
      </div>
    </div>
  )
}
