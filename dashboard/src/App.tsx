import { Shell } from '@/components/layout/Shell'
import { DefectsAnalysis } from '@/pages/DefectsAnalysis'
import { Kpi } from '@/pages/Kpi'
import { Login } from '@/pages/Login'
import { Overview } from '@/pages/Overview'
import { Pareto } from '@/pages/Pareto'
import { Reports } from '@/pages/Reports'
import { Trends } from '@/pages/Trends'
import { ReworkAnalysis } from '@/pages/ReworkAnalysis'
import { ALLOW_DEMO } from '@/lib/config'
import { useAuth } from '@/store/useAuth'
import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

export default function App() {
  const status = useAuth((s) => s.status)
  const check = useAuth((s) => s.check)

  // Ask the server whether the session cookie is still valid.
  useEffect(() => {
    void check()
  }, [check])

  if (status === 'checking') {
    return <div className="flex min-h-full items-center justify-center bg-plane text-xs text-ink-muted">Loading…</div>
  }

  // Before the router, so no page mounts and no data is fetched until the
  // server has accepted the session. Demo mode (generated data, clearly
  // labelled) is only reachable when explicitly enabled for development.
  const demoOnly = status === 'unavailable' && ALLOW_DEMO
  if (status !== 'signedIn' && !demoOnly) return <Login />

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
