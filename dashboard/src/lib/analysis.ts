import type { KskRecord } from '@/types'
import { allErrorEntries, countBy, elapsedMinutes, isOpen, mean } from './metrics'

// ---------- duration distribution ----------

export interface DurationBin {
  label: string
  /** Lower bound in minutes, inclusive. */
  from: number
  /** Upper bound in minutes, exclusive. Infinity for the final overflow bin. */
  to: number
  countByModel: Record<string, number>
  total: number
}

const BIN_EDGES = [0, 30, 60, 120, 180, 240, 360, 480, 720, Infinity]

function binLabel(from: number, to: number): string {
  if (to === Infinity) return `${from / 60}h+`
  if (to <= 60) return `${from}–${to}m`
  return `${from / 60}–${to / 60}h`
}

/**
 * Histogram of how long closed reworks actually took, split by model.
 *
 * Only closed records are binned — an open record's duration is still moving,
 * so including it would put a value in a bin it may not belong to by the time
 * anyone reads the chart.
 */
export function durationHistogram(records: KskRecord[], models: string[]): DurationBin[] {
  const bins: DurationBin[] = []
  for (let i = 0; i < BIN_EDGES.length - 1; i++) {
    const from = BIN_EDGES[i]
    const to = BIN_EDGES[i + 1]
    bins.push({
      label: binLabel(from, to),
      from,
      to,
      countByModel: Object.fromEntries(models.map((m) => [m, 0])),
      total: 0,
    })
  }

  for (const record of records) {
    if (isOpen(record)) continue
    const minutes = elapsedMinutes(record)
    const bin = bins.find((b) => minutes >= b.from && minutes < b.to)
    if (!bin) continue
    bin.countByModel[record.model] = (bin.countByModel[record.model] ?? 0) + 1
    bin.total += 1
  }

  return bins
}

// ---------- status over time ----------

export interface StatusWeek {
  week: string
  open: number
  closed: number
}

export function statusByWeek(records: KskRecord[]): StatusWeek[] {
  const byWeek = new Map<string, StatusWeek>()
  for (const record of records) {
    let bucket = byWeek.get(record.week)
    if (!bucket) {
      bucket = { week: record.week, open: 0, closed: 0 }
      byWeek.set(record.week, bucket)
    }
    if (isOpen(record)) bucket.open += 1
    else bucket.closed += 1
  }
  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week))
}

// ---------- shift comparison ----------

export interface ShiftRow {
  shift: string
  /** Records whose DEFECT was produced on this shift. */
  defect: number
  /** Records whose defect was DETECTED on this shift. */
  detect: number
  avgDurationMinutes: number
}

/**
 * Volume by shift, counted two ways: the shift that produced the defect and
 * the shift that caught it. Those are different questions — a shift that
 * detects a lot isn't necessarily a shift that causes a lot — so they're shown
 * as two series rather than collapsed into one number.
 */
export function shiftComparison(records: KskRecord[]): ShiftRow[] {
  const shifts = [
    ...new Set(
      records.flatMap((r) => [r.defectShift, r.detectShift]).filter((s): s is string => Boolean(s)),
    ),
  ].sort()

  return shifts.map((shift) => {
    const defectRows = records.filter((r) => r.defectShift === shift)
    const closed = defectRows.filter((r) => !isOpen(r))
    return {
      shift,
      defect: defectRows.length,
      detect: records.filter((r) => r.detectShift === shift).length,
      avgDurationMinutes: mean(closed.map((r) => elapsedMinutes(r))),
    }
  })
}

// ---------- team performance ----------

export interface TeamRow {
  team: string
  count: number
  closed: number
  open: number
  avgDurationMinutes: number
  /** Share of this team's records that are still open. */
  openRatePct: number
}

export function teamPerformance(records: KskRecord[]): TeamRow[] {
  const byTeam = new Map<string, KskRecord[]>()
  for (const record of records) {
    const team = record.defectBy
    if (!team) continue
    const list = byTeam.get(team)
    if (list) list.push(record)
    else byTeam.set(team, [record])
  }

  return [...byTeam.entries()]
    .map(([team, rows]) => {
      const closed = rows.filter((r) => !isOpen(r))
      return {
        team,
        count: rows.length,
        closed: closed.length,
        open: rows.length - closed.length,
        avgDurationMinutes: mean(closed.map((r) => elapsedMinutes(r))),
        openRatePct: ((rows.length - closed.length) / rows.length) * 100,
      }
    })
    .sort((a, b) => b.count - a.count)
}

// ---------- pareto ----------

export interface ParetoRow {
  code: string
  description: string
  count: number
  cumulative: number
  cumulativePct: number
}

/**
 * Defect codes ranked by frequency with a running cumulative total.
 *
 * `cumulative` is kept as a COUNT, not a percentage, on purpose — it lets the
 * chart plot bars and the cumulative line on a single shared y-axis instead of
 * inventing a second one. The percentage is carried alongside for labels and
 * tooltips, where it doesn't need its own scale.
 */
export function paretoByErrorCode(records: KskRecord[]): ParetoRow[] {
  const entries = allErrorEntries(records)
  const counts = countBy(entries, ({ entry }) => entry.code)

  // First description seen per code — they're consistent per code in practice.
  const descriptions = new Map<string, string>()
  for (const { entry } of entries) {
    if (entry.code && !descriptions.has(entry.code)) {
      descriptions.set(entry.code, entry.description ?? '')
    }
  }

  const total = [...counts.values()].reduce((sum, v) => sum + v, 0)
  let running = 0

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => {
      running += count
      return {
        code,
        description: descriptions.get(code) ?? '',
        count,
        cumulative: running,
        cumulativePct: total === 0 ? 0 : (running / total) * 100,
      }
    })
}

// ---------- rankings ----------

export interface RankedRow {
  key: string
  secondary: string
  count: number
  avgDurationMinutes: number
}

/** Most-reworked parts, ranked. */
export function topParts(records: KskRecord[], limit = 10): RankedRow[] {
  const byPart = new Map<string, KskRecord[]>()
  for (const record of records) {
    const name = record.partName
    if (!name) continue
    const list = byPart.get(name)
    if (list) list.push(record)
    else byPart.set(name, [record])
  }

  return [...byPart.entries()]
    .map(([name, rows]) => ({
      key: name,
      secondary: rows[0].partType ?? '—',
      count: rows.length,
      avgDurationMinutes: mean(rows.filter((r) => !isOpen(r)).map((r) => elapsedMinutes(r))),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/**
 * CarIDs that came back most often. A CarID appearing more than once means the
 * same physical car was reworked repeatedly — the strongest signal of an
 * unresolved root cause, so repeats are worth surfacing on their own.
 */
export function topCars(records: KskRecord[], limit = 10): RankedRow[] {
  const byCar = new Map<string, KskRecord[]>()
  for (const record of records) {
    const list = byCar.get(record.carId)
    if (list) list.push(record)
    else byCar.set(record.carId, [record])
  }

  return [...byCar.entries()]
    .map(([carId, rows]) => ({
      key: carId,
      secondary: rows[0].model,
      count: rows.length,
      avgDurationMinutes: mean(rows.filter((r) => !isOpen(r)).map((r) => elapsedMinutes(r))),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit)
}
