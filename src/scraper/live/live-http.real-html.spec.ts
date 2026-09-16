import { parseListRows } from './live-http.source';

/**
 * Parser checks against REAL markup captured from rework.jenapp0001.sebn.com
 * (the "Select CarID" search-results page), as opposed to fixtures written
 * from a description of it.
 *
 * Everything in REAL_LIST_HTML below is verbatim from the live server —
 * unquoted bgcolor, uppercase <A>, a header row in a different colour, an
 * anchor with no CarID text, and French free-text comments.
 *
 * Note the site's own quirks that these lock in:
 *   - error codes are bare numbers (140, 151, 520), not "E-123" style
 *   - the Color column is present but always empty in practice
 *   - ZSB is the CarID plus a two-digit suffix
 */
const REAL_LIST_HTML = `<html>
    <body bgcolor=#F0F0F0>
 Select CarID: <Table bgColor=#304050 cellpadding=1 cellspacing=1><tr bgcolor=#DDCACA><td>No.</td><td>Model</td><td>CarID</td><td>ZSB</td><td>Registered</td><td>Error</td><td>Comment</td><td>Color</td></tr><tr bgcolor=#DEDEDF><td>2947</td><td>MCM</td><td><A href="Szczegol.php?numer=2947&model=MCM">006304952C</A></td><td>006304952C00</td><td>2026-09-14 06:29:01</td><td>500</td><td>pas de continuite n30/3*1-b-v4 voie21 x18/53*5-s-v1 voie4 lt</td><td></td></tr><tr bgcolor=#DEDEDF><td>2946</td><td>MCM</td><td><A href="Szczegol.php?numer=2946&model=MCM">006305296C</A></td><td>006305296C00</td><td>2026-09-14 06:08:14</td><td>500</td><td>PAS DE CONTINUITE A2/93*1-B-V2 VOIE6 LTG2482380 N62/5*2-B-V2</td><td></td></tr><tr bgcolor=#DEDEDF><td>2937</td><td>MCM</td><td><A href="Szczegol.php?numer=2937&model=MCM"></A></td><td></td><td>2026-09-13 08:50:28</td><td></td><td></td><td></td></tr><tr bgcolor=#DEDEDF><td>2936</td><td>MCM</td><td><A href="Szczegol.php?numer=2936&model=MCM">006301726C</A></td><td>006301726C02</td><td>2026-09-13 08:40:31</td><td>140</td><td></td><td></td></tr></Table>
    </body>
</html>`;

describe('list parser against real site HTML', () => {
  const rows = parseListRows(REAL_LIST_HTML, 'MCM');

  it('extracts every data row and skips the differently-coloured header row', () => {
    // The header is <tr bgcolor=#DDCACA>; only #DEDEDF rows carry data.
    expect(rows.map((r) => r.no)).toEqual(['2947', '2946', '2937', '2936']);
  });

  it('pulls the CarID out of the uppercase anchor', () => {
    expect(rows[0].carId).toBe('006304952C');
    expect(rows[1].carId).toBe('006305296C');
  });

  it('handles an anchor that contains no CarID text', () => {
    const empty = rows.find((r) => r.no === '2937')!;
    expect(empty.carId).toBe('');
    expect(empty.zsb).toBe('');
    expect(empty.errorCode).toBe('');
  });

  it('parses the real timestamp format as local wall-clock time', () => {
    const d = new Date(rows[0].registered);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // September
    expect(d.getDate()).toBe(14);
    expect(d.getHours()).toBe(6);
    expect(d.getMinutes()).toBe(29);
  });

  it('keeps the numeric error codes verbatim', () => {
    expect(rows[0].errorCode).toBe('500');
    expect(rows[3].errorCode).toBe('140');
  });

  it('keeps French free text intact, in both cases', () => {
    expect(rows[0].comment).toBe(
      'pas de continuite n30/3*1-b-v4 voie21 x18/53*5-s-v1 voie4 lt',
    );
    expect(rows[1].comment).toBe(
      'PAS DE CONTINUITE A2/93*1-B-V2 VOIE6 LTG2482380 N62/5*2-B-V2',
    );
  });

  it('reads ZSB as the CarID plus its suffix', () => {
    expect(rows[0].zsb).toBe('006304952C00');
    expect(rows[3].zsb).toBe('006301726C02');
  });

  it('tolerates the always-empty Color column', () => {
    expect(rows.every((r) => r.color === '')).toBe(true);
  });

  it('stamps the model we searched for onto every row', () => {
    expect(rows.every((r) => r.model === 'MCM')).toBe(true);
  });
});
