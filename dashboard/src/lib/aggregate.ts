import type { KskRecord } from '@/types'
import { countBy, elapsedMinutes, isOpen, mean, topNWithOther, type Bucket } from './metrics'

/**
 * Aggregations behind the Defects and Trends pages.
 *
 * Several of these mirror views the plant's existing relay dashboards already
 * show (Quality Gate breakdown, monthly quantity, average rework time, MMA vs
 * MBEAM) so this dashboard is a superset of what people there already rely on,
 * rather than a differently-shaped replacement.
 */

// ---------- monthly ----------

export interface MonthBucket {
  /** Sort key, `YYYY-MM`. */
  month: string
  /** Display label, e.g. "Sep 26". */
  label: string
  total: number
  closed: number
  open: number
  defects: number
  avgDurationMinutes: number
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthKey(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-')
  return `${MONTH_NAMES[Number(month) - 1]} ${year.slice(2)}`
}

export function monthlyBuckets(records: KskRecord[]): MonthBucket[] {
  const byMonth = new Map<string, KskRecord[]>()
  for (const record of records) {
    const key = monthKey(record.registered)
    if (!key) continue
    const list = byMonth.get(key)
    if (list) list.push(record)
    else byMonth.set(key, [record])
  }

  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, rows]) => {
      const closed = rows.filter((r) => !isOpen(r))
      return {
        month,
        label: monthLabel(month),
        total: rows.length,
        closed: closed.length,
        open: rows.length - closed.length,
        defects: rows.reduce((sum, r) => sum + r.errorCodes.length, 0),
        avgDurationMinutes: mean(closed.map((r) => elapsedMinutes(r))),
      }
    })
}

// ---------- average rework time over time ----------

export interface PeriodPoint {
  key: string
  label: string
  avgDurationMinutes: number
  /** How many CLOSED records the average is built from. */
  sample: number
}

/**
 * Average rework duration per period.
 *
 * Open records are excluded: their clock is still running, so including them
 * would drag every current period downward and make the trend look like it is
 * improving simply because recent work hasn't finished yet.
 */
export function avgDurationByPeriod(
  records: KskRecord[],
  period: 'week' | 'month',
): PeriodPoint[] {
  const closed = records.filter((r) => !isOpen(r))
  const groups = new Map<string, number[]>()

  for (const record of closed) {
    const key = period === 'week' ? record.week : monthKey(record.registered)
    if (!key) continue
    const list = groups.get(key)
    if (list) list.push(elapsedMinutes(record))
    else groups.set(key, [elapsedMinutes(record)])
  }

  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, durations]) => ({
      key,
      label: period === 'week' ? key.replace(/^\d{4}-/, '') : monthLabel(key),
      avgDurationMinutes: mean(durations),
      sample: durations.length,
    }))
}

// ---------- quality gate ----------

/**
 * Where defects are caught. Only the live scraper populates `qualityGate`, so
 * this is empty until the real detail page is being parsed — the page shows an
 * empty state rather than pretending the data exists.
 */
export function qualityGateCounts(records: KskRecord[], limit = 6): Bucket[] {
  const counts = countBy(records, (r) => r.qualityGate)
  return topNWithOther(counts, limit)
}

// ---------- model / project comparison ----------

export interface ComparisonSeries {
  periods: string[]
  series: { key: string; values: number[] }[]
}

/**
 * Per-model counts across a shared period axis.
 *
 * Every model gets the same period list (zero-filled) so the two lines stay
 * comparable — without that, a model with no records in a week would shift its
 * own series left and silently misalign against the other.
 */
