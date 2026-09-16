import { RemoteDetailRecord, RemoteListRow } from './mock/mock-data.generator';
import { mergeListAndDetail } from './merge';

/**
 * These pin the single most dangerous failure mode in the whole scraper.
 *
 * The list parser is verified against real server bytes; the detail parser is
 * not. If a record were rebuilt from the detail page alone and that page
 * failed to parse, every field would come back blank and `registered` would
 * fall back to "now" — quietly rewriting every timestamp to today and
 * destroying week bucketing and every duration on the dashboard.
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
});
