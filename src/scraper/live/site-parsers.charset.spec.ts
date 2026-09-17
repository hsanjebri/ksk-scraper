import { decodeHtmlBytes } from './site-parsers';

/**
 * The captured pages contain real accented comments ("connecteur endommagé",
 * "pas de continuité", "30+31°"), but cannot show whether the server sends
 * them as UTF-8 or Latin-1. Decoding one as the other doesn't throw — it
 * silently writes U+FFFD or "Ã©" into the database. So the decoder must work
 * out which it received.
 */
const TEXT = 'connecteur endommagé — pas de continuité 30+31°';
const LATIN1_TEXT = 'connecteur endommagé, pas de continuité 30+31°'; // no em dash: not in Latin-1

describe('decodeHtmlBytes', () => {
  it('reads UTF-8 bytes as UTF-8', () => {
    const { text, charset } = decodeHtmlBytes(Buffer.from(TEXT, 'utf8'));
    expect(text).toBe(TEXT);
    expect(charset).toBe('utf-8');
  });

  it('detects Latin-1 bytes with no charset declared, instead of corrupting them', () => {
    const { text, charset } = decodeHtmlBytes(Buffer.from(LATIN1_TEXT, 'latin1'));
    expect(text).toBe(LATIN1_TEXT);
    expect(text).not.toContain('�');
    expect(charset).toBe('windows-1252');
  });

  it('honours a non-UTF-8 charset declared in Content-Type', () => {
    const { text } = decodeHtmlBytes(
      Buffer.from(LATIN1_TEXT, 'latin1'),
      'text/html; charset=ISO-8859-1',
    );
    expect(text).toBe(LATIN1_TEXT);
  });

  it('still falls back when a server wrongly declares UTF-8 for Latin-1 bytes', () => {
    const { text } = decodeHtmlBytes(Buffer.from(LATIN1_TEXT, 'latin1'), 'text/html; charset=utf-8');
    expect(text).toBe(LATIN1_TEXT);
  });

  it('lets SITE_CHARSET override everything', () => {
    const { text, charset } = decodeHtmlBytes(Buffer.from(TEXT, 'utf8'), null, 'utf-8');
    expect(text).toBe(TEXT);
    expect(charset).toBe('utf-8');
  });

  it('strips a UTF-8 byte-order mark', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<html>', 'utf8')]);
    expect(decodeHtmlBytes(bytes).text).toBe('<html>');
  });
});
