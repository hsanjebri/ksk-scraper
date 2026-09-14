/** Compact display value for stat tiles: 1,284 / 12.9K / 4.2M */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString('en-US')
}

export function percent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** 138 -> "2h 18m"; 45 -> "45m"; 2890 -> "2d 0h" */
export function duration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—'
  const mins = Math.round(minutes)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/**
 * Live-ticking elapsed label for the rework table.
 *
 * Past a day it switches to "3d 23h" rather than continuing to count hours —
 * "95:18:38" reads as 95 minutes at a glance, which is off by two orders of
 * magnitude on exactly the records that matter most.
 */
export function durationLive(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—'
  const totalSeconds = Math.round(minutes * 60)
  const pad = (n: number) => String(n).padStart(2, '0')

  if (totalSeconds >= 86_400) {
    const days = Math.floor(totalSeconds / 86_400)
    const hours = Math.floor((totalSeconds % 86_400) / 3600)
    const mins = Math.floor((totalSeconds % 3600) / 60)
    return `${days}d ${hours}h ${pad(mins)}m`
  }

  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function relativeTime(from: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

export function shortDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** "2026-W37" -> "W37" */
export function shortWeek(week: string): string {
  const match = week.match(/W(\d+)$/)
  return match ? `W${match[1]}` : week
}
