/**
 * Site model codes.
 *
 * CONFIRMED against the production relay server running in the plant: the
 * Details search form POSTs the codes MAM / MCM, while every dashboard and
 * report refers to the same things by their project names MMA / MBEAM. Both
 * namings were in circulation — they are the same two programmes, not four.
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

export const FAST_SCAN_INTERVAL_MS = 15_000;
export const WATCHLIST_RECHECK_INTERVAL_MS = 45_000;

/**
 * Detail-page politeness settings, matching the production relay's proven
 * values. The legacy PHP app is a shared internal server — hammering it with
 * unthrottled detail fetches is the fastest way to get the scraper blocked or
 * to slow the tool down for the people who use it directly.
 */
export const DETAIL_FETCH_DELAY_MS = 150;
export const MAX_DETAIL_FETCH_PER_CYCLE = 250;
