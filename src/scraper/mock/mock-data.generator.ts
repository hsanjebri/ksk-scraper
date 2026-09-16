import { KskModel } from '../constants';
import { pickRandom, randomInt, randomPastDate } from './random.util';

export interface RemoteListRow {
  no: string;
  model: KskModel;
  carId: string;
  zsb: string;
  registered: string;
  errorCode: string;
  comment: string;
  color: string;
}

export interface RemoteErrorCodeRow {
  code: string;
  description: string;
  errorProducer: string;
  partType: string;
  partName: string;
  cavity: string;
  info: string;
}

export interface RemoteDetailRecord extends RemoteListRow {
  reworked: string | null;
  qualityControlDate: string | null;
  defectShift: string | null;
  detectShift: string | null;
  defectBy: string | null;
  partType: string;
  partName: string;
  description: string;
  /**
   * Where the defect was caught ("Reworked From" on the detail page). Optional
   * because the mock predates it and the live detail parser is the only source
   * that can populate it reliably.
   */
  qualityGate?: string | null;
  errorCodes: RemoteErrorCodeRow[];
}

// ZSB is no longer drawn from a pool — it is derived from the CarID, the way
// the real system does it. See zsbFor().
const COLOR_POOL = ['Black', 'White', 'Grey', 'Red', 'Blue', 'Silver'];
const SHIFT_POOL = ['1', '2', '3'];
const OPERATOR_POOL = ['J. Kowalski', 'A. Nowak', 'M. Wisniewski', 'P. Zielinski', 'K. Wojcik'];
/**
 * Part names paired with the type they actually belong to. Drawing type and
 * name from two independent pools produced nonsense like a "Main Harness
 * Front" of type "Fuse Box", which makes any part-type breakdown meaningless.
 */
const PARTS: { type: string; names: string[] }[] = [
  { type: 'Wiring Harness', names: ['Main Harness Front', 'Main Harness Rear', 'Door Harness LH'] },
  { type: 'Connector', names: ['Connector 24-pin', 'Connector 8-pin', 'Inline Connector B'] },
  { type: 'Sensor Bracket', names: ['Bracket Left Rear', 'Bracket Right Front'] },
  { type: 'Fuse Box', names: ['Fuse Box Assembly', 'Fuse Carrier 12V'] },
  { type: 'Relay Module', names: ['Relay Module A3', 'Relay Module B1'] },
];

/**
 * Error codes with weights, not a uniform pool.
 *
 * Real defect distributions are heavily skewed — that skew is the entire
 * premise of a Pareto chart. With uniform sampling every code lands at roughly
 * the same count and the "vital few" reads as "5 of 6 codes", which tells
 * nobody anything. These weights give a realistic long tail.
 */
// MEASURED from a real capture of the site's results page (44 rows), not
// guessed: the codes are bare numbers and these are their observed shares.
// The real tail is flatter than a textbook Pareto — 9 of 16 codes account for
// 80% of defects — so the mock should not look steeper than reality.
const WEIGHTED_ERROR_CODES: { code: string; weight: number }[] = [
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
];
const ERROR_WEIGHT_TOTAL = WEIGHTED_ERROR_CODES.reduce((sum, e) => sum + e.weight, 0);

function weightedErrorCode(): string {
  let roll = Math.random() * ERROR_WEIGHT_TOTAL;
  for (const entry of WEIGHTED_ERROR_CODES) {
    roll -= entry.weight;
    if (roll <= 0) return entry.code;
  }
  return WEIGHTED_ERROR_CODES[0].code;
}

function randomPart(): { type: string; name: string } {
  const group = pickRandom(PARTS);
  return { type: group.type, name: pickRandom(group.names) };
}
const ERROR_PRODUCER_POOL = ['Line 1', 'Line 2', 'Supplier X', 'Supplier Y', 'Assembly Station 4'];
const CAVITY_POOL = ['1', '2', '3', 'A1', 'B2', 'C3'];
const COMMENT_POOL = [
  'Checked against reference, wiring confirmed damaged.',
  'Awaiting replacement part from stock.',
  'Reworked per standard procedure.',
  'Escalated to quality for review.',
  '',
];
const DESCRIPTION_POOL = [
  'Continuity failure detected during end-of-line test.',
  'Connector pin bent during assembly, replaced.',
  'Sensor reading out of tolerance range.',
  'Short circuit found on harness segment.',
  'Loose crimp connection on terminal.',
];
const INFO_POOL = ['Repeat defect', 'First occurrence', 'Known issue #4471', ''];

/**
 * Quality gates — the station where the defect was caught. Taken from the
 * production relay's "Reworked From - Quality Gate" breakdown so the mock
 * exercises the same chart the real data will.
 */
