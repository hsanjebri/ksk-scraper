import { fetchRecords } from '@/lib/api'
import { API_URL } from '@/lib/config'
import {
  closeDemoRecord,
  generateDemoArrival,
  generateDemoRecords,
} from '@/lib/demo-data'
import type { KskRecord } from '@/types'
import { io, type Socket } from 'socket.io-client'
import { create } from 'zustand'

export type ConnectionState = 'connecting' | 'live' | 'offline' | 'demo'

interface RecordsState {
  records: KskRecord[]
  loading: boolean
  error: string | null
  connection: ConnectionState
  lastUpdated: Date | null
  /** True when showing generated data because no backend was reachable. */
  demo: boolean
  /** Record ids that just arrived/changed — drives the row pulse animation. */
  recentlyChanged: Set<number>
  load: () => Promise<void>
  connect: () => void
  disconnect: () => void
}

let socket: Socket | null = null
let demoTimer: ReturnType<typeof setInterval> | null = null
const pulseTimers = new Map<number, ReturnType<typeof setTimeout>>()

export const useRecords = create<RecordsState>((set, get) => {
  /** Inserts or replaces a record by id, newest-registered first. */
  const upsert = (incoming: KskRecord) => {
    const existing = get().records
    const index = existing.findIndex((r) => r.id === incoming.id)
    const next = index >= 0 ? existing.with(index, incoming) : [incoming, ...existing]

    const changed = new Set(get().recentlyChanged)
    changed.add(incoming.id)

    set({ records: next, lastUpdated: new Date(), recentlyChanged: changed })

    // Clear the pulse flag after the animation window so re-renders don't
    // replay it, and so the set doesn't grow without bound.
    clearTimeout(pulseTimers.get(incoming.id))
    pulseTimers.set(
      incoming.id,
      setTimeout(() => {
        const pruned = new Set(get().recentlyChanged)
        pruned.delete(incoming.id)
        pulseTimers.delete(incoming.id)
        set({ recentlyChanged: pruned })
      }, 2600),
    )
  }

  return {
    records: [],
    loading: true,
    error: null,
    connection: 'connecting',
    lastUpdated: null,
    demo: false,
    recentlyChanged: new Set<number>(),

    async load() {
      set({ loading: true, error: null })
      try {
        // Always fetch the full set; the global model filter is applied
        // client-side so switching models is instant and doesn't refetch.
        const records = await fetchRecords()
        set({ records, loading: false, demo: false, lastUpdated: new Date() })
      } catch {
        // No backend reachable. That is the normal case for a public deploy —
        // the real backend has to run inside the SEBN network and can never be
        // exposed here — so fall back to generated data instead of showing an
        // error page. The UI flags it clearly as demo data.
        set({
          records: generateDemoRecords(),
          loading: false,
          error: null,
          demo: true,
          connection: 'demo',
          lastUpdated: new Date(),
        })
      }
    },

    connect() {
      if (get().demo) {
        startDemoStream()
        return
      }
      if (socket) return
      socket = io(API_URL, {
        transports: ['websocket', 'polling'],
        extraHeaders: { 'ngrok-skip-browser-warning': '1' },
      })

      // Guarded on demo: a stray socket error must never relabel generated
      // data as merely "offline", which would hide that it isn't real.
      socket.on('connect', () => set({ connection: 'live' }))
      socket.on('disconnect', () => {
        if (!get().demo) set({ connection: 'offline' })
      })
      socket.on('connect_error', () => {
        if (!get().demo) set({ connection: 'offline' })
      })

      socket.on('record.new', upsert)
      socket.on('record.updated', upsert)
      // record.closed carries the same payload as the updated event that
      // precedes it; upserting twice is idempotent and keeps the pulse alive.
      socket.on('record.closed', upsert)
    },

    disconnect() {
      socket?.close()
      socket = null
      if (demoTimer) clearInterval(demoTimer)
      demoTimer = null
      for (const timer of pulseTimers.values()) clearTimeout(timer)
      pulseTimers.clear()
      set({ connection: get().demo ? 'demo' : 'offline' })
    },
  }

  /**
   * Simulates the backend's two schedulers so the demo still shows live
   * behaviour: a new record arriving, and an open one closing out. Without
   * this the WebSocket features (pulse rows, live counters) would look dead
   * on the public deploy.
   */
  function startDemoStream() {
    if (demoTimer) return
    let tick = 0
    demoTimer = setInterval(() => {
      tick += 1
      // New arrival roughly every 20s; a closure roughly every 40s — the same
      // rhythm as the real 15s/45s schedulers, slowed so it isn't distracting.
      if (tick % 2 === 1) {
        upsert(generateDemoArrival())
      } else {
        const open = get().records.find((record) => record.reworked === null)
        if (open) upsert(closeDemoRecord(open))
      }
    }, 20_000)
  }
})
