import { useVizTokens } from '@/hooks/useDashboardData'
import { shortWeek } from '@/lib/format'
import { EChart } from '@/lib/echarts'
import { anomalyIndices, type WeekBucket } from '@/lib/metrics'
import { LegendKey } from './LegendKey'

import { useMemo } from 'react'

/**
 * Rework quantity and rework rate over time.
 *
 * Deliberately NOT a dual-axis combo chart. Quantity (a count) and rate (a
 * percentage) have unrelated scales, and overlaying them on two y-axes invents
 * a visual correlation that isn't in the data — the single most misleading
 * chart pattern there is. Instead they're stacked as two panels sharing one
 * x-axis, so weeks still line up vertically and both remain individually
 * readable against their own honest scale.
 *
 * Weeks whose rate sits >2σ from the trailing mean get a ring marker and an
 * "anomaly" note, so a spike is called out rather than left to be spotted.
 */
export function ReworkTrend({ weeks }: { weeks: WeekBucket[] }) {
  const tokens = useVizTokens()

  const option = useMemo(() => {
    const labels = weeks.map((w) => shortWeek(w.week))
    const quantities = weeks.map((w) => w.total)
    const rates = weeks.map((w) => Number(w.reworkRatePct.toFixed(2)))
    const spikes = anomalyIndices(rates)

    return {
      backgroundColor: 'transparent',
      animationDuration: 420,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: tokens.baseline, width: 1 } },
        backgroundColor: tokens.tooltipBg,
        borderColor: tokens.tooltipBorder,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: tokens.ink, fontSize: 12 },
        formatter: (params: { axisValue: string; seriesName: string; value: number }[]) => {
          const header = `<div style="font-weight:600;margin-bottom:4px">${params[0]?.axisValue ?? ''}</div>`
          const lines = params
            .map((p) => {
              const suffix = p.seriesName.includes('rate') ? '%' : ''
              return `<div style="display:flex;gap:12px;justify-content:space-between">
                        <span style="color:${tokens.inkSecondary}">${p.seriesName}</span>
                        <strong>${p.value}${suffix}</strong>
                      </div>`
            })
            .join('')
          return header + lines
        },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 52, right: 20, top: 28, height: 120 },
        { left: 52, right: 20, top: 188, height: 86 },
      ],
      xAxis: [
        {
          type: 'category',
          data: labels,
          gridIndex: 0,
          axisLabel: { show: false },
          axisTick: { show: false },
          axisLine: { lineStyle: { color: tokens.baseline } },
        },
        {
          type: 'category',
          data: labels,
          gridIndex: 1,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: tokens.baseline } },
          axisLabel: { color: tokens.inkMuted, fontSize: 11 },
        },
      ],
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          name: 'Quantity',
          nameTextStyle: { color: tokens.inkMuted, fontSize: 11, align: 'left' },
          nameGap: 12,
          splitLine: { lineStyle: { color: tokens.grid, width: 1 } },
          axisLabel: { color: tokens.inkMuted, fontSize: 11 },
        },
        {
          type: 'value',
          gridIndex: 1,
          name: 'Rate %',
          nameTextStyle: { color: tokens.inkMuted, fontSize: 11, align: 'left' },
          nameGap: 12,
          splitLine: { lineStyle: { color: tokens.grid, width: 1 } },
          axisLabel: { color: tokens.inkMuted, fontSize: 11, formatter: '{value}%' },
        },
      ],
      series: [
        {
          name: 'Rework quantity',
          type: 'bar',
          data: quantities,
          xAxisIndex: 0,
          yAxisIndex: 0,
          barMaxWidth: 24,
          itemStyle: {
            color: tokens.series[0],
            // 4px rounded data-end, square at the baseline.
            borderRadius: [4, 4, 0, 0],
          },
          label: {
            show: true,
            position: 'top',
            color: tokens.inkSecondary,
            fontSize: 10,
            // Label the extremes only — a number on every bar is noise.
            formatter: (p: { value: number }) =>
              p.value === Math.max(...quantities) || p.value === Math.min(...quantities)
                ? String(p.value)
                : '',
          },
        },
        {
          name: 'Rework rate',
          type: 'line',
          data: rates,
          xAxisIndex: 1,
          yAxisIndex: 1,
          smooth: false,
          lineStyle: { width: 2, color: tokens.series[1] },
          itemStyle: { color: tokens.series[1] },
          symbol: 'circle',
          symbolSize: 8,
          areaStyle: { color: tokens.series[1], opacity: 0.1 },
          markPoint: {
            symbol: 'circle',
            symbolSize: 16,
            itemStyle: {
              color: 'transparent',
              borderColor: tokens.status.critical,
              borderWidth: 2,
            },
            label: { show: false },
            data: [...spikes].map((index) => ({
              coord: [labels[index], rates[index]],
              name: 'anomaly',
            })),
          },
        },
      ],
    }
  }, [weeks, tokens])

  const spikes = anomalyIndices(weeks.map((w) => Number(w.reworkRatePct.toFixed(2))))

  return (
    <div>
      <EChart
        option={option}
        style={{ height: 300 }}
      />
      <div className="flex flex-wrap items-center gap-4 px-3 pb-1">
        <LegendKey color={tokens.series[0]} shape="bar" label="Rework quantity" />
        <LegendKey color={tokens.series[1]} shape="line" label="Rework rate (est.)" />
        {spikes.size > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-medium text-critical">
            <span
              className="inline-block size-2.5 rounded-full border-2"
              style={{ borderColor: tokens.status.critical }}
              aria-hidden
            />
            {spikes.size} anomal{spikes.size === 1 ? 'y' : 'ies'} (&gt;2σ)
          </span>
        )}
      </div>
    </div>
  )
}

