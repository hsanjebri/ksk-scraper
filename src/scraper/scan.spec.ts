import { readFileSync } from 'fs';
import { join } from 'path';
import { parseListRows } from './live/site-parsers';
import { RemoteListRow } from './mock/mock-data.generator';
import { selectNewRows } from './scan';

/**
 * New-row detection against the real MAM list page, whose first rows include
 * backdated entries: the page is sorted by Registered, so No. 2940 sits BELOW
 * No. 2937. Any logic that trusts row positions misses records.
 */
const MAM = parseListRows(
  readFileSync(join(__dirname, 'live', '__fixtures__', 'real-list-MAM-head.html'), 'utf8'),
  'MAM',
);

const row = (no: string, registered = '2026-09-17T10:00:00.000Z'): RemoteListRow => ({
  no,
  model: 'MAM',
  carId: `CAR${no}`,
  zsb: '',
  registered,
  errorCode: '500',
  comment: '',
  color: '',
});

describe('the real list page ordering', () => {
  it('is sorted by registered date, newest first', () => {
    for (let i = 1; i < MAM.length; i++) {
      expect(new Date(MAM[i - 1].registered).getTime()).toBeGreaterThanOrEqual(
        new Date(MAM[i].registered).getTime(),
      );
    }
  });

  it('is NOT sorted by No. — entries are backdated', () => {
    const nos = MAM.map((r) => Number(r.no));
    const breaks = nos.filter((n, i) => i > 0 && nos[i - 1] <= n);
    expect(breaks.length).toBeGreaterThan(0);
  });
});

describe('selectNewRows', () => {
  it('treats a first run as a backfill of the whole page', () => {
    const selection = selectNewRows(MAM, null);
    expect(selection.backfill).toBe(true);
    expect(selection.rows).toHaveLength(MAM.length);
    expect(selection.maxNo).toBe('2944');
  });

  it('returns rows in ascending No. order, whatever the page order', () => {
    const nos = selectNewRows(MAM, null).rows.map((r) => Number(r.no));
    expect(nos).toEqual([...nos].sort((a, b) => a - b));
  });

  it('finds a newer No. even when it sits below an older one on the page', () => {
    // On the real page 2940 appears AFTER 2937. Both are new past 2936.
    const index2937 = MAM.findIndex((r) => r.no === '2937');
    const index2940 = MAM.findIndex((r) => r.no === '2940');
    expect(index2940).toBeGreaterThan(index2937);

    const selected = selectNewRows(MAM, '2936').rows.map((r) => r.no);
    expect(selected).toContain('2937');
    expect(selected).toContain('2940');
    expect(selected).not.toContain('2936');
    expect(selected).not.toContain('2935');
  });

  it('takes the highest No. as maxNo, not the first row', () => {
    const page = [row('100'), row('105'), row('101')];
    expect(page[0].no).toBe('100');
    expect(selectNewRows(page, null).maxNo).toBe('105');
  });

  it('returns nothing when the page has nothing newer', () => {
    const selection = selectNewRows(MAM, '2944');
    expect(selection.backfill).toBe(false);
    expect(selection.rows).toEqual([]);
  });

  it('can limit a backfill to recent history', () => {
    const page = [
      row('1', '2026-01-01T08:00:00.000Z'),
      row('2', '2026-09-10T08:00:00.000Z'),
      row('3', '2026-09-16T08:00:00.000Z'),
    ];
    const since = new Date('2026-09-09T00:00:00.000Z');
    expect(selectNewRows(page, null, since).rows.map((r) => r.no)).toEqual(['2', '3']);
    // maxNo still covers the whole page, so older rows are not re-offered later.
    expect(selectNewRows(page, null, since).maxNo).toBe('3');
  });

  it('ignores rows whose No. is not a number', () => {
    const selection = selectNewRows([row('12'), row('abc'), row('13')], '11');
    expect(selection.rows.map((r) => r.no)).toEqual(['12', '13']);
  });
});
