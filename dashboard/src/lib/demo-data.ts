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
// ZSB is no longer drawn from a pool — it is derived from the CarID, the way
// the real system does it. See zsbFor().
// Every value below is modelled on the pages captured from the live site on
// 2026-09-17 (2 detail pages, 5,939 list rows) and on the field definitions in
// the SEBN Standard Rework System manual v7.2.27. Inventing English office
// vocabulary here taught the wrong shape of the data: the plant records French
// free text, letter shifts and team names.

/** The list page's Color column is empty on every captured row. */
const COLORS = ['']
/** Real shifts are letters — "defect shift: B" on the captured detail pages. */
const SHIFTS = ['A', 'B']
/**
 * "Error producer — who made defect" (manual §3.2). The plant fills it with a
 * team, not a person: both captured records say "Team2".
 */
// Repeated entries weight the draw: a uniform split would put all three teams
// within a percent of each other and leave the breakdown saying nothing.
const OPERATORS = ['Team2', 'Team2', 'Team2', 'Team1', 'Team1', 'Team3']
const PRODUCERS = OPERATORS
/** "32" and "Not applicable" are the two real captured values. */
const CAVITIES = ['32', '4', '21', '33', 'Not applicable', 'Not applicable']
const INFO = ['', '']
/** "Quality gate — select one of the zones where the failure was found" (§3.2). */
const QUALITY_GATES = [
  'EOL Electrical test',
  'EOL Electrical test',
  'EOL Electrical test',
  'Clip test',
  'Visual inspection',
  'Final audit',
]
/** Verbatim-style comments: lowercase French, connector codes, cavity numbers. */
const COMMENTS = [
  'pas de continuité n30/3*1-b-v4 voie21',
  'inversion enter deux connecteur n73/3*2-b-v1 v32+33 vers n125*1-b-v1 v32+33',
  'fil arraché au niveau connecteur e18/5*1-b-v1 voie4',
  'MANQUE CONNECTEUR E17/47*1-S-V1 +SERTISSAGE',
  'fils coupe n10*rb2-b-v2 v21 vers e4/17*1-b-v4 v4 ltg 2483534',
  'fil coupee au niveau s88/8*1-b-v2 voie 2-3',
  'terminal mal serti, remplace',
  '',
]
/** Error descriptions come from the CQM code list (§3.2) — French, short. */
const DESCRIPTIONS = [
  'Manque connecteur',
  'incorrecte connecteur',
  'fil coupe',
  'pas de continuite',
  'terminal endommage',
  'inversion',
]

/**
 * "Part type" comes from a CQM list and "part name" from a PPE list per
 * project (§3.2). Captured: type "connecteur", names like "A126*1-B_V1".
 */
const PARTS: { type: string; names: string[] }[] = [
  { type: 'connecteur', names: ['A126*1-B_V1', 'E17/47*1-S_V', 'N73/3*2-B-V1', 'X18/53*5-S-V1'] },
  { type: 'fil', names: ['N30/3*1-B-V4', 'E4/17*1-B-V4', 'S88/8*1-B-V2'] },
  { type: 'terminal', names: ['T12*1-B-V2', 'T44*3-S-V1'] },
  { type: 'joint', names: ['J8*1-B-V1', 'J21*2-S-V3'] },
  { type: 'tube', names: ['TB5*1-B-V2'] },
]

/** Skewed on purpose — a flat distribution makes the Pareto chart pointless. */
// MEASURED shares from a real capture of the live results page (44 rows).
// Kept in step with the backend mock so the public demo and the local mock
// tell the same story.
const WEIGHTED_CODES: { code: string; weight: number }[] = [
  { code: '151', weight: 21 },
  { code: '140', weight: 14 },
  { code: '153', weight: 14 },
  { code: '160', weight: 7 },
  { code: '510', weight: 7 },
  { code: '520', weight: 7 },
  { code: '40', weight: 5 },
  { code: '152', weight: 5 },
  { code: '500', weight: 5 },
  { code: '110', weight: 2 },
  { code: '120', weight: 2 },
  { code: '141', weight: 2 },
  { code: '150', weight: 2 },
  { code: '154', weight: 2 },
  { code: '170', weight: 2 },
  { code: '181', weight: 2 },
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

/**
 * Real CarIDs are `006304952C` — nine digits plus a letter, no model prefix —
 * and repeats run at about 5%, not the 22% this used to invent.
 */
function carIdFor(model: string): string {
  const seen = seenCars.get(model) ?? []
  if (seen.length > 5 && Math.random() < 0.05) return pick(seen)
  const carId = `00630${randomInt(1000, 5999)}C`
  seen.push(carId)
  seenCars.set(model, seen)
  return carId
}

/** ZSB is the CarID plus a revision suffix — 40 of 41 real rows follow this. */
function zsbFor(carId: string): string {
  const roll = Math.random()
  return `${carId}${roll < 0.85 ? '00' : roll < 0.97 ? '01' : '02'}`
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
  // Hoisted because ZSB is derived from it — see zsbFor().
  const carId = carIdFor(model)

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

  /**
   * Quality control is its own stage and it closes the Rework ID (§5). On the
   * captured record it followed the repair after 14 seconds, so the wait is
   * short — but a few recent records are still waiting, which is the state the
   * "Awaiting quality control" list exists to surface.
   */
  // The share is set high enough that the "Awaiting quality control" list has
  // rows in a demo. How often it really happens is unknown — the two captured
  // records were both released — so nothing is read from this number.
  const qcPending = reworked !== null && hoursAgo < 24 && Math.random() < 0.3
  const qualityControl =
    reworked && !qcPending
      ? new Date(reworked.getTime() + randomInt(10, 300) * 1_000)
      : null

  const record: KskRecord = {
    id,
    no: String(100_000 + id),
    model,
    carId,
    zsb: zsbFor(carId),
    registered: registered.toISOString(),
    reworked: reworked ? reworked.toISOString() : null,
    qualityControlDate: qualityControl ? qualityControl.toISOString() : null,
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
    awaitingQualityControl: reworked !== null && qualityControl === null,
    week: isoWeekLabel(registered),
    durationMinutes: Math.max(
      0,
      Math.round(((reworked ? reworked.getTime() : Date.now()) - registered.getTime()) / 60_000),
    ),
  }
  return record
}

/** ~120 records across ~12 weeks, matching what the seeded backend produces. */
/**
 * `perModel` is set to the real volume, not a token sample: the captured MAM
 * list holds 2,938 records over the 12 weeks this history spans (~245/week).
 * The old default of 60 per model made every rate two orders of magnitude too
 * small — a 0.3% rework rate where the real data gives ~18% against the same
 * assumed production volume — so the demo taught the wrong numbers.
 */
export function generateDemoRecords(perModel = 2900): KskRecord[] {
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

/**
 * Closes an open record, as the watch-list recheck would.
 *
 * It lands in the "repaired, quality control pending" state the real system
 * passes through (manual §4 → §5); the next demo tick releases it.
 */
export function closeDemoRecord(record: KskRecord): KskRecord {
  const reworked = new Date()
  return {
    ...record,
    reworked: reworked.toISOString(),
    qualityControlDate: null,
    awaitingQualityControl: true,
    status: 'Terminé',
    durationMinutes: Math.max(
      0,
      Math.round((reworked.getTime() - new Date(record.registered).getTime()) / 60_000),
    ),
  }
}

/** Quality control releases a repaired record — the third and final stage. */
export function releaseDemoRecord(record: KskRecord): KskRecord {
  return {
    ...record,
    qualityControlDate: new Date().toISOString(),
    awaitingQualityControl: false,
  }
}
