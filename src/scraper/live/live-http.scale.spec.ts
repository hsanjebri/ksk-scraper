import { readFileSync } from 'fs';
import { join } from 'path';
import { parseListRows, parseSiteDate } from './live-http.source';

/**
 * Runs the parser over a larger verbatim capture of the real results page
 * (44 rows spanning nine days) rather than a hand-written fixture.
 *
 * The four-row spec proves the SHAPE is right; this one proves the parser
 * survives real volume and real messiness, and pins the properties the rest
 * of the app quietly relies on — newest-first ordering above all, since
 * fastScan treats rows[0] as the newest record on the page.
 */
const HTML = readFileSync(join(__dirname, '__fixtures__', 'real-list-sample.html'), 'utf8');

describe('list parser at scale, against real captured HTML', () => {
  const rows = parseListRows(HTML, 'MCM');

  it('parses every data row in the capture', () => {
    expect(rows).toHaveLength(44);
  });

  it('parses every timestamp — no row falls back to "now"', () => {
    // The fallback would be invisible in the output but would silently move
    // records into the current week. Re-parse the raw value to be sure.
    for (const row of rows) {
      const parsed = new Date(row.registered);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect(parsed.getFullYear()).toBe(2026);
      expect(parsed.getMonth()).toBe(8); // September
    }
  });

  it('returns rows newest-first, which fastScan depends on', () => {
    // fastScan takes rows[0] as the newest No. on a first run; if the page
    // ordering were reversed it would ingest the oldest record and then
    // treat the entire backlog as "already seen".
    const numbers = rows.map((r) => Number(r.no));
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i - 1]).toBeGreaterThan(numbers[i]);
    }
  });

  it('never emits a row without a No.', () => {
    expect(rows.every((r) => r.no.length > 0)).toBe(true);
  });

  it('stamps the searched model on every row', () => {
    expect(rows.every((r) => r.model === 'MCM')).toBe(true);
  });

  it('tolerates the rows that are genuinely missing values', () => {
    // Real data: one row has an empty CarID anchor, three have no ZSB, three
    // have no comment. These must parse, not be skipped.
    expect(rows.filter((r) => r.carId === '')).toHaveLength(1);
    expect(rows.filter((r) => r.zsb === '')).toHaveLength(3);
    expect(rows.filter((r) => r.comment === '')).toHaveLength(3);
  });

  it('confirms the Color column is always empty in practice', () => {
    expect(rows.every((r) => r.color === '')).toBe(true);
  });

  it('shows ZSB is the CarID plus a revision suffix', () => {
    const withBoth = rows.filter((r) => r.zsb && r.carId);
    const derived = withBoth.filter((r) => r.zsb.startsWith(r.carId));
    // 40 of 41 — one row's ZSB belongs to a different CarID, which is real
    // data entry noise rather than a parsing fault.
    expect(derived.length).toBeGreaterThanOrEqual(withBoth.length - 1);
  });

  it('shows the list page truncates Comment at 60 characters', () => {
    // This is why mergeListAndDetail prefers the DETAIL page's comment when
    // it is longer — see merge.spec.ts.
    const clipped = rows.filter((r) => r.comment.length === 60);
    expect(clipped.length).toBeGreaterThan(20);
    expect(rows.every((r) => r.comment.length <= 60)).toBe(true);
  });

  it('reads error codes as the bare numbers the site actually uses', () => {
    const codes = rows.map((r) => r.errorCode).filter(Boolean);
    expect(codes.every((c) => /^\d{2,3}$/.test(c))).toBe(true);
    expect(codes).toContain('151');
  });

  it('parses the oldest and newest timestamps exactly', () => {
    expect(parseSiteDate('2026-09-14 06:29:01')).toEqual(
      new Date(2026, 8, 14, 6, 29, 1),
    );
    expect(parseSiteDate('2026-09-05 19:42:20')).toEqual(
      new Date(2026, 8, 5, 19, 42, 20),
    );
  });
});
