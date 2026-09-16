import clsx from 'clsx'
import { NavLink } from 'react-router-dom'

export interface NavItem {
  to: string
  label: string
  icon: string
  ready?: boolean
}

/** `d` attributes for 20x20 stroke icons — kept inline to avoid an icon dep. */
const ICONS: Record<string, string> = {
  overview: 'M3 3v14h14M6 13l3-4 3 2.5L16 6',
  rework: 'M4 10a6 6 0 0 1 10-4.5M16 10a6 6 0 0 1-10 4.5M14 3v3h-3M6 17v-3h3',
  defects: 'M10 3 3 16h14L10 3Zm0 5v3m0 3h.01',
  pareto: 'M3 17h3v-6H3v6Zm5 0h3V7H8v10Zm5 0h3v-3h-3v3ZM3 6l6 3 8-4',
  trends: 'M3 14l4-5 3 3 7-8M14 4h3v3',
  kpi: 'M10 3a7 7 0 1 0 7 7h-7V3Z M13 3a4 4 0 0 1 4 4h-4V3Z',
  reports: 'M5 3h7l3 3v11H5V3Zm7 0v3h3M8 11h5M8 14h5',
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: 'overview', ready: true },
  { to: '/rework', label: 'Rework analysis', icon: 'rework', ready: true },
  { to: '/defects', label: 'Defects analysis', icon: 'defects', ready: true },
  { to: '/pareto', label: 'Top 10 / Pareto', icon: 'pareto', ready: true },
  { to: '/trends', label: 'Trends', icon: 'trends', ready: true },
  { to: '/kpi', label: 'KPI', icon: 'kpi' },
  { to: '/reports', label: 'Reports', icon: 'reports', ready: true },
]

function NavIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={path} />
    </svg>
  )
}

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  return (
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col bg-rail transition-transform duration-200 lg:static lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-s1 to-s1/70 text-[0.6875rem] font-bold tracking-tight text-white shadow-lg shadow-black/20">
            SE
          </div>
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem] leading-tight font-semibold text-rail-ink">
              SEBN <span className="text-rail-muted">TN3</span>
            </p>
            <p className="truncate text-[0.6875rem] text-rail-muted">Rework quality</p>
          </div>
        </div>
        {/* Customer programme this plant's output feeds. Text label only — no
            third-party emblem is reproduced. */}
        <p className="mt-3 border-t border-white/8 pt-3 text-[0.625rem] tracking-[0.14em] text-rail-muted uppercase">
          Mercedes-Benz programme
        </p>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[0.8125rem] transition-all duration-200',
                isActive
                  ? 'bg-rail-hover font-medium text-rail-ink'
                  : 'text-rail-muted hover:bg-rail-hover/60 hover:text-rail-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    className="nav-active-mark absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-s1"
                    aria-hidden
                  />
                )}
                <NavIcon path={ICONS[item.icon]} />
                <span className="truncate">{item.label}</span>
                {!item.ready && (
                  <span className="ml-auto rounded bg-rail-ink/10 px-1.5 py-0.5 text-[0.5625rem] font-medium tracking-wide text-rail-muted uppercase">
                    soon
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/8 px-5 py-3">
        <p className="text-[0.6875rem] text-rail-muted">
          Mock data · scraper not yet on-network
        </p>
      </div>
    </aside>
  )
}
