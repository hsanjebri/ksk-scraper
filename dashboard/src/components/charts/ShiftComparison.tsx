import { useVizTokens } from '@/hooks/useDashboardData'
import type { ShiftRow } from '@/lib/analysis'
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
import { duration } from '@/lib/format'
import { useMemo } from 'react'
import { LegendKey } from './LegendKey'

/**
 * Volume by shift, counted two ways.
 *
 * "Caused" and "detected" are different questions about the same shift, so
 * they're two grouped series rather than one number — a shift that detects a
 * lot is doing its job; a shift that causes a lot is the problem. Grouped, not
 * stacked: the same record appears in both series, so stacking them would draw
 * a total that doesn't mean anything.
 *
 * Clicking a bar drills the page down to that shift.
 */
export function ShiftComparison({
  rows,
  activeShift,
  onSelect,
}: {
  rows: ShiftRow[]
  activeShift: string | null
  onSelect: (shift: string) => void
}) {
  const tokens = useVizTokens()

  const option = useMemo(() => {
    const dim = (shift: string) => (activeShift !== null && activeShift !== shift ? 0.35 : 1)

    return {
      backgroundColor: 'transparent',
      ...seriesEntrance,
      tooltip: {
        ...baseTooltip(tokens, 'axis'),
        formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
          const row = rows.find((r) => `Shift ${r.shift}` === params[0]?.axisValue)
          return tooltipRows(tokens, params[0]?.axisValue ?? '', [
            ...params.map((p) => ({ label: p.seriesName, value: String(p.value), color: p.color })),
            {
              label: 'Avg duration',
              value: Number.isFinite(row?.avgDurationMinutes ?? NaN)
                ? duration(row!.avgDurationMinutes)
                : '—',
            },
          ])
        },
      },
      grid: { left: 48, right: 20, top: 20, bottom: 34 },
      xAxis: categoryAxis(tokens, rows.map((r) => `Shift ${r.shift}`)),
      yAxis: valueAxis(tokens, 'Records'),
      series: [
        {
          name: 'Defect caused on',
          type: 'bar',
          data: rows.map((r) => ({
            value: r.defect,
            itemStyle: {
              color: tokens.series[0],
              borderRadius: BAR_RADIUS_UP,
              opacity: dim(r.shift),
            },
          })),
          barMaxWidth: BAR_MAX_WIDTH,
          barGap: '12%',
          ...seriesEntrance,
        },
        {
          name: 'Defect detected on',
          type: 'bar',
          data: rows.map((r) => ({
            value: r.detect,
            itemStyle: {
              color: tokens.series[1],
              borderRadius: BAR_RADIUS_UP,
              opacity: dim(r.shift),
            },
          })),
          barMaxWidth: BAR_MAX_WIDTH,
          ...seriesEntrance,
        },
      ],
    }
  }, [rows, activeShift, tokens])

  const onEvents = useMemo(
    () => ({
      click: (params: { dataIndex: number }) => {
        const row = rows[params.dataIndex]
        if (row) onSelect(row.shift)
      },
    }),
    [rows, onSelect],
  )

  return (
    <div>
      <EChart
        option={option}
        style={{ height: 280 }}
        onEvents={onEvents}
      />
      <div className="flex flex-wrap items-center gap-4 px-3 pb-1">
        <LegendKey color={tokens.series[0]} label="Defect caused on" />
        <LegendKey color={tokens.series[1]} label="Defect detected on" />
        <span className="text-[0.6875rem] text-ink-muted">Click a bar to filter</span>
      </div>
    </div>
  )
}
