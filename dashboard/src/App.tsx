import { Shell } from '@/components/layout/Shell'
import { DefectsAnalysis } from '@/pages/DefectsAnalysis'
import { Kpi } from '@/pages/Kpi'
import { Overview } from '@/pages/Overview'
import { Pareto } from '@/pages/Pareto'
import { Reports } from '@/pages/Reports'
import { Trends } from '@/pages/Trends'
import { ReworkAnalysis } from '@/pages/ReworkAnalysis'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Overview />} />
          <Route path="rework" element={<ReworkAnalysis />} />
          <Route path="defects" element={<DefectsAnalysis />} />
          <Route path="pareto" element={<Pareto />} />
          <Route path="trends" element={<Trends />} />
          <Route path="kpi" element={<Kpi />} />
          <Route path="reports" element={<Reports />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
