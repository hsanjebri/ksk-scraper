import { parseDetailFields, parseListRows, parseSiteDate } from './live-http.source';

/**
 * These cover the port from the production RelayServer.java — specifically the
 * parts where a Java→JS translation can silently go wrong (regex flags,
 * greediness, statefulness of /g) rather than fail loudly.
 *
 * The LIST fixtures encode quirks the relay documented as observed on the real
 * server. The DETAIL fixtures exercise the parsing *mechanism* only — the real
 * detail markup has never been captured, so nothing here should be read as
 * proof that the live detail page parses correctly.
 */
describe('live scraper parsers', () => {
  describe('parseSiteDate', () => {
    it('parses the site format as local wall-clock time', () => {
      const d = parseSiteDate('2026-09-14 08:15:00')!;
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(8); // September, 0-based
      expect(d.getDate()).toBe(14);
      expect(d.getHours()).toBe(8);
      expect(d.getMinutes()).toBe(15);
    });

    it('tolerates a missing seconds component', () => {
      expect(parseSiteDate('2026-09-14 08:15')).not.toBeNull();
    });

    it('returns null rather than an Invalid Date for junk', () => {
      expect(parseSiteDate('')).toBeNull();
      expect(parseSiteDate('not a date')).toBeNull();
      // The old guessed format must NOT silently parse.
      expect(parseSiteDate('14.09.2026 08:15')).toBeNull();
    });
  });

  describe('parseListRows', () => {
    // Every quirk below was documented against real server bytes:
    // unquoted bgcolor, a missing opening <td> before the CarID anchor,
    // uppercase <A>, a row with no CarID link, and a spacer row with no No.
    const html = `
      <table>
      <tr bgcolor=#DEDEDF><td>1001</td><td>MAM</td><A HREF="Szczegol.php?numer=1001">CAR-1</A></td><td>ZSB-100</td><td>2026-09-14 08:15:00</td><td>E-101</td><td>Bent &amp; replaced</td><td>Black</td></tr>
      <tr bgcolor="#DEDEDF"><td>1002</td><td>MAM</td><td><a href="x">CAR-2</a></td><td>ZSB-110</td><td>2026-09-14 09:30:45</td><td>E-402</td><td></td><td>White</td></tr>
      <tr bgcolor=#DEDEDF><td>1003</td><td>MAM</td><td></td><td>ZSB-204</td><td>2026-09-14 10:00:00</td><td>E-317</td><td>x</td><td>Red</td></tr>
      <tr bgcolor=#DEDEDF><td></td><td>MAM</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      </table>`;

    it('extracts every real row and skips rows with no No.', () => {
      const rows = parseListRows(html, 'MAM');
      expect(rows.map((r) => r.no)).toEqual(['1001', '1002', '1003']);
    });

    it('recovers the CarID despite the missing <td> and uppercase <A>', () => {
      const [first, second] = parseListRows(html, 'MAM');
      expect(first.carId).toBe('CAR-1');
      expect(second.carId).toBe('CAR-2');
    });

    it('handles a row with no CarID link at all', () => {
      const third = parseListRows(html, 'MAM')[2];
      expect(third.carId).toBe('');
      expect(third.zsb).toBe('ZSB-204');
    });

    it('decodes HTML entities in free-text cells', () => {
      expect(parseListRows(html, 'MAM')[0].comment).toBe('Bent & replaced');
    });

    it('maps the remaining columns in the right order', () => {
      const first = parseListRows(html, 'MAM')[0];
      expect(first.zsb).toBe('ZSB-100');
      expect(first.errorCode).toBe('E-101');
      expect(first.color).toBe('Black');
      expect(new Date(first.registered).getHours()).toBe(8);
    });

    it('is repeatable — the module-level /g regex must not carry lastIndex', () => {
      // A stateful /g pattern would return rows on the first call and fewer
      // (or none) on the second. This is the classic Java→JS porting bug.
      expect(parseListRows(html, 'MAM')).toHaveLength(3);
      expect(parseListRows(html, 'MAM')).toHaveLength(3);
      expect(parseListRows(html, 'MAM')).toHaveLength(3);
    });

    it('returns nothing for an unrelated page instead of throwing', () => {
      expect(parseListRows('<html><body>Session expired</body></html>', 'MAM')).toEqual([]);
    });
  });

  describe('parseDetailFields', () => {
    const html = `
      <table>
        <tr><td>Rework ID</td><td>1001</td></tr>
        <tr><td>CarID / Unique No.</td><td>CAR-1</td></tr>
        <tr><td>Registered</td><td>2026-09-14 08:15:00</td></tr>
        <tr><td>Reworked</td><td>-</td><td>2026-09-14 11:45:00</td></tr>
        <tr><td>Quality Gate</td><td>EOL Test</td></tr>
        <tr><td>Error code</td><td>E-101</td></tr>
        <tr><td>Comment</td><td>Reworked &amp; verified</td></tr>
      </table>`;

    it('groups fragments under the preceding known label', () => {
      const dict = parseDetailFields(html);
      expect(dict.get('rework id')).toEqual(['1001']);
      expect(dict.get('carid / unique no.')).toEqual(['CAR-1']);
      expect(dict.get('quality gate')).toEqual(['EOL Test']);
    });

    it('matches labels case-insensitively', () => {
      // The page writes "Error code"; the label table is lowercase.
      expect(parseDetailFields(html).get('error code')).toEqual(['E-101']);
    });

    it('keeps multiple fragments for one label, in order', () => {
      // This is why the port reads "reworked" at index 2 rather than 1 — a
      // label can own more than one cell. The real page's exact arrangement is
      // still unverified; only the ordering behaviour is asserted here.
      expect(parseDetailFields(html).get('reworked')).toEqual([
        '-',
        '2026-09-14 11:45:00',
      ]);
    });

    it('decodes entities in values', () => {
      expect(parseDetailFields(html).get('comment')).toEqual(['Reworked & verified']);
    });

    // The relay matches labels with startsWith(), so a comment beginning with
    // a label word is swallowed as that field and the comment is lost. These
    // cases pin the fix from both sides: prose must survive as a value, and
    // the label forms the real page actually uses must still be recognised.
    it('does not mistake prose starting with a label word for that label', () => {
      const dict = parseDetailFields(
        '<table><tr><td>Comment</td><td>Reworked &amp; verified, registered twice</td></tr></table>',
      );
      expect(dict.get('comment')).toEqual(['Reworked & verified, registered twice']);
      expect(dict.has('reworked')).toBe(false);
      expect(dict.has('registered')).toBe(false);
    });

    it('does not treat "label word + number" prose as a label', () => {
      // An earlier rule accepted "Label 2026-…" with no colon. The real page
      // never uses that form (it is always "label:" or a label in its own
      // cell), and the rule misread descriptions such as "shift 2 missing".
      const dict = parseDetailFields(
        '<table><tr><td>Description</td><td>shift 2 connector missing</td></tr></table>',
      );
      expect(dict.get('description')).toEqual(['shift 2 connector missing']);
      expect(dict.has('shift')).toBe(false);
    });

    it('recognises an inline "Label: value"', () => {
      const dict = parseDetailFields(
        '<table><tr><td>Registered: 2026-09-14 08:15:00</td></tr></table>',
      );
      expect(dict.get('registered')).toEqual(['2026-09-14 08:15:00']);
    });

    it('does not let a short label shadow a longer one', () => {
      // "shift" is also a label; "defect shift" must win.
      const dict = parseDetailFields(
        '<table><tr><td>Defect shift</td><td>2</td></tr></table>',
      );
      expect(dict.get('defect shift')).toEqual(['2']);
      expect(dict.has('shift')).toBe(false);
    });

    it('returns an empty map for a page with no table, so callers can dump it', () => {
      expect(parseDetailFields('<html><body>error</body></html>').size).toBe(0);
    });
  });
});
