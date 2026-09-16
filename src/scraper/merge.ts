import type { RemoteDetailRecord, RemoteListRow } from './mock/mock-data.generator';

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
    comment: preferList(row.comment, detail?.comment),
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
