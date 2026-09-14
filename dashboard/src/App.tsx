import { Shell } from '@/components/layout/Shell'
import { ComingSoon } from '@/pages/ComingSoon'
import { Overview } from '@/pages/Overview'
import { Pareto } from '@/pages/Pareto'
import { ReworkAnalysis } from '@/pages/ReworkAnalysis'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Overview />} />
          <Route path="rework" element={<ReworkAnalysis />} />
          <Route
            path="defects"
            element={
              <ComingSoon
                title="Defects analysis"
                items={[
                  'Error-code frequency table — sortable, searchable, with trend',
                  'Part type/name breakdown as a horizontal bar',
                  'Defect heatmap — day-of-week × shift',
                ]}
              />
            }
          />
          <Route path="pareto" element={<Pareto />} />
          <Route
            path="trends"
            element={
              <ComingSoon
                title="Trends"
                items={[
                  'Long-range weekly/monthly series for rework rate, FPY, defect count',
                  'Side-by-side comparison of two time ranges',
                ]}
              />
            }
          />
          <Route
            path="kpi"
            element={
              <ComingSoon
                title="KPI deep-dive"
                items={[
                  'Expanded KPI cards with historical mini-charts',
                  'Configurable target thresholds per metric',
                ]}
              />
            }
          />
          <Route
            path="reports"
            element={
              <ComingSoon
                title="Reports"
                items={[
                  'Filtered record table for a chosen date range',
                  'CSV and PDF export',
                ]}
              />
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
