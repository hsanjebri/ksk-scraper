import type { KskRecord } from '@/types'
import { ASSUMED_UNITS_PRODUCED_PER_DAY } from './config'

/**
 * Minutes a record has been in rework. For a closed record that's the real
 * span; for an open one it's elapsed-until-now, recomputed client-side so the
 * live table keeps ticking instead of freezing at the server's snapshot.
 */
export function elapsedMinutes(record: KskRecord, now: number = Date.now()): number {
  const start = new Date(record.registered).getTime()
  if (Number.isNaN(start)) return 0
  const end = record.reworked ? new Date(record.reworked).getTime() : now
  return Math.max(0, (end - start) / 60_000)
}

export function isOpen(record: KskRecord): boolean {
  return record.reworked === null
}

/** Distinct models present in the data, sorted — drives the global filter. */
export function modelsIn(records: KskRecord[]): string[] {
  return [...new Set(records.map((r) => r.model))].sort()
}

/** Every error-code entry across records, flattened (one record can carry several). */
export function allErrorEntries(records: KskRecord[]) {
  return records.flatMap((record) =>
    record.errorCodes.map((entry) => ({ entry, record })),
  )
}

export interface Bucket {
  key: string
  label: string
  value: number
}

/** Counts by an arbitrary key, sorted desc, with a tail folded into "Other". */
export function topNWithOther(
  counts: Map<string, number>,
  limit: number,
  otherLabel = 'Other',
): Bucket[] {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const head = sorted.slice(0, limit)
  const tail = sorted.slice(limit)

  const buckets: Bucket[] = head.map(([key, value]) => ({ key, label: key, value }))
  if (tail.length > 0) {
    const rest = tail.reduce((sum, [, value]) => sum + value, 0)
    if (rest > 0) buckets.push({ key: '__other__', label: otherLabel, value: rest })
  }
  return buckets
}

export function countBy<T>(items: T[], keyOf: (item: T) => string | null | undefined) {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

// ---------- weekly aggregation ----------

export interface WeekBucket {
  week: string
  total: number
  closed: number
  open: number
  defects: number
  avgDurationMinutes: number
  /** Estimated — depends on the assumed production volume. */
  reworkRatePct: number
  /** Estimated — depends on the assumed production volume. */
  firstPassYieldPct: number
}

const ASSUMED_UNITS_PER_WEEK = ASSUMED_UNITS_PRODUCED_PER_DAY * 7

export function weeklyBuckets(records: KskRecord[]): WeekBucket[] {
  const byWeek = new Map<string, KskRecord[]>()
  for (const record of records) {
    const list = byWeek.get(record.week)
    if (list) list.push(record)
    else byWeek.set(record.week, [record])
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, rows]) => {
      const closed = rows.filter((r) => !isOpen(r))
      const defects = rows.reduce((sum, r) => sum + r.errorCodes.length, 0)
      const reworkRatePct = (rows.length / ASSUMED_UNITS_PER_WEEK) * 100
      return {
        week,
        total: rows.length,
        closed: closed.length,
        open: rows.length - closed.length,
        defects,
        avgDurationMinutes: mean(closed.map((r) => elapsedMinutes(r))),
        reworkRatePct,
        firstPassYieldPct: Math.max(0, 100 - reworkRatePct),
      }
    })
}

/** ISO-8601 week label for a date, e.g. "2026-W37" — matches the backend. */
export function isoWeekLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/**
 * Drops the in-progress week.
 *
 * The current week is always partial — comparing three days of it against a
 * full previous week produces a meaningless swing in whichever direction the
 * week happens to be going. Every week-over-week number is computed from
 * complete weeks only.
 */
export function completeWeeks(weeks: WeekBucket[]): WeekBucket[] {
  const currentLabel = isoWeekLabel(new Date())
  return weeks.filter((w) => w.week !== currentLabel)
}

// ---------- KPI summary ----------