const QUALITY_GATE_POOL = [
  'EOL Test',
  'Visual Inspection',
  'Electrical Test',
  'Final Audit',
  'Customer Line',
];

/**
 * Cars already seen per model, so a minority of records reuse an existing
 * CarID. Repeat visits are the single most important signal in the real data
 * (the same car coming back means a root cause wasn't fixed), so the mock has
 * to produce some or the "repeat" detection can never be seen working.
 */
const seenCarIds = new Map<KskModel, string[]>();
// Measured: 2 repeats among 41 distinct CarIDs over a 9-day window (~5%).
// The previous 22% made repeat-defect analysis look far more dramatic than
// the real data supports.
const CAR_REPEAT_CHANCE = 0.05;

/**
 * Real CarIDs look like `006304952C` — nine digits and a trailing letter, with
 * no model prefix. The model lives in its own column. Inventing `MAM-77527`
 * made every table and export look unlike the system it is standing in for.
 */
function randomCarId(model: KskModel): string {
  const seen = seenCarIds.get(model) ?? [];
  if (seen.length > 5 && Math.random() < CAR_REPEAT_CHANCE) {
    return pickRandom(seen);
  }
  const carId = `00630${randomInt(1000, 5999)}C`;
  seen.push(carId);
  seenCarIds.set(model, seen);
  return carId;
}

/**
 * ZSB is the CarID plus a two-digit revision suffix — measured on 40 of 41
 * real rows. Suffix `00` dominates, with `01`/`02` for reworked revisions.
 */
function zsbFor(carId: string): string {
  const roll = Math.random();
  const suffix = roll < 0.85 ? '00' : roll < 0.97 ? '01' : '02';
  return `${carId}${suffix}`;
}

function hoursAgo(date: Date): number {
  return (Date.now() - date.getTime()) / 3_600_000;
}

function randomErrorCodes(): RemoteErrorCodeRow[] {
  const count = randomInt(1, 3);
  return Array.from({ length: count }, () => {
    const part = randomPart();
    return {
      code: weightedErrorCode(),
      description: pickRandom(DESCRIPTION_POOL),
      errorProducer: pickRandom(ERROR_PRODUCER_POOL),
      partType: part.type,
      partName: part.name,
      cavity: pickRandom(CAVITY_POOL),
      info: pickRandom(INFO_POOL),
    };
  });
}

/** ~12 ISO weeks, so seeded history covers enough weeks to trend against. */
export const SEED_HISTORY_HOURS = 12 * 7 * 24;

/** Live-discovered records land in the last few days, like real traffic. */
export const LIVE_WINDOW_HOURS = 96;

/**
 * Builds one fake "detail page" record, standing in for what a real
 * Szczegol.php?numer=X&model=Y parse would produce.
 *
 * `maxHoursAgo` controls how far back `registered` can fall. The seed passes
 * SEED_HISTORY_HOURS so the dashboard has multiple weeks to plot (week-over-week
 * deltas, sparklines and anomaly detection all need a history); records
 * "discovered" later by fastScan use the short live window instead.
 */
export function generateRandomDetailRecord(
  model: KskModel,
  no: string,
  forceOpen: boolean,
  maxHoursAgo: number = LIVE_WINDOW_HOURS,
): RemoteDetailRecord {
  const registered = randomPastDate(1, maxHoursAgo);
  // Only recent records stay open — a record registered six weeks ago and
  // still "En cours" would be nonsense, and would skew lead-time badly.
  const isOpen = (forceOpen || Math.random() < 0.35) && hoursAgo(registered) < LIVE_WINDOW_HOURS;
  const reworked = isOpen ? null : new Date(registered.getTime() + randomInt(20, 600) * 60_000);

  const part = randomPart();
  const defectShift = pickRandom(SHIFT_POOL);
  const carId = randomCarId(model);

  return {
    no,
    model,
    carId,
    zsb: zsbFor(carId),
    registered: registered.toISOString(),
    errorCode: weightedErrorCode(),
    comment: pickRandom(COMMENT_POOL),
    color: pickRandom(COLOR_POOL),
    reworked: reworked ? reworked.toISOString() : null,
    qualityControlDate: reworked ? new Date(reworked.getTime() + 30 * 60_000).toISOString() : null,
    defectShift,
    // Most defects are caught on the shift that made them; the rest escape to
    // a later one. Picking both shifts independently made "caught on the same
    // shift" a meaningless ~33% coin-flip.
    detectShift: Math.random() < 0.65 ? defectShift : pickRandom(SHIFT_POOL),
    defectBy: pickRandom(OPERATOR_POOL),
    partType: part.type,
    partName: part.name,
    description: pickRandom(DESCRIPTION_POOL),
    qualityGate: pickRandom(QUALITY_GATE_POOL),
    errorCodes: randomErrorCodes(),
  };
}
