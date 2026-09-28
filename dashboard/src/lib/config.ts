/**
 * The API is reached through the dashboard's own origin at /api — a Vercel
 * rewrite in production, the Vite proxy in development. Keeping it same-origin
 * is what lets the session cookie be first-party, HttpOnly and SameSite=Strict
 * instead of a third-party cookie that browsers block.
 */
export const API_BASE = '/api'

/**
 * The live socket cannot go through that proxy (Vercel rewrites do not carry
 * WebSockets), so it connects to the backend host directly, authenticated by
 * a one-minute ticket. Empty = same origin (development, via the Vite proxy).
 * VITE_API_URL is still honoured here so existing deployments keep working.
 */
export const SOCKET_URL: string =
  import.meta.env.VITE_SOCKET_URL ?? import.meta.env.VITE_API_URL ?? ''

/**
 * Generated demo data when the backend cannot be reached. Off unless set to
 * "true": a production dashboard must say "unavailable", not show invented
 * numbers that look real.
 */
export const ALLOW_DEMO = import.meta.env.VITE_ALLOW_DEMO === 'true'

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
