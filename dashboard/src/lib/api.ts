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

export async function fetchRecords(model?: string): Promise<KskRecord[]> {
  const url = new URL('/records', API_URL)
  if (model && model !== 'ALL') url.searchParams.set('model', model)

  const response = await fetch(url, { headers: BASE_HEADERS })
  if (!response.ok) {
    throw new Error(`GET /records failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as KskRecord[]
}
