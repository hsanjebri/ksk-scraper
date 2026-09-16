import type { ErrorCodeEntry, KskRecord } from '@/types'
import { isoWeekLabel } from './metrics'

/**
 * Client-side stand-in for the backend, used ONLY when the API is unreachable
 * (e.g. the public Vercel deploy, where there is no backend and never can be —
 * the scraper has to live inside the SEBN network).
 *
 * It mirrors the backend's mock generator deliberately: same weighted error
 * codes, same part pairings, same shift correlation. A demo that looked
 * different from the real thing would teach people the wrong shape of the data.
 */

const MODELS = ['MAM', 'MCM']
const ZSB = ['ZSB-100', 'ZSB-110', 'ZSB-204', 'ZSB-317', 'ZSB-402', 'ZSB-509']
const COLORS = ['Black', 'White', 'Grey', 'Red', 'Blue', 'Silver']
const SHIFTS = ['1', '2', '3']
const OPERATORS = ['J. Kowalski', 'A. Nowak', 'M. Wisniewski', 'P. Zielinski', 'K. Wojcik']
const PRODUCERS = ['Line 1', 'Line 2', 'Supplier X', 'Supplier Y', 'Assembly Station 4']
const CAVITIES = ['1', '2', '3', 'A1', 'B2', 'C3']
const INFO = ['Repeat defect', 'First occurrence', 'Known issue #4471', '']
/** Mirrors the backend mock so the Quality Gate chart has data in demo mode. */
const QUALITY_GATES = ['EOL Test', 'Visual Inspection', 'Electrical Test', 'Final Audit', 'Customer Line']
const COMMENTS = [
  'Checked against reference, wiring confirmed damaged.',
  'Awaiting replacement part from stock.',
  'Reworked per standard procedure.',
  'Escalated to quality for review.',
  '',
]
const DESCRIPTIONS = [
  'Continuity failure detected during end-of-line test.',
  'Connector pin bent during assembly, replaced.',
  'Sensor reading out of tolerance range.',
  'Short circuit found on harness segment.',
  'Loose crimp connection on terminal.',
]

const PARTS: { type: string; names: string[] }[] = [
  { type: 'Wiring Harness', names: ['Main Harness Front', 'Main Harness Rear', 'Door Harness LH'] },
  { type: 'Connector', names: ['Connector 24-pin', 'Connector 8-pin', 'Inline Connector B'] },
  { type: 'Sensor Bracket', names: ['Bracket Left Rear', 'Bracket Right Front'] },
  { type: 'Fuse Box', names: ['Fuse Box Assembly', 'Fuse Carrier 12V'] },
  { type: 'Relay Module', names: ['Relay Module A3', 'Relay Module B1'] },
]

/** Skewed on purpose — a flat distribution makes the Pareto chart pointless. */
// Real codes and real frequencies, from a capture of the live results page —
// bare numbers, with 151/153/140 dominating.
const WEIGHTED_CODES: { code: string; weight: number }[] = [
  { code: '151', weight: 30 },
  { code: '153', weight: 22 },
  { code: '140', weight: 20 },
  { code: '152', weight: 14 },
  { code: '520', weight: 13 },
  { code: '510', weight: 10 },
  { code: '160', weight: 9 },
  { code: '150', weight: 5 },
  { code: '500', weight: 4 },
  { code: '40', weight: 4 },
  { code: '141', weight: 2 },
  { code: '120', weight: 1 },
]
const WEIGHT_TOTAL = WEIGHTED_CODES.reduce((sum, c) => sum + c.weight, 0)

const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min

function weightedCode(): string {
  let roll = Math.random() * WEIGHT_TOTAL
  for (const entry of WEIGHTED_CODES) {
    roll -= entry.weight
    if (roll <= 0) return entry.code
  }
  return WEIGHTED_CODES[0].code
}

function randomPart() {
  const group = pick(PARTS)
  return { type: group.type, name: pick(group.names) }
}

const LIVE_WINDOW_HOURS = 96
const HISTORY_HOURS = 12 * 7 * 24

