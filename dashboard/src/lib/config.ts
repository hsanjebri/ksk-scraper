export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

/**
 * ⚠️ ASSUMPTION — replace with a real production feed.
 *
 * Rework Rate and First Pass Yield are both ratios against *units produced*,
 * and the rework/KSK system only knows about units that FAILED. There is no
 * production-volume source wired up yet, so these two KPIs are computed
 * against this assumed throughput.
 *
 * Every KPI derived from it is tagged `assumed: true` and rendered with a
 * visible "est." marker in the UI, so nobody reports these numbers upward
 * believing they're measured. Once a real production count is available
 * (MES export, line counter, ERP), swap this for that feed and drop the flag.
 */
export const ASSUMED_UNITS_PRODUCED_PER_DAY = 420

/** Thresholds used for target/anomaly colouring on the KPI cards. */
export const KPI_TARGETS = {
  reworkRatePct: 2.0,
  firstPassYieldPct: 98.0,
  avgLeadTimeMinutes: 180,
}

/** Elapsed-time urgency bands for the "currently in rework" table (minutes). */
export const URGENCY_BANDS = {
  warning: 60,
  critical: 180,
}
