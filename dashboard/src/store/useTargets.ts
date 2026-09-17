import { KPI_TARGETS } from '@/lib/config'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Quality targets, editable on the KPI page. `null` means no target is set:
 * the metric is still charted, but nothing is flagged against it.
 */
export interface Targets {
  /** Max reworks per week — measured, no assumption involved. */
  weeklyReworkQty: number | null
  /** Max mean rework lead time, minutes. */
  avgLeadTimeMinutes: number | null
  /** Max rework rate, % — estimated against the assumed production volume. */
  reworkRatePct: number | null
  /** Min first pass yield, % — estimated against the assumed production volume. */
  firstPassYieldPct: number | null
}

export type TargetKey = keyof Targets

export const DEFAULT_TARGETS: Targets = {
  // No sensible default without knowing the line's volume — set on the KPI page.
  weeklyReworkQty: null,
  avgLeadTimeMinutes: KPI_TARGETS.avgLeadTimeMinutes,
  reworkRatePct: KPI_TARGETS.reworkRatePct,
  firstPassYieldPct: KPI_TARGETS.firstPassYieldPct,
}

interface TargetsState {
  targets: Targets
  setTarget: (key: TargetKey, value: number | null) => void
  reset: () => void
}

/**
 * Persisted per browser. There is no user system behind this dashboard, and a
 * shared server-side setting would let one person's experiment move the
 * red/green state on every screen in the plant.
 */
export const useTargets = create<TargetsState>()(
  persist(
    (set, get) => ({
      targets: DEFAULT_TARGETS,
      setTarget: (key, value) => set({ targets: { ...get().targets, [key]: value } }),
      reset: () => set({ targets: DEFAULT_TARGETS }),
    }),
    {
      name: 'ksk-dashboard-targets',
      version: 1,
      // Keys added in later versions fall back to their defaults.
      merge: (persisted, current) => ({
        ...current,
        targets: { ...DEFAULT_TARGETS, ...((persisted as Partial<TargetsState>)?.targets ?? {}) },
      }),
    },
  ),
)

/** Whether `value` misses `target`, given which direction is good. */
export function missesTarget(value: number, target: number | null, higherIsBetter: boolean): boolean {
  if (target === null || !Number.isFinite(value)) return false
  return higherIsBetter ? value < target : value > target
}
