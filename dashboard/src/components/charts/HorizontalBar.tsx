import { useVizTokens } from '@/hooks/useDashboardData'
import {
  BAR_MAX_WIDTH,
  BAR_RADIUS_RIGHT,
  baseTooltip,
  seriesEntrance,
  tooltipRows,
  valueAxis,
} from '@/lib/chart-base'
import { EChart } from '@/lib/echarts'
import type { Bucket } from '@/lib/metrics'
import { useMemo } from 'react'

/**
 * Ranked nominal categories — quality gates, part types.
 *
 * Every bar is the SAME hue. Shading bars darker-where-bigger is tempting and
 * wrong: the categories have no natural order, bar length already encodes the
 * magnitude, and a value ramp would spend the one free channel restating it.
 * Horizontal because the labels are words, not dates.
 */
export function HorizontalBar({
  buckets,
  valueLabel = 'Records',
  height = 280,
  activeKey,
  onSelect,
}: {
  buckets: Bucket[]
  valueLabel?: string
  height?: number
  activeKey?: string | null
  onSelect?: (key: string) => void
}) {
  const tokens = useVizTokens()

  const option = useMemo(() => {
    // Largest at the top: ECharts' y-axis category order runs bottom-up.
    const ordered = [...buckets].reverse()
    const total = buckets.reduce((sum, b) => sum + b.value, 0) || 1

    return {
      backgroundColor: 'transparent',
      ...seriesEntrance,
      tooltip: {
        ...baseTooltip(tokens, 'item'),
        formatter: (p: { name: string; value: number }) =>
          tooltipRows(tokens, p.name, [
            { label: valueLabel, value: String(p.value), color: tokens.series[0] },
            { label: 'Share', value: `${((p.value / total) * 100).toFixed(1)}%` },
          ]),
      },
      grid: { left: 8, right: 56, top: 8, bottom: 28, containLabel: true },
      xAxis: valueAxis(tokens, undefined),
      yAxis: {
        type: 'category' as const,
        data: ordered.map((b) => b.label),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: tokens.baseline } },
        axisLabel: { color: tokens.inkSecondary, fontSize: 11, width: 130, overflow: 'truncate' },
      },
      series: [
        {
          type: 'bar',
          data: ordered.map((b) => ({
            value: b.value,
            itemStyle: {
              color: b.key === '__other__' ? tokens.neutral : tokens.series[0],
              borderRadius: BAR_RADIUS_RIGHT,
              opacity: activeKey != null && activeKey !== b.key ? 0.35 : 1,
            },
          })),
          barMaxWidth: BAR_MAX_WIDTH,
          // Values sit outside the bar end, so a short bar never clips its label.
          label: {
            show: true,
            position: 'right' as const,
            color: tokens.inkSecondary,
            fontSize: 11,
          },
          ...seriesEntrance,
        },
      ],
    }
  }, [buckets, activeKey, tokens, valueLabel])

  const onEvents = useMemo(
    () =>
      onSelect
        ? {
            click: (params: { dataIndex: number }) => {
              const ordered = [...buckets].reverse()
              const bucket = ordered[params.dataIndex]
              if (bucket && bucket.key !== '__other__') onSelect(bucket.key)
            },
          }
        : undefined,
    [buckets, onSelect],
  )

  return <EChart option={option} style={{ height }} onEvents={onEvents} />
}
