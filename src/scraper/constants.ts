/**
 * Site model codes.
 *
 * CONFIRMED against the live site: the Details search form POSTs the codes
 * MAM / MCM, while every dashboard and report refers to the same two
 * programmes by their project names MMA / MBEAM.
 */
export const KSK_MODELS = ['MAM', 'MCM'] as const;

export type KskModel = (typeof KSK_MODELS)[number];

/** Site code -> the project name people actually use for it. */
export const MODEL_PROJECTS = {
  MAM: 'MMA',
  MCM: 'MBEAM',
} as const satisfies Record<KskModel, string>;

export type ProjectName = (typeof MODEL_PROJECTS)[KskModel];

export function projectFor(model: KskModel): ProjectName {
  return MODEL_PROJECTS[model];
}

// ---------------------------------------------------------------------------
// Scheduling
//
// Read from the environment at import time. main.ts loads .env before any
// module is imported, and @Interval() captures its delay when the class is
// defined — so these must be plain constants, resolved early.
// ---------------------------------------------------------------------------

const LIVE = (process.env.SCRAPER_MODE ?? 'mock').toLowerCase() === 'live';

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * How often the list page is downloaded.
 *
 * Live defaults to 60s — the same cadence as the relay already running in the
 * plant. The real list page is the full history (~700 KB per model), so the
 * mock's 15s would mean ~5 MB/min against a shared legacy PHP server.
 */
export const FAST_SCAN_INTERVAL_MS = envNumber('FAST_SCAN_INTERVAL_MS', LIVE ? 60_000 : 15_000);

/** How often a detail-fetch cycle starts. Cycles never overlap (see scheduler). */
export const DETAIL_CYCLE_INTERVAL_MS = envNumber('DETAIL_CYCLE_INTERVAL_MS', LIVE ? 30_000 : 45_000);

/** Politeness delay between detail requests — the relay's proven value. */
export const DETAIL_FETCH_DELAY_MS = envNumber('DETAIL_FETCH_DELAY_MS', 150);

/** Detail requests per cycle — the relay's MAX_DETAIL_FETCH_PER_CYCLE. */
export const MAX_DETAIL_FETCH_PER_CYCLE = envNumber('MAX_DETAIL_FETCH_PER_CYCLE', 250);

/**
 * New rows are fetched in detail immediately (so they appear live) only while
 * there are this few of them. More than that is a backfill or a catch-up after
 * downtime, and goes to the throttled detail queue instead.
 */
export const INLINE_DETAIL_LIMIT = 10;

/** Open records registered within this window form the live watch-list. */
export const LIVE_WATCH_WINDOW_HOURS = 96;

/** How soon a live open record is re-checked for closure. */
export const OPEN_RECHECK_MS = envNumber('OPEN_RECHECK_MS', LIVE ? 60_000 : 45_000);

/** Records left open far longer than normal are re-checked rarely. */
export const STALE_OPEN_RECHECK_MS = envNumber('STALE_OPEN_RECHECK_MS', 6 * 3_600_000);

/** A detail fetch that failed is retried after this long, not every cycle. */
export const PENDING_RETRY_MS = envNumber('PENDING_RETRY_MS', 5 * 60_000);

/**
 * On the first live run, only history newer than this many days is ingested.
 * 0 = everything on the page (the default; ~6,000 records, a few minutes).
 */
export const BACKFILL_DAYS = envNumber('BACKFILL_DAYS', 0);
