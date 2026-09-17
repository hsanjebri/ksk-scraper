import { fetchStatus, type ScraperStatus } from '@/lib/api'
import { create } from 'zustand'

interface SyncStatusState {
  status: ScraperStatus | null
  start: () => void
  stop: () => void
}

let pollTimer: ReturnType<typeof setTimeout> | null = null
let running = false

/** Poll faster while history is still being synced, slowly once it's done. */
const SYNCING_POLL_MS = 5_000
const IDLE_POLL_MS = 60_000

/**
 * Scraper health from GET /records/status.
 *
 * Matters most on a first start in the plant: the scraper stores the site's
 * whole history (~6,000 records) from the list pages in seconds, then fetches
 * each detail page at a throttled pace so it doesn't hammer the rework server.
 * Records only appear on the dashboard once their detail page is in, so
 * without this a half-empty dashboard would look broken instead of busy.
 */
export const useSyncStatus = create<SyncStatusState>((set, get) => ({
  status: null,

  start() {
    if (running) return
    running = true

    const tick = async () => {
      try {
        set({ status: await fetchStatus() })
      } catch {
        // An older backend without the endpoint, or a blip — keep the last
        // known status rather than flashing the badge away.
      }
      if (!running) return
      const syncing = (get().status?.counts.pending ?? 0) > 0
      pollTimer = setTimeout(tick, syncing ? SYNCING_POLL_MS : IDLE_POLL_MS)
    }
    void tick()
  },

  stop() {
    running = false
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
  },
}))
