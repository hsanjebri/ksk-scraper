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
import { anomalyIndices } from '@/lib/metrics'
import { missesTarget } from '@/store/useTargets'
import { useMemo } from 'react'
import { LegendKey } from './LegendKey'

/**
 * One KPI per week against its target.
 *
 * Off-target weeks are marked three ways so no reader depends on colour: the
 * point turns critical red, it grows and changes to a diamond, and the tooltip
 * and table say "Off target" in words. Statistical anomalies (>2σ from the
 * weeks before) get the same ring as the Overview trend, because a week can be
 * on target and still be a sharp break from normal — and vice versa.
 */
export function TargetTrend({
  labels,
  values,
  target,
  higherIsBetter,
  variant = 'line',
  seriesLabel,
  format,
  ceiling,
  height = 260,
}: {
  labels: string[]
  values: number[]
  target: number | null
  higherIsBetter: boolean
  variant?: 'bar' | 'line'
  seriesLabel: string
  /** Must be referentially stable (module-level) — it is a memo dependency. */
  format: (value: number) => string
  /** Hard upper bound for the axis, e.g. 100 for a percentage. */
  ceiling?: number
  height?: number
}) {
  const tokens = useVizTokens()

  const { option, offCount, anomalyCount } = useMemo(() => {
    const clean = values.map((v) => (Number.isFinite(v) ? Number(v.toFixed(2)) : null))
    const anomalies = anomalyIndices(values.map((v) => (Number.isFinite(v) ? v : NaN)))
    const off = values.map((v) => missesTarget(v, target, higherIsBetter))

    const data = clean.map((value, i) => ({
      value,
      symbol: off[i] ? 'diamond' : 'circle',
      symbolSize: off[i] ? 13 : 7,
      itemStyle: off[i]
        ? { color: tokens.status.critical, borderColor: tokens.surface, borderWidth: 1.5 }
        : variant === 'bar'
          ? { color: tokens.series[0], borderRadius: BAR_RADIUS_UP }
          : { color: tokens.series[0], borderColor: tokens.surface, borderWidth: 1.5 },
    }))

    // ECharts does not stretch an axis to fit a markLine, so a target far from
    // the data would silently fall outside the plot. Widen the extent to
    // include it, rounded to whole units so tick labels stay clean.
    type Extent = { min: number; max: number }
    const yMin =
      variant === 'bar'
        ? 0
        : ({ min, max }: Extent) => {
            const lo = Math.min(min, target ?? min)
            const hi = Math.max(max, target ?? max)
            return Math.max(0, Math.floor(lo - (hi - lo) * 0.15 - 0.001))
          }
    const yMax = ({ min, max }: Extent) => {
      const lo = variant === 'bar' ? 0 : Math.min(min, target ?? min)
      const hi = Math.max(max, target ?? max)
      const padded = Math.ceil(hi + (hi - lo) * 0.12 + 0.001)
      return ceiling === undefined ? padded : Math.min(ceiling, padded)
    }

    const series = {
      name: seriesLabel,
      data,
      ...seriesEntrance,
      markLine:
        target === null
          ? undefined
          : {
              silent: true,
              symbol: 'none',
              lineStyle: { color: tokens.inkSecondary, type: 'dashed' as const, width: 1.5 },
              label: {
                position: 'insideEndTop' as const,
                color: tokens.inkSecondary,
                fontSize: 10,
                formatter: `Target ${format(target)}`,
              },
              data: [{ yAxis: target }],
            },
      markPoint: {
        symbol: 'circle',
        symbolSize: 20,
        silent: true,
        itemStyle: { color: 'transparent', borderColor: tokens.status.critical, borderWidth: 2 },
        label: { show: false },
        data: [...anomalies]
          .filter((i) => clean[i] !== null)
          .map((i) => ({ coord: [labels[i], clean[i]] })),
      },
    }

    return {
      offCount: off.filter(Boolean).length,
      anomalyCount: anomalies.size,
      option: {
        backgroundColor: 'transparent',
        ...seriesEntrance,
        tooltip: {
          ...baseTooltip(tokens, 'axis'),
          axisPointer: { type: 'line', lineStyle: { color: tokens.baseline, width: 1 } },
          formatter: (params: { axisValue: string; dataIndex: number }[]) => {
            const i = params[0]?.dataIndex ?? 0
            const rows = [
              { label: seriesLabel, value: clean[i] === null ? '—' : format(values[i]), color: tokens.series[0] },
            ]
            if (target !== null) {
              rows.push({ label: 'Target', value: `${higherIsBetter ? '≥' : '≤'} ${format(target)}`, color: '' })
              rows.push({ label: 'Status', value: off[i] ? 'Off target' : 'On target', color: '' })
            }
            if (anomalies.has(i)) rows.push({ label: 'Anomaly', value: '>2σ from prior weeks', color: '' })
            return tooltipRows(tokens, params[0]?.axisValue ?? '', rows)
          },
        },
        grid: { left: 56, right: 24, top: 28, bottom: 34 },
        xAxis: categoryAxis(tokens, labels, labels.length > 14 ? 35 : 0),
        yAxis: { ...valueAxis(tokens), min: yMin, max: yMax },
        series: [
          variant === 'bar'
            ? { ...series, type: 'bar', barMaxWidth: BAR_MAX_WIDTH }
            : {
                ...series,
                type: 'line',
                smooth: false,
                showAllSymbol: true,
                lineStyle: { width: 2, color: tokens.series[0] },
                areaStyle: { color: tokens.series[0], opacity: 0.08 },
              },
        ],
      },
    }
  }, [labels, values, target, higherIsBetter, variant, seriesLabel, format, ceiling, tokens])

  return (
    <div>
      <EChart option={option} style={{ height }} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-1">
        <LegendKey color={tokens.series[0]} shape={variant === 'bar' ? 'bar' : 'line'} label={seriesLabel} />
        {target !== null && (
          <span className="inline-flex items-center gap-1.5 text-[0.6875rem] text-ink-secondary">
            <span aria-hidden className="inline-block w-3.5 border-t-[1.5px] border-dashed" style={{ borderColor: tokens.inkSecondary }} />
            Target
          </span>
        )}
        {offCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-medium text-critical">
            <span
              aria-hidden
              className={variant === 'bar' ? 'inline-block size-2.5 rounded-sm' : 'inline-block size-2 rotate-45'}
              style={{ backgroundColor: tokens.status.critical }}
            />
            {offCount} week{offCount === 1 ? '' : 's'} off target
          </span>
        )}
        {anomalyCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-medium text-critical">
            <span aria-hidden className="inline-block size-2.5 rounded-full border-2" style={{ borderColor: tokens.status.critical }} />
            {anomalyCount} anomal{anomalyCount === 1 ? 'y' : 'ies'} (&gt;2σ)
          </span>
        )}
      </div>
    </div>
  )
}
