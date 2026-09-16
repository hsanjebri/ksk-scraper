/**
 * Tree-shaken ECharts build. Importing the `echarts` barrel pulls in every
 * chart type and renderer (~1MB minified); registering only what the dashboard
 * actually draws keeps the bundle a fraction of that.
 *
 * Add a chart type here when a new page needs one — e.g. HeatmapChart for the
 * defect heatmap, TreemapChart for the part breakdown.
 */
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import type { CSSProperties } from 'react'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  HeatmapChart,
  // HeatmapChart hard-requires VisualMapComponent on category axes — it throws
  // "Heatmap must use with visualMap" at render time even when every cell
  // carries its own itemStyle colour. The heatmap hides the control and feeds
  // it our own validated ramp, so registering it costs the bundle a little but
  // is not optional.
  VisualMapComponent,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkPointComponent,
  MarkLineComponent,
  AxisPointerComponent,
  SVGRenderer,
])

/**
 * CJS/ESM interop.
 *
 * `echarts-for-react/lib/core` is CommonJS. Depending on how Vite interops it,
 * the default import can arrive as the component OR as a `{ default: … }`
 * wrapper object. Handing React the wrapper throws "Element type is invalid …
 * got: object" at render time — which TypeScript cannot catch, because the
 * declared type says it's a component either way.
 *
 * Unwrap exactly once, here, so no chart file has to know about it.
 */
const EChartsCore = ((ReactEChartsCore as unknown as { default?: unknown }).default ??
  ReactEChartsCore) as typeof ReactEChartsCore

export interface EChartProps {
  option: Record<string, unknown>
  style?: CSSProperties
  onEvents?: Record<string, (params: never) => void>
  /** Replace the option wholesale instead of merging — the default here. */
  notMerge?: boolean
}

/**
 * The single ECharts entry point for the dashboard. Injects the tree-shaken
 * `echarts` instance and pins the SVG renderer so charts stay crisp on the
 * high-DPI panels these dashboards end up on, and so text is selectable.
 */
export function EChart({ option, style, onEvents, notMerge = true }: EChartProps) {
  return (
    <EChartsCore
      echarts={echarts}
      option={option}
      style={style}
      onEvents={onEvents}
      notMerge={notMerge}
      opts={{ renderer: 'svg' }}
    />
  )
}

export { echarts }