export interface Kpi {
  key: string
  label: string
  value: number
  /** Formatted display value is decided by the tile; this is the raw number. */
  unit: 'count' | 'percent' | 'minutes'
  /** Percentage-point or relative change vs the previous period. */
  deltaPct: number | null
  /** Whether an increase is a good thing — drives delta colour + direction. */
  higherIsBetter: boolean
  /** True when the number leans on the assumed production volume. */
  assumed: boolean
  /** Trailing series for the sparkline (oldest → newest). */
  spark: number[]
}

/**
 * Builds the five headline KPIs, comparing the most recent week against the
 * one before it. Returns nulls for delta when there's no prior week rather
 * than inventing a comparison.
 */
export function buildKpis(records: KskRecord[]): Kpi[] {
  // Rates and deltas come from COMPLETE weeks only — see completeWeeks().
  // Counts (total reworked, total defects) still reflect everything, because
  // "how many are there right now" is a live question, not a weekly one.
  const weeks = completeWeeks(weeklyBuckets(records))
  const current = weeks.at(-1)
  const previous = weeks.at(-2)

  const spark = (pick: (w: WeekBucket) => number) =>
    weeks.slice(-12).map(pick).map((v) => (Number.isFinite(v) ? v : 0))

  const delta = (pick: (w: WeekBucket) => number): number | null => {
    if (!current || !previous) return null
    const before = pick(previous)
    const after = pick(current)
    if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return null
    return ((after - before) / before) * 100
  }

  const closedRecords = records.filter((r) => !isOpen(r))

  return [
    {
      key: 'reworked',
      label: 'Total reworked quantity',
      value: records.length,
      unit: 'count',
      deltaPct: delta((w) => w.total),
      higherIsBetter: false,
      assumed: false,
      spark: spark((w) => w.total),
    },
    {
      key: 'reworkRate',
      label: 'Rework rate',
      value: current?.reworkRatePct ?? NaN,
      unit: 'percent',
      deltaPct: delta((w) => w.reworkRatePct),
      higherIsBetter: false,
      assumed: true,
      spark: spark((w) => w.reworkRatePct),
    },
    {
      key: 'defects',
      label: 'Total defects',
      value: records.reduce((sum, r) => sum + r.errorCodes.length, 0),
      unit: 'count',
      deltaPct: delta((w) => w.defects),
      higherIsBetter: false,
      assumed: false,
      spark: spark((w) => w.defects),
    },
    {
      key: 'leadTime',
      label: 'Avg rework lead time',
      value: mean(closedRecords.map((r) => elapsedMinutes(r))),
      unit: 'minutes',
      deltaPct: delta((w) => w.avgDurationMinutes),
      higherIsBetter: false,
      assumed: false,
      spark: spark((w) => w.avgDurationMinutes),
    },
    {
      key: 'fpy',
      label: 'First pass yield',
      value: current?.firstPassYieldPct ?? NaN,
      unit: 'percent',
      deltaPct: delta((w) => w.firstPassYieldPct),
      higherIsBetter: true,
      assumed: true,
      spark: spark((w) => w.firstPassYieldPct),
    },
  ]
}

/**
 * Flags a series point as anomalous when it sits more than `sigma` standard
 * deviations from the mean of the preceding points. Deliberately conservative:
 * needs at least 4 prior points and a non-zero spread, so a short or flat
 * series never lights up the whole chart.
 */
export function anomalyIndices(values: number[], sigma = 2): Set<number> {
  const flagged = new Set<number>()
  if (values.length < 5) return flagged

  for (let i = 4; i < values.length; i++) {
    const prior = values.slice(0, i).filter(Number.isFinite)
    if (prior.length < 4) continue
    const avg = mean(prior)
    const variance = mean(prior.map((v) => (v - avg) ** 2))
    const sd = Math.sqrt(variance)
    if (!Number.isFinite(sd) || sd === 0) continue
    if (Math.abs(values[i] - avg) > sigma * sd) flagged.add(i)
  }
  return flagged
}
