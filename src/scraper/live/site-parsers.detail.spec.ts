import { readFileSync } from 'fs';
import { join } from 'path';
import { mergeListAndDetail } from '../merge';
import { getIsoWeekLabel } from '../util/iso-week.util';
import {
  parseDetailFields,
  parseDetailPage,
  parseErrorCodeRows,
  parseListRows,
} from './site-parsers';

/**
 * Detail-page parsing against REAL pages captured from
 * rework.jenapp0001.sebn.com on a plant PC (capture.ps1).
 *
 * The two captures are a deliberate pair:
 *   MCM #3059 — closed: reworked, quality-controlled, 7 minutes in rework
 *   MAM #2944 — still open: no rework or quality-control timestamps yet
 *
 * This was the one part of the scraper that had never met real markup, and
 * it turned out to differ from the assumed layout in three ways the tests
 * below pin down: an unclosed main table, operator numbers ahead of every
 * timestamp, and a comment clipped at 60 characters.
 */
const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const CLOSED_HTML = fixture('real-detail-MCM-3059-closed.html');
const OPEN_HTML = fixture('real-detail-MAM-2944-open.html');

const local = (y: number, mo: number, d: number, h: number, mi: number, s: number) =>
  new Date(y, mo - 1, d, h, mi, s).toISOString();

describe('detail page — closed record (real MCM #3059)', () => {
  const record = parseDetailPage(CLOSED_HTML, '3059', 'MCM');

  it('reads the identifiers', () => {
    expect(record.carId).toBe('006305803C');
    expect(record.zsb).toBe('006305803C00');
    expect(record.model).toBe('MCM');
  });

  it('reads timestamps past the operator number that precedes each one', () => {
    // Raw page: "registered | 4821 | 2026-09-17 11:19:41",
    //           "reworked   | 143  | 2026-09-17 11:26:59".
    expect(record.registered).toBe(local(2026, 9, 17, 11, 19, 41));
    expect(record.reworked).toBe(local(2026, 9, 17, 11, 26, 59));
    expect(record.qualityControlDate).toBe(local(2026, 9, 17, 11, 27, 13));
  });

  it('computes the same rework time the site itself reports', () => {
    const fields = parseDetailFields(CLOSED_HTML);
    const minutes = Math.round(
      (new Date(record.reworked!).getTime() - new Date(record.registered).getTime()) / 60_000,
    );
    expect(fields.get('time (min)')).toEqual(['7']);
    expect(minutes).toBe(7);
  });

  it('computes the same ISO week the site itself reports', () => {
    expect(parseDetailFields(CLOSED_HTML).get('week')).toEqual(['38']);
    expect(getIsoWeekLabel(new Date(record.registered))).toBe('2026-W38');
  });

  it('reads shifts as the letters the site uses', () => {
    expect(record.defectShift).toBe('B');
    expect(record.detectShift).toBe('B');
    // The shift that performed the rework is a separate field on the page.
    expect(parseDetailFields(CLOSED_HTML).get('shift')).toEqual(['A']);
  });

  it('reads the defect classification', () => {
    expect(record.errorCode).toBe('510');
    expect(record.description).toBe('incorrecte connecteur');
    expect(record.partType).toBe('connecteur');
    expect(record.partName).toBe('A126*1-B_V1');
    expect(record.defectBy).toBe('Team2');
    expect(record.qualityGate).toBe('EOL Electrical test');
  });

  it('restores the full comment from the error list, not the 60-character stump', () => {
    const clipped = parseDetailFields(CLOSED_HTML).get('comment')![0];
    expect(clipped).toBe('inversion enter deux connecteur n73/3*2-b-v1 v32+33 vers n12');
    expect(clipped).toHaveLength(60);

    expect(record.comment).toBe(
      'inversion enter deux connecteur n73/3*2-b-v1 v32+33 vers n125*1-b-v1 v32+33',
    );
  });

  it('parses the error-codes list as real rows, including cavity', () => {
    expect(record.errorCodes).toEqual([
      {
        code: '510',
        description: 'incorrecte connecteur',
        errorProducer: 'Team2',
        partType: 'connecteur',
        partName: 'A126*1-B_V1',
        cavity: '32',
        info: 'inversion enter deux connecteur n73/3*2-b-v1 v32+33 vers n125*1-b-v1 v32+33',
      },
    ]);
  });
});