let nextId = 1
const seenCars = new Map<string, string[]>()

function carIdFor(model: string): string {
  const seen = seenCars.get(model) ?? []
  if (seen.length > 5 && Math.random() < 0.22) return pick(seen)
  const carId = `${model}-${randomInt(10000, 99999)}`
  seen.push(carId)
  seenCars.set(model, seen)
  return carId
}

function buildRecord(model: string, maxHoursAgo: number, forceOpen = false): KskRecord {
  const hoursAgo = randomInt(1, maxHoursAgo)
  const registered = new Date(Date.now() - hoursAgo * 3_600_000 - randomInt(0, 59) * 60_000)

  // Only recent records stay open — a six-week-old "En cours" would be nonsense
  // and would wreck the lead-time average.
  const open = (forceOpen || Math.random() < 0.35) && hoursAgo < LIVE_WINDOW_HOURS
  const reworked = open ? null : new Date(registered.getTime() + randomInt(20, 600) * 60_000)

  const part = randomPart()
  const defectShift = pick(SHIFTS)
  const id = nextId++

  const errorCodes: ErrorCodeEntry[] = Array.from({ length: randomInt(1, 3) }, (_, i) => {
    const entryPart = randomPart()
    return {
      id: id * 10 + i,
      kskRecordId: id,
      code: weightedCode(),
      description: pick(DESCRIPTIONS),
      errorProducer: pick(PRODUCERS),
      partType: entryPart.type,
      partName: entryPart.name,
      cavity: pick(CAVITIES),
      info: pick(INFO),
    }
  })

  const record: KskRecord = {
    id,
    no: String(100_000 + id),
    model,
    carId: carIdFor(model),
    zsb: pick(ZSB),
    registered: registered.toISOString(),
    reworked: reworked ? reworked.toISOString() : null,
    qualityControlDate: reworked
      ? new Date(reworked.getTime() + 30 * 60_000).toISOString()
      : null,
    defectShift,
    detectShift: Math.random() < 0.65 ? defectShift : pick(SHIFTS),
    defectBy: pick(OPERATORS),
    errorCode: weightedCode(),
    partType: part.type,
    partName: part.name,
    description: pick(DESCRIPTIONS),
    comment: pick(COMMENTS),
    color: pick(COLORS),
    qualityGate: pick(QUALITY_GATES),
    errorCodes,
    status: reworked ? 'Terminé' : 'En cours',
    week: isoWeekLabel(registered),
    durationMinutes: Math.max(
      0,
      Math.round(((reworked ? reworked.getTime() : Date.now()) - registered.getTime()) / 60_000),
    ),
  }
  return record
}

/** ~120 records across ~12 weeks, matching what the seeded backend produces. */
export function generateDemoRecords(perModel = 60): KskRecord[] {
  nextId = 1
  seenCars.clear()

  const records: KskRecord[] = []
  for (const model of MODELS) {
    for (let i = 0; i < perModel; i++) {
      const forceOpen = i >= perModel - Math.ceil(perModel / 6)
      records.push(buildRecord(model, HISTORY_HOURS, forceOpen))
    }
  }
  return records.sort(
    (a, b) => new Date(b.registered).getTime() - new Date(a.registered).getTime(),
  )
}

/** A brand-new record, as the 15s fast-scan would discover it. */
export function generateDemoArrival(): KskRecord {
  return buildRecord(pick(MODELS), LIVE_WINDOW_HOURS, true)
}

/** Closes an open record, as the 45s watch-list recheck would. */
export function closeDemoRecord(record: KskRecord): KskRecord {
  const reworked = new Date()
  return {
    ...record,
    reworked: reworked.toISOString(),
    qualityControlDate: new Date(reworked.getTime() + 30 * 60_000).toISOString(),
    status: 'Terminé',
    durationMinutes: Math.max(
      0,
      Math.round((reworked.getTime() - new Date(record.registered).getTime()) / 60_000),
    ),
  }
}
