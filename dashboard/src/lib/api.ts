import type { KskRecord } from '@/types'
import { API_BASE } from './config'

/** The session is missing or expired — the app should show the sign-in page. */
export class UnauthorizedError extends Error {
  constructor() {
    super('Not signed in')
  }
}

/** The backend answered with an error, or could not be reached at all. */
export class ApiUnavailableError extends Error {}

/**
 * Every call goes to the same origin, with the session cookie attached by the
 * browser. The cookie is HttpOnly: this code never sees or stores it.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiUnavailableError('The server could not be reached')
  }

  if (response.status === 401) throw new UnauthorizedError()
  if (!response.ok) throw new ApiUnavailableError(`${init.method ?? 'GET'} ${path} failed: ${response.status}`)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
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

export const fetchStatus = () => request<ScraperStatus>('/records/status')

export const fetchRecords = () => request<KskRecord[]>('/records')

export const fetchCurrentUser = () => request<{ user: string }>('/auth/me')

export const fetchSocketTicket = () => request<{ ticket: string }>('/auth/ws-ticket')

export type SignInOutcome = 'ok' | 'invalid' | 'locked' | 'unavailable'

export async function signInRequest(username: string, password: string): Promise<SignInOutcome> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  } catch {
    return 'unavailable'
  }
  if (response.status === 204) return 'ok'
  if (response.status === 401 || response.status === 400) return 'invalid'
  if (response.status === 429) return 'locked'
  return 'unavailable'
}

export async function signOutRequest(): Promise<void> {
  try {
    await request('/auth/logout', { method: 'POST' })
  } catch {
    // The local state is cleared regardless; the cookie expires on its own.
  }
}