describe('detail page — open record (real MAM #2944)', () => {
  const record = parseDetailPage(OPEN_HTML, '2944', 'MAM');

  it('has no rework or quality-control timestamp', () => {
    expect(record.reworked).toBeNull();
    expect(record.qualityControlDate).toBeNull();
  });

  it('still recognises the empty labels rather than stealing the next value', () => {
    const fields = parseDetailFields(OPEN_HTML);
    expect(fields.get('reworked')).toEqual([]);
    expect(fields.get('quality control')).toEqual([]);
    expect(fields.get('time (min)')).toEqual([]);
  });

  it('reads everything that IS known about an open record', () => {
    expect(record.carId).toBe('005712067C');
    expect(record.registered).toBe(local(2026, 9, 17, 13, 6, 6));
    expect(record.defectShift).toBe('A');
    expect(record.detectShift).toBe('A');
    expect(record.errorCode).toBe('500');
    expect(record.description).toBe('Manque connecteur');
    expect(record.partName).toBe('E17/47*1-S_V');
    expect(record.qualityGate).toBe('EOL Electrical test');
    expect(record.comment).toBe('MANQUE CONNECTEUR E17/47*1-S-V1 +SERTISSAGE');
  });

  it('keeps the site\'s own wording for a cavity that does not apply', () => {
    expect(record.errorCodes[0].cavity).toBe('Not applicable');
  });
});

describe('the unclosed main table', () => {
  // The real page opens a second <Table> where it should close the first, so
  // the first </table> in the document belongs to the error-codes list. A
  // `<table>…</table>` match swallows that list into the field parser.
  it('keeps error-list text out of the field values', () => {
    for (const html of [CLOSED_HTML, OPEN_HTML]) {
      const values = [...parseDetailFields(html).values()].flat();
      expect(values).not.toContain('Error producer');
      expect(values).not.toContain('Cavity');
      expect(values.join(' ')).not.toMatch(/error codes list/i);
    }
  });

  it('gives each field exactly one value', () => {
    const fields = parseDetailFields(CLOSED_HTML);
    expect(fields.get('description')).toEqual(['incorrecte connecteur']);
    expect(fields.get('part name')).toEqual(['A126*1-B_V1']);
    expect(fields.get('quality gate')).toEqual(['EOL Electrical test']);
  });

  it('finds no error rows in a page without the list', () => {
    expect(parseErrorCodeRows('<table><tr><td>model</td><td>MCM</td></tr></table>')).toEqual([]);
  });
});

describe('list row + detail page for the same record', () => {
  const listRow = parseListRows(fixture('real-list-MCM-head.html'), 'MCM').find(
    (row) => row.no === '3059',
  )!;
  const detail = parseDetailPage(CLOSED_HTML, '3059', 'MCM');

  it('agree on every field both pages carry', () => {
    expect(listRow.carId).toBe(detail.carId);
    expect(listRow.zsb).toBe(detail.zsb);
    expect(listRow.errorCode).toBe(detail.errorCode);
    expect(listRow.registered).toBe(detail.registered);
  });

  it('merge into one record with the full comment and the rework timestamp', () => {
    const merged = mergeListAndDetail(listRow, detail);
    expect(listRow.comment).toHaveLength(60); // the list clips it too
    expect(merged.comment).toBe(detail.comment);
    expect(merged.reworked).toBe(local(2026, 9, 17, 11, 26, 59));
    expect(merged.qualityGate).toBe('EOL Electrical test');
    expect(merged.errorCodes[0].cavity).toBe('32');
  });
});
