import { useVizTokens } from '@/hooks/useDashboardData'
import type { ParetoRow } from '@/lib/analysis'
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
import { percent } from '@/lib/format'
import { useMemo } from 'react'
import { LegendKey } from './LegendKey'

/**
 * Pareto: defect codes ranked by frequency, with a cumulative line and the
 * 80% threshold marked. The codes left of the crossing are where fixing
 * something removes most of the defects.
 *
 * ── Why this is NOT a dual-axis chart ──
 * The textbook Pareto puts counts on the left axis and cumulative % on the
 * right. Two y-axes on one plot normally invent a correlation that isn't in
 * the data, which is exactly the pattern to avoid.
 *
 * So the cumulative line is plotted as a running COUNT on the same axis as the
 * bars, and the 80% threshold is drawn as a horizontal marker at 80% of the
 * grand total — also a count. One axis, no arbitrary scale alignment, and the
 * chart still answers the Pareto question: read across to where the line
 * crosses the dashed 80% marker. Percentages live in the labels and tooltip,
 * where they need no scale of their own.
 */
export function ParetoChart({
  rows,
  activeCode,
  onSelect,
}: {
  rows: ParetoRow[]
  activeCode: string | null
  onSelect: (code: string) => void
}) {
  const tokens = useVizTokens()

  /** Codes needed to cover 80% of all defects — the "vital few". */
  const vitalFew = rows.findIndex((r) => r.cumulativePct >= 80) + 1

  const option = useMemo(() => {
    const labels = rows.map((r) => r.code)

    return {
      backgroundColor: 'transparent',
      ...seriesEntrance,
      tooltip: {
        ...baseTooltip(tokens, 'axis'),
        formatter: (params: { axisValue: string }[]) => {
          const row = rows.find((r) => r.code === params[0]?.axisValue)
          if (!row) return ''
          return tooltipRows(tokens, `${row.code} — ${row.description || 'no description'}`, [
            { label: 'Occurrences', value: String(row.count), color: tokens.series[0] },
            { label: 'Cumulative', value: String(row.cumulative), color: tokens.series[1] },
            { label: 'Cumulative share', value: percent(row.cumulativePct) },
          ])
        },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      // Two stacked panels sharing one x-axis. A single shared y-axis was tried
      // first and is unreadable: the cumulative total is an order of magnitude
      // above any individual bar, so every bar collapses to a sliver.
      grid: [
        { left: 52, right: 24, top: 22, height: 150 },
        { left: 52, right: 24, top: 208, height: 78 },
      ],
      xAxis: [
        {
          ...categoryAxis(tokens, labels),
          gridIndex: 0,
          axisLabel: { show: false },
        },
        {
          ...categoryAxis(tokens, labels, labels.length > 8 ? 35 : 0),
          gridIndex: 1,
        },
      ],
      yAxis: [
        valueAxis(tokens, 'Occurrences'),
        {
          ...valueAxis(tokens, 'Cumulative %', '{value}%'),
          gridIndex: 1,
          max: 100,
          min: 0,
          interval: 50,
        },
      ],
      series: [
        {
          name: 'Occurrences',
          type: 'bar',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: rows.map((row) => ({
            value: row.count,
            itemStyle: {
              color: tokens.series[0],
              borderRadius: BAR_RADIUS_UP,
              opacity: activeCode !== null && activeCode !== row.code ? 0.35 : 1,
            },
          })),
          barMaxWidth: BAR_MAX_WIDTH,
          label: {
            show: true,
            position: 'top' as const,
            color: tokens.inkSecondary,
            fontSize: 10,
          },
          ...seriesEntrance,
        },
        {
          name: 'Cumulative',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: rows.map((r) => Number(r.cumulativePct.toFixed(1))),
          smooth: false,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { width: 2, color: tokens.series[1] },
          itemStyle: { color: tokens.series[1], borderColor: tokens.surface, borderWidth: 2 },
          markLine: {
            silent: true,
            symbol: 'none',
            label: {
              formatter: '80%',
              position: 'insideEndTop' as const,
              color: tokens.inkSecondary,
              fontSize: 10,
            },
            lineStyle: { color: tokens.status.critical, width: 1.5, type: 'dashed' as const },
            data: [{ yAxis: 80 }],
          },
          ...seriesEntrance,
        },
      ],
    }
  }, [rows, activeCode, tokens])

  const onEvents = useMemo(
    () => ({
      click: (params: { dataIndex: number }) => {
        const row = rows[params.dataIndex]
        if (row) onSelect(row.code)
      },
    }),
    [rows, onSelect],
  )

  return (
    <div>
      <EChart option={option} style={{ height: 330 }} onEvents={onEvents} />
      <div className="flex flex-wrap items-center gap-4 px-3 pb-1">
        <LegendKey color={tokens.series[0]} label="Occurrences" />
        <LegendKey color={tokens.series[1]} shape="line" label="Cumulative" />
        {vitalFew > 0 && (
          <span className="text-[0.6875rem] font-medium text-ink-secondary">
            {vitalFew} of {rows.length} codes cause 80% of defects
          </span>
        )}
        <span className="text-[0.6875rem] text-ink-muted">Click a bar to filter</span>
      </div>
    </div>
  )
}
