import { useNow } from '@/hooks/useDashboardData'
import { relativeTime } from '@/lib/format'
import { modelsIn } from '@/lib/metrics'
import { ALL_MODELS, useFilters } from '@/store/useFilters'
import { useRecords } from '@/store/useRecords'
import { useTheme, type ThemeMode } from '@/store/useTheme'
import clsx from 'clsx'
import { useMemo } from 'react'

function ConnectionDot() {
  const connection = useRecords((s) => s.connection)
  const lastUpdated = useRecords((s) => s.lastUpdated)
  useNow(1000) // re-render so "Xs ago" keeps counting

  const tone = {
    live: { dot: 'bg-good', label: 'Live' },
    connecting: { dot: 'bg-warning', label: 'Connecting' },
    offline: { dot: 'bg-critical', label: 'Offline' },
  }[connection]

  return (
    <div className="flex items-center gap-2 text-[0.6875rem] text-ink-muted">
      <span className="relative flex size-2">
        {connection === 'live' && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60" />
        )}
        <span className={clsx('relative inline-flex size-2 rounded-full', tone.dot)} />
      </span>
      <span className="font-medium text-ink-secondary">{tone.label}</span>
      {lastUpdated && (
        <>
          <span aria-hidden>·</span>
          <span>updated {relativeTime(lastUpdated)}</span>
        </>
      )}
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
          <ConnectionDot />
        </div>

        <div className="flex items-center gap-2">
          <ModelFilter />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
