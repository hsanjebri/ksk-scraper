import { useFilters } from '@/store/useFilters'
import { useRecords } from '@/store/useRecords'
import { watchSystemTheme } from '@/store/useTheme'
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { NAV_ITEMS, Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

/** Chips showing any active chart drill-down, with a one-click escape. */
function DrilldownBar() {
  const { errorCode, partType, shift, clearDrilldown, toggleErrorCode, togglePartType, toggleShift } =
    useFilters()

  const chips = [
    errorCode && { label: `Error ${errorCode}`, clear: () => toggleErrorCode(errorCode) },
    partType && { label: `Part ${partType}`, clear: () => togglePartType(partType) },
    shift && { label: `Shift ${shift}`, clear: () => toggleShift(shift) },
  ].filter(Boolean) as { label: string; clear: () => void }[]

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-s1/6 px-4 py-2 sm:px-6">
      <span className="text-[0.6875rem] font-medium text-ink-secondary">Filtered by</span>
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={chip.clear}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[0.6875rem] font-medium text-ink shadow-sm transition hover:bg-ink/5"
        >
          {chip.label}
          <span aria-hidden className="text-ink-muted">×</span>
          <span className="sr-only">Remove filter</span>
        </button>
      ))}
      <button
        type="button"
        onClick={clearDrilldown}
        className="text-[0.6875rem] font-medium text-ink-muted underline underline-offset-2 transition hover:text-ink"
      >
        Clear all
      </button>
    </div>
  )
}

export function Shell() {
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()
  const load = useRecords((s) => s.load)
  const connect = useRecords((s) => s.connect)
  const disconnect = useRecords((s) => s.disconnect)

  useEffect(() => {
    void load()
    connect()
    const unwatch = watchSystemTheme()
    return () => {
      disconnect()
      unwatch()
    }
  }, [load, connect, disconnect])

  const title = NAV_ITEMS.find((item) => item.to === location.pathname)?.label ?? 'Overview'

  return (
    <div className="flex min-h-full">
      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} onMenu={() => setNavOpen(true)} />
        <DrilldownBar />
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
