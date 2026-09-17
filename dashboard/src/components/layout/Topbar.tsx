import { useNow } from '@/hooks/useDashboardData'
import { relativeTime } from '@/lib/format'
import { modelsIn } from '@/lib/metrics'
import { ALL_MODELS, useFilters } from '@/store/useFilters'
import { useRecords } from '@/store/useRecords'
import { useSyncStatus } from '@/store/useSyncStatus'
import { useTheme, type ThemeMode } from '@/store/useTheme'
import clsx from 'clsx'
import { useMemo } from 'react'

function ConnectionDot() {
  const connection = useRecords((s) => s.connection)
  const lastUpdated = useRecords((s) => s.lastUpdated)
  useNow(1000) // re-render so "Xs ago" keeps counting

  const TONES: Record<typeof connection, { dot: string; label: string }> = {
    live: { dot: 'bg-good', label: 'Live' },
    connecting: { dot: 'bg-warning', label: 'Connecting' },
    offline: { dot: 'bg-critical', label: 'Offline' },
    // Never dressed up as "Live" — someone looking at this has to be able to
    // tell at a glance that the numbers are generated, not from the factory.
    demo: { dot: 'bg-warning', label: 'Demo data' },
  }
  const tone = TONES[connection]

  return (
    <div className="flex items-center gap-2 text-[0.6875rem] text-ink-muted">
      <span className="relative flex size-2">
        {connection === 'live' && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60" />
        )}
        <span className={clsx('relative inline-flex size-2 rounded-full', tone.dot)} />
      </span>
      <span className="font-medium text-ink-secondary">{tone.label}</span>
      {connection === 'demo' && (
        <span
          className="rounded bg-warning/18 px-1.5 py-0.5 font-medium text-ink"
          title="No backend reachable — these records are generated in the browser. The real scraper runs inside the SEBN network."
        >
          not connected to the factory
        </span>
      )}
      {lastUpdated && (
        <>
          <span aria-hidden>·</span>
          <span>updated {relativeTime(lastUpdated)}</span>
        </>
      )}
    </div>
  )
}

/**
 * First-sync progress. On a fresh start in the plant the scraper stores the
 * whole history from the list pages at once, then fetches detail pages at a
 * polite pace; records join the dashboard as they complete. Hidden once
 * nothing is pending.
 */
function SyncBadge() {
  const status = useSyncStatus((s) => s.status)
  const demo = useRecords((s) => s.demo)
  if (demo || !status || status.counts.pending === 0) return null

  const { total, ready, pending } = status.counts
  const pct = total > 0 ? (ready / total) * 100 : 0

  return (
    <div
      className="flex items-center gap-2 text-[0.6875rem] text-ink-muted"
      role="status"
      title={`${pending.toLocaleString('en-US')} record(s) known from the list page are waiting for their detail page. They appear on the dashboard as soon as it has been read.`}
    >
      <span className="font-medium text-ink-secondary">Syncing history</span>
      <span
        className="relative h-1.5 w-24 overflow-hidden rounded-full bg-ink/8"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label="History sync progress"
      >
        <span className="absolute inset-y-0 left-0 rounded-full bg-s1 transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular">
        {ready.toLocaleString('en-US')} / {total.toLocaleString('en-US')}
      </span>
    </div>
  )
}

/**
 * State of the plant bridge.
 *
 * In relay mode the data comes from an agent running on a PC inside the SEBN
 * network, because the rework server is unreachable from outside. If that PC
 * sleeps or leaves the network, the dashboard would otherwise just look quiet
 * — identical to a plant with nothing to report. This says which it is.
 */
function BridgeBadge() {
  const status = useSyncStatus((s) => s.status)
  const demo = useRecords((s) => s.demo)
  useNow(5000)

  if (demo || !status || status.mode !== 'relay') return null

  const lastSeen = status.agent ? new Date(status.agent.lastSeenAt) : null
  const minutesSince = lastSeen ? (Date.now() - lastSeen.getTime()) / 60_000 : Infinity
  const stale = minutesSince > 3

  return (
    <div
      className="flex items-center gap-1.5 text-[0.6875rem]"
      role="status"
      title={
        lastSeen
          ? `The sync program on ${status.agent?.name ?? 'the plant PC'} last sent data ${relativeTime(lastSeen)}. It must stay open for live updates.`
          : 'No plant PC has sent data yet. Start live-sync.bat inside the SEBN network.'
      }
    >
      <span className={clsx('inline-block size-2 rounded-full', stale ? 'bg-critical' : 'bg-good')} aria-hidden />
      <span className={clsx('font-medium', stale ? 'text-critical' : 'text-ink-secondary')}>
        {lastSeen ? (stale ? 'Plant bridge silent' : 'Plant bridge') : 'Plant bridge not started'}
      </span>
      {lastSeen && <span className="text-ink-muted">{relativeTime(lastSeen)}</span>}
    </div>
  )
}

function ModelFilter() {
  const records = useRecords((s) => s.records)
  const model = useFilters((s) => s.model)
  const setModel = useFilters((s) => s.setModel)

  // Derived from the data, not hardcoded — the backend currently serves
  // MAM/MCM and will serve the real programme codes later without a code change.
  const options = useMemo(() => [ALL_MODELS, ...modelsIn(records)], [records])

  return (
    <div className="flex rounded-lg border border-hairline bg-surface p-0.5" role="group" aria-label="Model filter">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setModel(option)}
          aria-pressed={model === option}
          className={clsx(
            'rounded-md px-3 py-1.5 text-xs font-medium transition',
            model === option
              ? 'bg-ink/8 text-ink'
              : 'text-ink-muted hover:text-ink-secondary',
          )}
        >
          {option === ALL_MODELS ? 'All' : option}
        </button>
      ))}
    </div>
  )
}

function ThemeToggle() {
  const mode = useTheme((s) => s.mode)
  const setMode = useTheme((s) => s.setMode)

  const options: { value: ThemeMode; label: string; path: string }[] = [
    { value: 'light', label: 'Light', path: 'M10 3v1.5M10 15.5V17M17 10h-1.5M4.5 10H3M14.9 5.1l-1 1M6.1 13.9l-1 1M14.9 14.9l-1-1M6.1 6.1l-1-1' },
    { value: 'dark', label: 'Dark', path: 'M16 11.2A6.5 6.5 0 0 1 8.8 4a6.5 6.5 0 1 0 7.2 7.2Z' },
    { value: 'system', label: 'System', path: 'M3 5h14v8H3zM7 17h6M10 13v4' },
  ]

  return (
    <div className="flex rounded-lg border border-hairline bg-surface p-0.5" role="group" aria-label="Colour theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setMode(option.value)}
          aria-pressed={mode === option.value}
          title={option.label}
          className={clsx(
            'rounded-md p-1.5 transition',
            mode === option.value ? 'bg-ink/8 text-ink' : 'text-ink-muted hover:text-ink-secondary',
          )}
        >
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {option.value === 'light' && <circle cx="10" cy="10" r="3.2" />}
            <path d={option.path} />
          </svg>
          <span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Topbar({ title, onMenu }: { title: string; onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-plane/85 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={onMenu}
          className="rounded-md p-1.5 text-ink-secondary transition hover:bg-ink/5 lg:hidden"
          aria-label="Open navigation"
        >
          <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 6h14M3 10h14M3 14h14" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-ink sm:text-lg">{title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <ConnectionDot />
            <BridgeBadge />
            <SyncBadge />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ModelFilter />
          <img
            src="/sebn-mercedes-banner.png"
            alt="SEBN TN03 | Mercedes-Benz"
            className="hidden h-8 w-auto rounded sm:block"
          />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