export function countsByModelOverPeriods(
  records: KskRecord[],
  models: string[],
  period: 'week' | 'month',
): ComparisonSeries {
  const keyOf = (r: KskRecord) => (period === 'week' ? r.week : monthKey(r.registered))

  const periods = [...new Set(records.map(keyOf).filter((k): k is string => Boolean(k)))].sort()

  const series = models.map((model) => {
    const counts = new Map<string, number>()
    for (const record of records) {
      if (record.model !== model) continue
      const key = keyOf(record)
      if (!key) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return { key: model, values: periods.map((p) => counts.get(p) ?? 0) }
  })

  const labels = periods.map((p) =>
    period === 'week' ? p.replace(/^\d{4}-/, '') : monthLabel(p),
  )

  return { periods: labels, series }
}

// ---------- defect heatmap ----------

export interface Heatmap {
  days: string[]
  shifts: string[]
  /** [dayIndex, shiftIndex, count] — ECharts heatmap order. */
  cells: [number, number, number][]
  max: number
  total: number
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * When defects cluster: day of week x shift.
 *
 * Day is taken from `registered` and remapped so Monday is index 0 — a factory
 * week does not start on Sunday, and leaving JS's Sunday-first order would put
 * the weekend in the middle of the grid.
 */
export function defectHeatmap(records: KskRecord[]): Heatmap {
  const shifts = [...new Set(records.map((r) => r.defectShift).filter((s): s is string => Boolean(s)))].sort()

  const counts = new Map<string, number>()
  let total = 0

  for (const record of records) {
    if (!record.defectShift) continue
    const d = new Date(record.registered)
    if (Number.isNaN(d.getTime())) continue
    const dayIndex = (d.getDay() + 6) % 7 // Sunday(0) -> 6, Monday(1) -> 0
    const shiftIndex = shifts.indexOf(record.defectShift)
    if (shiftIndex < 0) continue
    const key = `${dayIndex}:${shiftIndex}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
    total += 1
  }

  const cells: [number, number, number][] = []
  let max = 0
  for (let day = 0; day < DAY_LABELS.length; day++) {
    for (let shift = 0; shift < shifts.length; shift++) {
      const count = counts.get(`${day}:${shift}`) ?? 0
      cells.push([day, shift, count])
      if (count > max) max = count
    }
  }

  return { days: DAY_LABELS, shifts: shifts.map((s) => `Shift ${s}`), cells, max, total }
}

// ---------- error code frequency (searchable table) ----------

export interface ErrorCodeRow {
  code: string
  description: string
  count: number
  /** Share of all defect entries, 0-100. */
  sharePct: number
  /** Occurrences in the most recent week vs the one before, for a trend arrow. */
  trend: 'up' | 'down' | 'flat'
}

export function errorCodeFrequency(records: KskRecord[]): ErrorCodeRow[] {
  const weeks = [...new Set(records.map((r) => r.week))].sort()
  const latest = weeks.at(-1)
  const previous = weeks.at(-2)

  const counts = new Map<string, number>()
  const descriptions = new Map<string, string>()
  const latestCounts = new Map<string, number>()
  const previousCounts = new Map<string, number>()

  for (const record of records) {
    for (const entry of record.errorCodes) {
      if (!entry.code) continue
      counts.set(entry.code, (counts.get(entry.code) ?? 0) + 1)
      if (!descriptions.has(entry.code) && entry.description) {
        descriptions.set(entry.code, entry.description)
      }
      if (record.week === latest) {
        latestCounts.set(entry.code, (latestCounts.get(entry.code) ?? 0) + 1)
      } else if (record.week === previous) {
        previousCounts.set(entry.code, (previousCounts.get(entry.code) ?? 0) + 1)
      }
    }
  }

  const total = [...counts.values()].reduce((sum, v) => sum + v, 0) || 1

  return [...counts.entries()]
    .map(([code, count]) => {
      const now = latestCounts.get(code) ?? 0
      const before = previousCounts.get(code) ?? 0
      return {
        code,
        description: descriptions.get(code) ?? '',
        count,
        sharePct: (count / total) * 100,
        trend: now > before ? 'up' : now < before ? 'down' : 'flat',
      } as ErrorCodeRow
    })
    .sort((a, b) => b.count - a.count)
}

// ---------- part breakdown ----------

export function partTypeCounts(records: KskRecord[], limit = 8): Bucket[] {
  return topNWithOther(countBy(records, (r) => r.partType), limit)
}
