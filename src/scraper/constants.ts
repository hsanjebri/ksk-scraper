export const KSK_MODELS = ['MAM', 'MCM'] as const;

export type KskModel = (typeof KSK_MODELS)[number];

export const FAST_SCAN_INTERVAL_MS = 15_000;
export const WATCHLIST_RECHECK_INTERVAL_MS = 45_000;
