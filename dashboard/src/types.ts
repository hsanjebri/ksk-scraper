export type KskStatus = 'En cours' | 'Terminé'

export interface ErrorCodeEntry {
  id: number
  kskRecordId: number
  code: string
  description: string | null
  errorProducer: string | null
  partType: string | null
  partName: string | null
  cavity: string | null
  info: string | null
}

/**
 * Shape returned by GET /records and pushed over the WebSocket.
 *
 * `status`, `week` and `durationMinutes` are computed server-side. Note that
 * for an open record the server's `durationMinutes` is a snapshot taken at
 * response time — the UI recomputes elapsed time from `registered` so the
 * live table keeps ticking. See `elapsedMinutes()` in lib/metrics.
 */
export interface KskRecord {
  id: number
  no: string
  model: string
  carId: string
  zsb: string
  registered: string
  reworked: string | null
  qualityControlDate: string | null
  defectShift: string | null
  detectShift: string | null
  defectBy: string | null
  errorCode: string | null
  partType: string | null
  partName: string | null
  description: string | null
  comment: string | null
  color: string | null
  errorCodes: ErrorCodeEntry[]
  status: KskStatus
  week: string
  durationMinutes: number
}
