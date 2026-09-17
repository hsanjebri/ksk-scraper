import {
  EnrichableRecord,
  ErrorCodeRowLike,
  enrichWithDetail,
  mergeListAndDetail,
  syncErrorCodes,
} from './merge';
import { RemoteDetailRecord, RemoteErrorCodeRow, RemoteListRow } from './mock/mock-data.generator';

/**
 * These pin the single most dangerous failure mode in the whole scraper.
 *
 * If a record were rebuilt from a detail page alone and that page failed to
 * parse (or came back partial), every field would come back blank and
 * `registered` would be lost — quietly moving records into the wrong week and
 * destroying every duration on the dashboard. The list row is authoritative;
 * the detail page only ever adds to it.
 */
const LIST_ROW: RemoteListRow = {
  no: '2947',
  model: 'MCM',
  carId: '006304952C',
  zsb: '006304952C00',
  registered: new Date(2026, 8, 14, 6, 29, 1).toISOString(),
  errorCode: '500',
  comment: 'pas de continuite n30/3*1-b-v4 voie21',
  color: '',
};

/** What the detail parser returns when it matches nothing on the page. */
const EMPTY_DETAIL: RemoteDetailRecord = {
  no: '2947',
  model: 'MCM',
  carId: '',
  zsb: '',
  registered: new Date().toISOString(), // the dangerous "now" fallback
  errorCode: '',
  comment: '',
  color: '',
  reworked: null,
  qualityControlDate: null,
  defectShift: null,
  detectShift: null,
  defectBy: null,
  partType: '',
  partName: '',
  description: '',
  qualityGate: null,
  errorCodes: [],
};

describe('mergeListAndDetail', () => {
  describe('when the detail page fails to parse', () => {
    const merged = mergeListAndDetail(LIST_ROW, EMPTY_DETAIL);

    it('keeps the registered timestamp from the list, not the "now" fallback', () => {
      expect(merged.registered).toBe(LIST_ROW.registered);
      expect(new Date(merged.registered).getFullYear()).toBe(2026);
      expect(new Date(merged.registered).getDate()).toBe(14);
    });

    it('keeps every other verified list field', () => {
      expect(merged.carId).toBe('006304952C');
      expect(merged.zsb).toBe('006304952C00');
      expect(merged.errorCode).toBe('500');
      expect(merged.comment).toBe(LIST_ROW.comment);
    });

    it('leaves the detail-only fields empty rather than inventing them', () => {
      expect(merged.reworked).toBeNull();
      expect(merged.qualityGate).toBeNull();
      expect(merged.partName).toBe('');
      expect(merged.errorCodes).toEqual([]);
    });
  });

  describe('when the detail fetch throws entirely', () => {
    const merged = mergeListAndDetail(LIST_ROW, null);

    it('still produces a complete, saveable record from the list alone', () => {
      expect(merged.no).toBe('2947');
      expect(merged.carId).toBe('006304952C');
      expect(merged.registered).toBe(LIST_ROW.registered);
      expect(merged.reworked).toBeNull();
    });
  });

  describe('when the detail page parses correctly', () => {
    const detail: RemoteDetailRecord = {
      ...EMPTY_DETAIL,
      reworked: new Date(2026, 8, 14, 9, 15, 0).toISOString(),
      qualityControlDate: new Date(2026, 8, 14, 9, 45, 0).toISOString(),
      defectShift: '2',
      detectShift: '3',
      defectBy: 'J. Kowalski',
      partType: 'Wiring Harness',
      partName: 'Main Harness Front',
      description: 'Continuity failure',
      qualityGate: 'EOL Test',
      errorCodes: [
        {
          code: '500',
          description: 'Continuity failure',
          errorProducer: 'J. Kowalski',
          partType: 'Wiring Harness',
          partName: 'Main Harness Front',
          cavity: '',
          info: 'EOL Test',
        },
      ],
    };
    const merged = mergeListAndDetail(LIST_ROW, detail);

    it('takes the enrichment fields from the detail page', () => {
      expect(merged.reworked).toBe(detail.reworked);
      expect(merged.defectShift).toBe('2');
      expect(merged.detectShift).toBe('3');
      expect(merged.qualityGate).toBe('EOL Test');
      expect(merged.partName).toBe('Main Harness Front');
      expect(merged.errorCodes).toHaveLength(1);
    });

    it('still refuses to let the detail page move `registered`', () => {
      // Even a detail page that parsed fine does not own this field.
      expect(merged.registered).toBe(LIST_ROW.registered);
    });
  });

  describe('when the list row itself is missing a value', () => {
    // Real rows exist with an empty CarID anchor — see the real-HTML spec.
    const sparseRow: RemoteListRow = { ...LIST_ROW, carId: '', errorCode: '' };
    const detail: RemoteDetailRecord = {
      ...EMPTY_DETAIL,
      carId: '006304952C',
      errorCode: '500',
    };

    it('falls back to the detail value rather than storing a blank', () => {
      const merged = mergeListAndDetail(sparseRow, detail);
      expect(merged.carId).toBe('006304952C');
      expect(merged.errorCode).toBe('500');
    });
  });

  // The list page clips Comment at 60 characters — measured on a real capture,
  // where 28 of 44 rows sat at exactly 60. The full text is on the detail page.
  describe('comment truncation', () => {
    const clipped = 'pas de continuite n30/3*1-b-v4 voie21 x18/53*5-s-v1 voie4 lt'; // 60
    const full =
      'pas de continuite n30/3*1-b-v4 voie21 x18/53*5-s-v1 voie4 ltg 2482380 remplace';

    it('is exactly the 60 characters the real page truncates to', () => {
      expect(clipped).toHaveLength(60);
    });

    it('takes the fuller comment from the detail page', () => {
      const merged = mergeListAndDetail(
        { ...LIST_ROW, comment: clipped },
        { ...EMPTY_DETAIL, comment: full },
      );
      expect(merged.comment).toBe(full);
    });

    it('keeps the list comment when the detail page has nothing', () => {
      const merged = mergeListAndDetail({ ...LIST_ROW, comment: clipped }, EMPTY_DETAIL);
      expect(merged.comment).toBe(clipped);
    });

    it('never replaces a longer list comment with a shorter detail one', () => {
      const merged = mergeListAndDetail(
        { ...LIST_ROW, comment: full },
        { ...EMPTY_DETAIL, comment: 'short' },
      );
      expect(merged.comment).toBe(full);
    });
  });
});

