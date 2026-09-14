import { fetchRecords } from '@/lib/api'
import { API_URL } from '@/lib/config'
import type { KskRecord } from '@/types'
import { io, type Socket } from 'socket.io-client'
import { create } from 'zustand'

export type ConnectionState = 'connecting' | 'live' | 'offline'

interface RecordsState {
  records: KskRecord[]
  loading: boolean
  error: string | null
  connection: ConnectionState
  lastUpdated: Date | null
  /** Record ids that just arrived/changed — drives the row pulse animation. */
  recentlyChanged: Set<number>
  load: () => Promise<void>
  connect: () => void
  disconnect: () => void
}

let socket: Socket | null = null
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
    recentlyChanged: new Set<number>(),

    async load() {
      set({ loading: true, error: null })
      try {
        // Always fetch the full set; the global model filter is applied
        // client-side so switching models is instant and doesn't refetch.
        const records = await fetchRecords()
        set({ records, loading: false, lastUpdated: new Date() })
      } catch (err) {
        set({
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load records',
        })
      }
    },

    connect() {
      if (socket) return
      socket = io(API_URL, { transports: ['websocket', 'polling'] })

      socket.on('connect', () => set({ connection: 'live' }))
      socket.on('disconnect', () => set({ connection: 'offline' }))
      socket.on('connect_error', () => set({ connection: 'offline' }))

      socket.on('record.new', upsert)
      socket.on('record.updated', upsert)
      // record.closed carries the same payload as the updated event that
      // precedes it; upserting twice is idempotent and keeps the pulse alive.
      socket.on('record.closed', upsert)
    },

    disconnect() {
      socket?.close()
      socket = null
      for (const timer of pulseTimers.values()) clearTimeout(timer)
      pulseTimers.clear()
      set({ connection: 'offline' })
    },
  }
})
