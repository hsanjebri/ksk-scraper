import type { VizTokens } from './viz-tokens'

/**
 * Shared ECharts chrome so every chart in the dashboard reads as one system:
 * the same recessive hairline grid, the same tooltip shell, the same entrance
 * easing. Charts supply only their series and axis data.
 */

export function baseTooltip(tokens: VizTokens, trigger: 'axis' | 'item' = 'axis') {
  return {
    trigger,
    backgroundColor: tokens.tooltipBg,
    borderColor: tokens.tooltipBorder,
    borderWidth: 1,
    padding: [9, 12],
    extraCssText: 'box-shadow: 0 8px 24px -12px rgba(0,0,0,0.4); border-radius: 10px;',
    textStyle: { color: tokens.ink, fontSize: 12 },
    axisPointer: {
      type: trigger === 'axis' ? ('shadow' as const) : ('none' as const),
      shadowStyle: { color: `${tokens.ink}0a` },
    },
  }
}

/** Renders a tooltip body as label/value rows with a colour key per series. */
export function tooltipRows(
  tokens: VizTokens,
  header: string,
  rows: { label: string; value: string; color?: string }[],
): string {
  const body = rows
    .map(
      (row) => `
      <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;margin-top:3px">
        <span style="display:flex;align-items:center;gap:6px;color:${tokens.inkSecondary}">
          ${row.color ? `<span style="width:8px;height:8px;border-radius:2px;background:${row.color};display:inline-block"></span>` : ''}
          ${row.label}
        </span>
        <strong style="color:${tokens.ink}">${row.value}</strong>
      </div>`,
    )
    .join('')
  return `<div style="font-weight:600;margin-bottom:2px">${header}</div>${body}`
}

export function categoryAxis(tokens: VizTokens, data: string[], rotate = 0) {
  return {
    type: 'category' as const,
    data,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: tokens.baseline } },
    axisLabel: { color: tokens.inkMuted, fontSize: 11, rotate, hideOverlap: true },
  }
}

export function valueAxis(tokens: VizTokens, name?: string, formatter?: string) {
  return {
    type: 'value' as const,
    name,
    nameTextStyle: { color: tokens.inkMuted, fontSize: 11, align: 'left' as const },
    nameGap: 12,
    splitLine: { lineStyle: { color: tokens.grid, width: 1 } },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: tokens.inkMuted, fontSize: 11, formatter },
  }
}

/**
 * Staggered bar/segment entrance. Index-based so bars sweep left-to-right
 * rather than all inflating at once — reads as deliberate instead of bouncy.
 */
export const seriesEntrance = {
  animationDuration: 600,
  animationEasing: 'cubicOut' as const,
  animationDelay: (index: number) => index * 28,
}

/** 4px rounded data-end, square at the baseline — the house bar spec. */
export const BAR_RADIUS_UP: [number, number, number, number] = [4, 4, 0, 0]
export const BAR_RADIUS_RIGHT: [number, number, number, number] = [0, 4, 4, 0]
export const BAR_MAX_WIDTH = 24
