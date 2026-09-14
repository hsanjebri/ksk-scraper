/**
 * ECharts renders to <canvas>, which cannot read CSS custom properties — so
 * the same palette that index.css defines as CSS vars is mirrored here as raw
 * hex, keyed by mode, and passed into chart options explicitly.
 *
 * These values are the validated data-viz reference palette. The categorical
 * `series` array was checked with scripts/validate_palette.js in BOTH modes:
 *   light: worst adjacent CVD ΔE 9.1, normal-vision ΔE 19.6 — PASS
 *   dark:  worst adjacent CVD ΔE 8.4, normal-vision ΔE 19.3 — PASS
 * The ORDER is the colorblind-safety mechanism. Re-validate before reordering
 * or substituting any hex.
 *
 * Light mode warns on sub-3:1 contrast for s3/s4/s5 against the surface, which
 * obligates relief: charts using them ship visible labels and a table view.
 */
export interface VizTokens {
  surface: string
  ink: string
  inkSecondary: string
  inkMuted: string
  grid: string
  baseline: string
  series: string[]
  neutral: string
  status: {
    good: string
    warning: string
    serious: string
    critical: string
  }
  tooltipBg: string
  tooltipBorder: string
}

const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const

export const LIGHT_TOKENS: VizTokens = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  inkSecondary: '#52514e',
  inkMuted: '#898781',
  grid: '#e1e0d9',
  baseline: '#c3c2b7',
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
  neutral: '#c3c2b7',
  status: STATUS,
  tooltipBg: '#ffffff',
  tooltipBorder: 'rgba(11,11,11,0.10)',
}

export const DARK_TOKENS: VizTokens = {
  surface: '#1a1a19',
  ink: '#ffffff',
  inkSecondary: '#c3c2b7',
  inkMuted: '#898781',
  grid: '#2c2c2a',
  baseline: '#383835',
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'],
  neutral: '#52514e',
  status: STATUS,
  tooltipBg: '#232322',
  tooltipBorder: 'rgba(255,255,255,0.12)',
}

/**
 * Colour follows the ENTITY, never its rank — so a filter that drops a series
 * must not repaint the survivors. Callers pass a stable key list (e.g. the
 * full sorted model list) and look colours up by key.
 */
export function colorForKey(key: string, orderedKeys: string[], tokens: VizTokens): string {
  const index = orderedKeys.indexOf(key)
  if (index < 0) return tokens.neutral
  return tokens.series[index % tokens.series.length]
}
