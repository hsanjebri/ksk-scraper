import { useVizTokens } from '@/hooks/useDashboardData'
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

/**
 * A single measure over time — quantity per month, average rework time per
 * week, and so on.
 *
 * One series, so no legend: the card title already names what is plotted, and
 * a one-swatch legend box would just restate it. Only the extremes are
 * labelled; a number on every column is noise and goes unread.
 */
export function PeriodTrend({
  labels,
  values,
  variant = 'bar',
  axisName,
  format = (v: number) => String(v),
  height = 280,
}: {
  labels: string[]
  values: number[]
  variant?: 'bar' | 'line'
  axisName?: string
  format?: (value: number) => string
  height?: number
}) {
  const tokens = useVizTokens()

  const option = useMemo(() => {
    const finite = values.filter(Number.isFinite)
    const max = finite.length ? Math.max(...finite) : 0
    const min = finite.length ? Math.min(...finite) : 0

    const shared = {
      name: axisName ?? 'Value',
      data: values.map((v) => (Number.isFinite(v) ? Number(v.toFixed(2)) : 0)),
      ...seriesEntrance,
    }

    return {
      backgroundColor: 'transparent',
      ...seriesEntrance,
      tooltip: {
        ...baseTooltip(tokens, 'axis'),
        formatter: (params: { axisValue: string; value: number }[]) =>
          tooltipRows(tokens, params[0]?.axisValue ?? '', [
            {
              label: axisName ?? 'Value',
              value: format(params[0]?.value ?? 0),
              color: tokens.series[0],
            },
          ]),
      },
      grid: { left: 52, right: 24, top: 24, bottom: 34 },
      xAxis: categoryAxis(tokens, labels, labels.length > 10 ? 35 : 0),
      yAxis: valueAxis(tokens, axisName),
      series: [
        variant === 'bar'
          ? {
              ...shared,
              type: 'bar',
              barMaxWidth: BAR_MAX_WIDTH,
              itemStyle: { color: tokens.series[0], borderRadius: BAR_RADIUS_UP },
              label: {
                show: true,
                position: 'top' as const,
                color: tokens.inkSecondary,
                fontSize: 10,
                formatter: (p: { value: number }) =>
                  p.value === max || p.value === min ? format(p.value) : '',
              },
            }
          : {
              ...shared,
              type: 'line',
              smooth: false,
              symbol: 'circle',
              symbolSize: 8,
              lineStyle: { width: 2, color: tokens.series[0] },
              itemStyle: {
                color: tokens.series[0],
                borderColor: tokens.surface,
                borderWidth: 2,
              },
              areaStyle: { color: tokens.series[0], opacity: 0.1 },
            },
      ],
    }
  }, [labels, values, variant, axisName, format, tokens])

  return <EChart option={option} style={{ height }} />
}
