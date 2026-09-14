import { useVizTokens } from '@/hooks/useDashboardData'
import { EChart } from '@/lib/echarts'
import type { Bucket } from '@/lib/metrics'

import { useMemo } from 'react'

/**
 * Part-to-whole share of defects by error code, capped at 5 slices plus an
 * "Other" fold — past ~6 segments a donut stops being readable at a glance and
 * the categorical palette runs out of separable hues.
 *
 * Clicking a slice drills the whole page down to that code; clicking the active
 * slice again clears it. "Other" is not clickable — it's an aggregate, so
 * filtering to it would mean filtering to "everything small", which isn't a
 * question anyone asks.
 */
export function DefectsDonut({
  buckets,
  activeKey,
  onSelect,
}: {
  buckets: Bucket[]
  activeKey: string | null
  onSelect: (key: string) => void
}) {
  const tokens = useVizTokens()
  const total = buckets.reduce((sum, b) => sum + b.value, 0)

  const option = useMemo(() => {
    return {
      backgroundColor: 'transparent',
      animationDuration: 420,
      tooltip: {
        trigger: 'item',
        backgroundColor: tokens.tooltipBg,
        borderColor: tokens.tooltipBorder,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: tokens.ink, fontSize: 12 },
        formatter: (p: { name: string; value: number; percent: number }) =>
          `<div style="font-weight:600;margin-bottom:2px">${p.name}</div>
           <div style="color:${tokens.inkSecondary}">${p.value} defects · ${p.percent.toFixed(1)}%</div>`,
      },
      series: [
        {
          type: 'pie',
          radius: ['58%', '82%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          // 2px surface gap does the separating — never a border on the mark.
          itemStyle: { borderColor: tokens.surface, borderWidth: 2 },
          label: {
            show: true,
            color: tokens.inkSecondary,
            fontSize: 11,
            formatter: '{b}\n{d}%',
            lineHeight: 14,
          },
          labelLine: { length: 8, length2: 8, lineStyle: { color: tokens.baseline } },
          emphasis: {
            scaleSize: 6,
            label: { show: true, fontWeight: 600, color: tokens.ink },
          },
          data: buckets.map((bucket, index) => {
            const isOther = bucket.key === '__other__'
            const dimmed = activeKey !== null && activeKey !== bucket.key
            return {
              name: bucket.label,
              value: bucket.value,
              itemStyle: {
                color: isOther ? tokens.neutral : tokens.series[index % tokens.series.length],
                opacity: dimmed ? 0.35 : 1,
                borderColor: tokens.surface,
                borderWidth: 2,
              },
            }
          }),
        },
      ],
    }
  }, [buckets, activeKey, tokens])

  const onEvents = useMemo(
    () => ({
      click: (params: { dataIndex: number }) => {
        const bucket = buckets[params.dataIndex]
        if (!bucket || bucket.key === '__other__') return
        onSelect(bucket.key)
      },
    }),
    [buckets, onSelect],
  )

  return (
    <div className="relative">
      <EChart
        option={option}
        style={{ height: 300 }}
        onEvents={onEvents}
      />
      {/* Centre readout — the donut's own hole is otherwise wasted space. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl leading-none font-semibold text-ink">{total}</span>
        <span className="mt-1 text-[0.6875rem] text-ink-muted">defects</span>
      </div>
      <p className="px-3 pb-1 text-[0.6875rem] text-ink-muted">
        Click a slice to filter the page · click again to clear
      </p>
    </div>
  )
}