/**
 * enrichWithDetail runs on records that are already stored: first to complete
 * a list-only backfilled record, then again on every re-check while it stays
 * open. It has to be safe to repeat.
 */
describe('enrichWithDetail', () => {
  const listOnly = (): EnrichableRecord => ({
    carId: '006305803C',
    zsb: '006305803C00',
    errorCode: '510',
    comment: 'inversion enter deux connecteur n73/3*2-b-v1 v32+33 vers n12',
    reworked: null,
    qualityControlDate: null,
    defectShift: null,
    detectShift: null,
    defectBy: null,
    partType: null,
    partName: null,
    description: null,
    qualityGate: null,
  });

  const detail: RemoteDetailRecord = {
    ...EMPTY_DETAIL,
    carId: '006305803C',
    reworked: new Date(2026, 8, 17, 11, 26, 59).toISOString(),
    qualityControlDate: new Date(2026, 8, 17, 11, 27, 13).toISOString(),
    defectShift: 'B',
    detectShift: 'B',
    defectBy: 'Team2',
    partType: 'connecteur',
    partName: 'A126*1-B_V1',
    description: 'incorrecte connecteur',
    qualityGate: 'EOL Electrical test',
    comment: 'inversion enter deux connecteur n73/3*2-b-v1 v32+33 vers n125*1-b-v1 v32+33',
  };

  it('completes a list-only record and reports that it closed', () => {
    const record = listOnly();
    const { closedNow } = enrichWithDetail(record, detail);

    expect(closedNow).toBe(true);
    expect(record.reworked).toEqual(new Date(2026, 8, 17, 11, 26, 59));
    expect(record.qualityGate).toBe('EOL Electrical test');
    expect(record.defectShift).toBe('B');
    expect(record.comment).toBe(detail.comment); // full text replaces the stump
  });

  it('reports closedNow only once, not on every later re-check', () => {
    const record = listOnly();
    enrichWithDetail(record, detail);
    expect(enrichWithDetail(record, detail).closedNow).toBe(false);
  });

  it('never re-opens a closed record when a later poll comes back without a timestamp', () => {
    const record = listOnly();
    enrichWithDetail(record, detail);
    enrichWithDetail(record, { ...EMPTY_DETAIL, reworked: null });
    expect(record.reworked).toEqual(new Date(2026, 8, 17, 11, 26, 59));
  });

  it('does not let a partial page erase what an earlier poll found', () => {
    const record = listOnly();
    enrichWithDetail(record, detail);
    enrichWithDetail(record, EMPTY_DETAIL);

    expect(record.qualityGate).toBe('EOL Electrical test');
    expect(record.partName).toBe('A126*1-B_V1');
    expect(record.defectBy).toBe('Team2');
    expect(record.comment).toBe(detail.comment);
  });

  it('keeps an open record open and says so', () => {
    const record = listOnly();
    const { closedNow } = enrichWithDetail(record, { ...detail, reworked: null, qualityControlDate: null });
    expect(closedNow).toBe(false);
    expect(record.reworked).toBeNull();
    expect(record.qualityGate).toBe('EOL Electrical test');
  });

  it('keeps list-owned identifiers, filling them from detail only when blank', () => {
    const record = { ...listOnly(), carId: '', errorCode: '510' };
    enrichWithDetail(record, { ...detail, errorCode: '999' });
    expect(record.carId).toBe('006305803C');
    expect(record.errorCode).toBe('510');
  });
});

