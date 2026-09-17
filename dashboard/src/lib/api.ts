import type { KskRecord } from '@/types'
import { API_URL } from './config'

/**
 * Base headers for every API request.
 * `ngrok-skip-browser-warning` bypasses the ngrok free-tier interstitial page
 * that is injected for browser requests — without it the browser gets back an
 * HTML page with no CORS headers, and the request fails before the backend
 * is ever reached.
 */
const BASE_HEADERS: HeadersInit = {
  Accept: 'application/json',
  'ngrok-skip-browser-warning': '1',
}

/** GET /records/status — scraper health and first-sync progress. */
export interface ScraperStatus {
  /** `relay` = pages are pushed by the agent running inside the SEBN network. */
  mode: 'live' | 'mock' | 'relay'
  startedAt: string
  charset: string | null
  /** Last contact from that agent; null when nothing has ever pushed. */
  agent: { name: string | null; lastSeenAt: string } | null
  lists: Record<string, { lastScanAt: string | null; rowsOnPage: number; lastError: string | null }>
  detail: {
    fetched: number
    failed: number
    durationMs: number
    lastCycleAt: string | null
    lastError: string | null
    totalFetched: number
    totalFailed: number
  }
  counts: {
    total: number
    /** Detail page fetched — visible on the dashboard. */
    ready: number
    /** Known from the list page only — still being fetched, hidden. */
    pending: number
    open: number
    byModel: Record<string, { total: number; pending: number }>
  }
}

export async function fetchStatus(): Promise<ScraperStatus> {
  const response = await fetch(new URL('/records/status', API_URL), { headers: BASE_HEADERS })
  if (!response.ok) {
    throw new Error(`GET /records/status failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as ScraperStatus
}

export async function fetchRecords(model?: string): Promise<KskRecord[]> {
  const url = new URL('/records', API_URL)
  if (model && model !== 'ALL') url.searchParams.set('model', model)

  const response = await fetch(url, { headers: BASE_HEADERS })
  if (!response.ok) {
    throw new Error(`GET /records failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as KskRecord[]
}
