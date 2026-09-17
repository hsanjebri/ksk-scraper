import type {
  RemoteDetailRecord,
  RemoteErrorCodeRow,
  RemoteListRow,
} from './mock/mock-data.generator';

/**
 * Pure merge logic, deliberately kept in its own module with NO Nest or
 * TypeORM imports. Reaching it through ScraperService drags the whole DI
 * chain into any test that touches it — and `@nestjs/typeorm` ships ESM,
 * which Jest's CommonJS transform refuses to load. Isolating it keeps the
 * rule that matters most in the scraper cheap to test.
 */

/** Prefers the list value; falls back to the detail page only when it's blank. */
function preferList(listValue: string, detailValue: string | null | undefined): string {
  return listValue && listValue.trim() ? listValue : (detailValue ?? '');
}

/**
 * Comment is the one field where the list is NOT the better source.
 *
 * Measured against a real capture: 28 of 44 rows carry a comment of exactly
 * 60 characters — the list page clips it. The detail page holds the full
 * sentence. Applying the usual "list wins" rule to this field would store the
 * truncated text forever, losing the end of two thirds of all defect
 * descriptions. So here the longer of the two wins.
 */
function preferLonger(listValue: string, detailValue: string | null | undefined): string {
  const fromDetail = detailValue ?? '';
  if (!listValue.trim()) return fromDetail;
  return fromDetail.length > listValue.length ? fromDetail : listValue;
}

/**
 * The list row is AUTHORITATIVE; the detail page only enriches it.
 *
 * Why this asymmetry matters: the list parser is verified against real bytes
 * from the live server, while the detail parser is not (the relay's own README
 * admits the same gap). If the detail page fails to parse, its record comes
 * back with empty strings and a `registered` that falls back to "now".
 * Building the saved record from that would replace a correct timestamp with
 * today's date — silently destroying week bucketing and every duration on the
 * dashboard, for every record.
 *
 * So `registered` always comes from the list, and detail-only fields
 * (reworked, shifts, part, quality gate) are the only things it contributes.
 * Where the list happens to be blank — a row with no CarID link, say — the
 * detail value is used as a fallback rather than thrown away.
 */
export function mergeListAndDetail(
  row: RemoteListRow,
  detail: RemoteDetailRecord | null,
): RemoteDetailRecord {
  return {
    // --- from the LIST: verified, never overwritten by detail ---
    no: row.no,
    model: row.model,
    registered: row.registered,
    carId: preferList(row.carId, detail?.carId),
    zsb: preferList(row.zsb, detail?.zsb),
    errorCode: preferList(row.errorCode, detail?.errorCode),
    // Not preferList: the list truncates this field — see preferLonger.
    comment: preferLonger(row.comment, detail?.comment),
    color: preferList(row.color, detail?.color),

    // --- from the DETAIL: enrichment only, absent until it parses ---
    reworked: detail?.reworked ?? null,
    qualityControlDate: detail?.qualityControlDate ?? null,
    defectShift: detail?.defectShift ?? null,
    detectShift: detail?.detectShift ?? null,
    defectBy: detail?.defectBy ?? null,
    partType: detail?.partType ?? '',
    partName: detail?.partName ?? '',
    description: detail?.description ?? '',
    qualityGate: detail?.qualityGate ?? null,
    errorCodes: detail?.errorCodes ?? [],
  };
}

/** The fields a detail fetch is allowed to fill in on an already-stored record. */
export interface EnrichableRecord {
  carId: string;
  zsb: string;
  errorCode: string | null;
  comment: string | null;
  reworked: Date | null;
  qualityControlDate: Date | null;
  defectShift: string | null;
  detectShift: string | null;
  defectBy: string | null;
  partType: string | null;
  partName: string | null;
  description: string | null;
  qualityGate: string | null;
}

const blank = (value: unknown) => value === null || value === undefined || value === '';

/**
 * Applies a (re-)fetched detail page to a record that is already stored.
 *
 * Used both to enrich backfilled list-only records and to re-check open ones,
 * so it must be safe to run repeatedly:
 *
 *  - A value is only overwritten by a NON-EMPTY fetched value. A detail page
 *    that comes back partial on one poll must not erase what an earlier poll
 *    found.
 *  - A closed record never re-opens: once `reworked` is set it stays set.
 *  - List-owned fields (CarID, ZSB, error code) keep the list's value and only
 *    take the detail's when the list had none.
 *  - Comment takes whichever is longer — both pages clip it at 60 characters,
 *    and only the detail's error list carries it in full.
 *
 * Returns whether this call is what closed the record, so the caller can emit
 * a close event exactly once.
 */
export function enrichWithDetail(
  record: EnrichableRecord,
  fresh: RemoteDetailRecord,
): { closedNow: boolean } {
  const wasOpen = record.reworked === null || record.reworked === undefined;

  if (blank(record.carId) && fresh.carId) record.carId = fresh.carId;
  if (blank(record.zsb) && fresh.zsb) record.zsb = fresh.zsb;
  if (blank(record.errorCode) && fresh.errorCode) record.errorCode = fresh.errorCode;
  record.comment = preferLonger(record.comment ?? '', fresh.comment) || null;

  if (wasOpen && fresh.reworked) record.reworked = new Date(fresh.reworked);
  if (blank(record.qualityControlDate) && fresh.qualityControlDate) {
    record.qualityControlDate = new Date(fresh.qualityControlDate);
  }

  const detailOnly = [
    'defectShift',
    'detectShift',
    'defectBy',
    'partType',
    'partName',
    'description',
    'qualityGate',
  ] as const;
  for (const key of detailOnly) {
    const incoming = fresh[key];
    if (!blank(incoming)) record[key] = incoming as string;
  }

  return { closedNow: wasOpen && !blank(record.reworked) };
}

/** Everything that identifies one error-code row; the site gives them no id. */
export interface ErrorCodeRowLike {
  code: string;
  description: string | null;
  errorProducer: string | null;
  partType: string | null;
  partName: string | null;
  cavity: string | null;
  info: string | null;
}

const errorCodeKey = (row: ErrorCodeRowLike) =>
  [row.code, row.description, row.errorProducer, row.partType, row.partName, row.cavity, row.info]
    .map((value) => (value ?? '').trim())
    .join('');

/**
 * Re-syncs a record's error-code rows against its detail page.
 *
 * These rows are NOT write-once. The rework application lets an operator add
 * error codes after registration (system manual §3.3) and replace the main one
 * during Rework Out, where "all of the information will be replaced with the
 * new modified data" (§4.2). An earlier version froze the list after the first
 * successful fetch, so every code added while the harness was being repaired
 * was lost.
 *
 *  - rows already stored are reused as-is, keeping their row identity;
 *  - rows new on the page are created via `create`;
 *  - rows the page no longer lists are dropped;
 *  - a page with NO rows never wipes what is stored — a parse miss must not
 *    delete real defects.
 */
export function syncErrorCodes<T extends ErrorCodeRowLike>(
  stored: T[] | undefined,
  fresh: RemoteErrorCodeRow[],
  create: (row: RemoteErrorCodeRow) => T,
): T[] {
  const existing = stored ?? [];
  if (fresh.length === 0) return existing;

  const byKey = new Map(existing.map((row) => [errorCodeKey(row), row]));
  return fresh.map((row) => byKey.get(errorCodeKey(row)) ?? create(row));
}