/**
 * The rework system manual is explicit that error-code rows change after
 * registration: operators add codes for an existing Rework ID (§3.3) and can
 * replace the main one during Rework Out, where "all of the information will be
 * replaced with the new modified data" (§4.2).
 *
 * An earlier version attached these rows once and then never touched them
 * again, so every code added while the harness was being repaired was lost —
 * exactly the codes that describe what was actually wrong.
 */
describe('syncErrorCodes', () => {
  const row = (over: Partial<RemoteErrorCodeRow> = {}): RemoteErrorCodeRow => ({
    code: '510',
    description: 'incorrecte connecteur',
    errorProducer: 'Team2',
    partType: 'connecteur',
    partName: 'A126*1-B_V1',
    cavity: '32',
    info: 'inversion enter deux connecteur',
    ...over,
  });

  /** Stands in for the entity: carries a row id the DB assigned. */
  interface StoredRow extends ErrorCodeRowLike {
    id?: number;
  }
  let created = 0;
  const create = (source: RemoteErrorCodeRow): StoredRow => {
    created += 1;
    return { ...source };
  };
  beforeEach(() => {
    created = 0;
  });

  const stored = (over: Partial<StoredRow> = {}): StoredRow => ({ ...row(), id: 1, ...over });

  it('attaches the rows of a record that had none', () => {
    const result = syncErrorCodes<StoredRow>([], [row(), row({ code: '500', cavity: '4' })], create);
    expect(result.map((r) => r.code)).toEqual(['510', '500']);
    expect(created).toBe(2);
  });

  it('adds a code inserted during the rework without touching the existing row', () => {
    const existing = stored();
    const result = syncErrorCodes<StoredRow>(
      [existing],
      [row(), row({ code: '140', description: 'fil coupe', cavity: 'Not applicable' })],
      create,
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(existing); // same row, same id — no churn
    expect(result[1].code).toBe('140');
    expect(created).toBe(1);
  });

  it('is idempotent — re-checking an unchanged page creates nothing', () => {
    const existing = [stored(), stored({ id: 2, code: '500', cavity: '4' })];
    const result = syncErrorCodes<StoredRow>(existing, [row(), row({ code: '500', cavity: '4' })], create);
    expect(result).toEqual(existing);
    expect(created).toBe(0);
  });

  it('drops a row the page no longer lists, so a replaced code disappears', () => {
    const result = syncErrorCodes<StoredRow>(
      [stored(), stored({ id: 2, code: '500' })],
      [row({ code: '151', description: 'pas de continuite' })],
      create,
    );
    expect(result.map((r) => r.code)).toEqual(['151']);
  });

  it('treats a modified field as a different row', () => {
    // §4.2 replaces the data in place; the row we stored is no longer accurate.
    const result = syncErrorCodes<StoredRow>(
      [stored()],
      [row({ description: 'connecteur casse' })],
      create,
    );
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('connecteur casse');
    expect(created).toBe(1);
  });

  it('never wipes stored rows when the page comes back with none', () => {
    // A parse miss or a partial page must not delete real defect data.
    const existing = [stored()];
    expect(syncErrorCodes<StoredRow>(existing, [], create)).toBe(existing);
    expect(created).toBe(0);
  });

  it('ignores whitespace differences between two renders of the same row', () => {
    const result = syncErrorCodes<StoredRow>(
      [stored()],
      [row({ code: '510 ', info: ' inversion enter deux connecteur ' })],
      create,
    );
    expect(created).toBe(0);
    expect(result[0].id).toBe(1);
  });
});
