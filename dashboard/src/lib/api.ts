import type { KskRecord } from '@/types'
import { API_URL } from './config'

export async function fetchRecords(model?: string): Promise<KskRecord[]> {
  const url = new URL('/records', API_URL)
  if (model && model !== 'ALL') url.searchParams.set('model', model)

  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`GET /records failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as KskRecord[]
}
