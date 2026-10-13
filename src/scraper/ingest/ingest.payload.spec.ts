import {
  Parsed,
  decodeBase64Page,
  parseDetailPayload,
  parseFailed,
  parseListPayload,
} from './ingest.payload';
import {
  computeSignature,
  NonceCache,
  parseKeys,
  verifySignedRequest,
} from './signature';

const b64 = (text: string) => Buffer.from(text, 'latin1').toString('base64');
/** The rejection message, or null when the payload was accepted. */
const errorOf = <T>(result: Parsed<T>) =>
  parseFailed(result) ? result.error : null;

/**
 * The ingest endpoint is the one door into this system that is open on the
 * public internet, and what comes through it becomes the quality numbers the
 * plant reports. These tests pin what it refuses.
 */
describe('ingest payload validation', () => {
  describe('decodeBase64Page', () => {
    it('decodes a page to its exact bytes', () => {
      const result = decodeBase64Page(
        b64('<tr>pas de continuité</tr>'),
        'page',
      );
      expect(parseFailed(result)).toBe(false);
      if (parseFailed(result)) return;
      // Latin-1 bytes survive as bytes: decoding to text happens later, with
      // charset detection, exactly as when the site is scraped directly.
      expect(Buffer.from(result.value).toString('latin1')).toBe(
        '<tr>pas de continuité</tr>',
      );
    });

    it('tolerates the line breaks PowerShell inserts in base64', () => {
      const wrapped = b64('<html>ok</html>').replace(/(.{4})/g, '$1\r\n');
      expect(parseFailed(decodeBase64Page(wrapped, 'page'))).toBe(false);
    });

    it('rejects a truncated upload instead of parsing half a page', () => {
      // Buffer.from ignores invalid base64 silently — a mangled page would
      // otherwise arrive short and be parsed as if it were the real thing.
      const truncated = b64('<html>' + 'x'.repeat(40) + '</html>').slice(0, -3);
      expect(errorOf(decodeBase64Page(truncated, 'page'))).toMatch(
        /not valid base64/,
      );
    });

    it('rejects junk, empty strings and non-strings', () => {
      expect(errorOf(decodeBase64Page('not base64 at all!', 'page'))).toMatch(
        /not valid base64/,
      );
      expect(errorOf(decodeBase64Page('', 'page'))).toMatch(/missing/);
      expect(errorOf(decodeBase64Page(undefined, 'page'))).toMatch(/missing/);
      expect(errorOf(decodeBase64Page(12345, 'page'))).toMatch(/missing/);
    });

    it('rejects a page far larger than any real one', () => {
      const huge = Buffer.alloc(9 * 1024 * 1024, 0x41).toString('base64');
      expect(errorOf(decodeBase64Page(huge, 'page'))).toMatch(/too large/);
    });
  });

  describe('parseListPayload', () => {
    const valid = {
      model: 'MAM',
      listBase64: b64('<html>rows</html>'),
      agent: 'mohamed-pc',
    };

    it('accepts a well-formed push', () => {
      const result = parseListPayload(valid);
      expect(parseFailed(result)).toBe(false);
      if (parseFailed(result)) return;
      expect(result.value.model).toBe('MAM');
      expect(result.value.agent).toBe('mohamed-pc');
    });

    it('accepts a push with no agent name', () => {
      const result = parseListPayload({
        model: 'MCM',
        listBase64: valid.listBase64,
      });
      expect(parseFailed(result)).toBe(false);
      if (parseFailed(result)) return;
      expect(result.value.agent).toBeNull();
    });

    it('refuses a model the site does not have', () => {
      expect(errorOf(parseListPayload({ ...valid, model: 'MBEAM' }))).toMatch(
        /model must be one of/,
      );
      expect(errorOf(parseListPayload({ ...valid, model: '' }))).toMatch(
        /model must be one of/,
      );
      expect(
        errorOf(parseListPayload({ listBase64: valid.listBase64 })),
      ).toMatch(/model must be one of/);
    });

    it('refuses anything that is not an object', () => {
      expect(errorOf(parseListPayload('MAM'))).toMatch(/JSON object/);
      expect(errorOf(parseListPayload(null))).toMatch(/JSON object/);
      expect(errorOf(parseListPayload([valid]))).toMatch(/JSON object/);
    });
  });

  describe('parseDetailPayload', () => {
    const page = (no: string) => ({ no, base64: b64(`<html>${no}</html>`) });

    it('accepts a batch and keeps the order', () => {
      const result = parseDetailPayload({
        model: 'MCM',
        pages: [page('3059'), page('3058')],
      });
      expect(parseFailed(result)).toBe(false);
      if (parseFailed(result)) return;
      expect(result.value.pages.map((p) => p.no)).toEqual(['3059', '3058']);
    });

    it('refuses a record number that is not a number', () => {
      // These reach a database query and a file name, so nothing exotic passes.
      expect(
        errorOf(
          parseDetailPayload({ model: 'MAM', pages: [page('12; DROP TABLE')] }),
        ),
      ).toMatch(/invalid record number/);
      expect(
        errorOf(
          parseDetailPayload({ model: 'MAM', pages: [page('../../etc')] }),
        ),
      ).toMatch(/invalid record number/);
      expect(
        errorOf(parseDetailPayload({ model: 'MAM', pages: [page('')] })),
      ).toMatch(/invalid record number/);
    });

    it('refuses an empty or oversized batch', () => {
      expect(errorOf(parseDetailPayload({ model: 'MAM', pages: [] }))).toMatch(
        /empty/,
      );
      const tooMany = Array.from({ length: 501 }, (_, i) =>
        page(String(i + 1)),
      );
      expect(
        errorOf(parseDetailPayload({ model: 'MAM', pages: tooMany })),
      ).toMatch(/too many pages/);
    });

    it('refuses the whole batch when one page is corrupt', () => {
      // Partial acceptance would leave the agent believing pages were stored.
      const result = parseDetailPayload({
        model: 'MAM',
        pages: [page('2944'), { no: '2945', base64: 'not base64!' }],
      });
      expect(errorOf(result)).toMatch(/page 2945/);
    });

    it('refuses pages that are not an array', () => {
      expect(
        errorOf(parseDetailPayload({ model: 'MAM', pages: page('1') })),
      ).toMatch(/must be an array/);
    });

    it('refuses fields outside the schema, at both levels', () => {
      expect(
        errorOf(
          parseDetailPayload({ model: 'MAM', pages: [page('1')], debug: true }),
        ),
      ).toMatch(/unexpected field "debug"/);
      expect(
        errorOf(
          parseDetailPayload({
            model: 'MAM',
            pages: [{ ...page('1'), sql: 'x' }],
          }),
        ),
      ).toMatch(/unexpected field "sql" in a page/);
    });
  });

  describe('schema strictness', () => {
    it('refuses unknown fields in a list push instead of ignoring them', () => {
      const result = parseListPayload({
        model: 'MAM',
        listBase64: b64('<html/>'),
        __proto__x: 1,
      });
      expect(errorOf(result)).toMatch(/unexpected field/);
    });
  });
});

/**
 * HMAC request signing for the plant collector. These pin what an attacker
 * who can reach the public endpoint — or who captured one real request —
 * is unable to do.
 */
describe('collector request signing', () => {
  const KEY = 'k'.repeat(48);
  const NOW = 1_790_000_000;
  const body = Buffer.from('{"model":"MAM","listBase64":"PGh0bWwvPg=="}');
  const sign = (
    over: Partial<{
      timestamp: string;
      nonce: string;
      body: Buffer;
      key: string;
    }> = {},
  ) => {
    const timestamp = over.timestamp ?? String(NOW);
    const nonce = over.nonce ?? 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const signed = over.body ?? body;
    return {
      timestamp,
      nonce,
      body: signed,
      signature: computeSignature(over.key ?? KEY, timestamp, nonce, signed),
    };
  };

  it('accepts a correctly signed, fresh request', () => {
    expect(verifySignedRequest(sign(), [KEY], new NonceCache(), NOW)).toBe(
      'ok',
    );
  });

  it('never needs the key on the wire', () => {
    const request = sign();
    expect(
      JSON.stringify({ ...request, body: request.body.toString() }),
    ).not.toContain(KEY);
  });

  it('refuses a request signed with another key', () => {
    expect(
      verifySignedRequest(
        sign({ key: 'z'.repeat(48) }),
        [KEY],
        new NonceCache(),
        NOW,
      ),
    ).toBe('bad-signature');
  });

  it('refuses a body changed after signing, even by one byte', () => {
    const request = sign();
    const tampered = Buffer.from(request.body.toString().replace('MAM', 'MCM'));
    expect(
      verifySignedRequest(
        { ...request, body: tampered },
        [KEY],
        new NonceCache(),
        NOW,
      ),
    ).toBe('bad-signature');
  });

  it('refuses a replay of a captured request', () => {
    const nonces = new NonceCache();
    const request = sign();
    expect(verifySignedRequest(request, [KEY], nonces, NOW)).toBe('ok');
    expect(verifySignedRequest(request, [KEY], nonces, NOW + 10)).toBe(
      'replayed',
    );
  });

  it('refuses requests older or newer than five minutes', () => {
    expect(
      verifySignedRequest(
        sign({ timestamp: String(NOW - 301) }),
        [KEY],
        new NonceCache(),
        NOW,
      ),
    ).toBe('outside-time-window');
    expect(
      verifySignedRequest(
        sign({ timestamp: String(NOW + 301) }),
        [KEY],
        new NonceCache(),
        NOW,
      ),
    ).toBe('outside-time-window');
    expect(
      verifySignedRequest(
        sign({ timestamp: String(NOW - 299) }),
        [KEY],
        new NonceCache(),
        NOW,
      ),
    ).toBe('ok');
  });

  it('refuses a re-signed replay whose timestamp was moved — the signature covers it', () => {
    const request = sign();
    expect(
      verifySignedRequest(
        { ...request, timestamp: String(NOW + 5) },
        [KEY],
        new NonceCache(),
        NOW,
      ),
    ).toBe('bad-signature');
  });

  it('refuses missing and malformed headers without throwing', () => {
    const nonces = new NonceCache();
    expect(
      verifySignedRequest(
        { ...sign(), signature: undefined },
        [KEY],
        nonces,
        NOW,
      ),
    ).toBe('missing-headers');
    expect(
      verifySignedRequest({ ...sign(), signature: 'zz' }, [KEY], nonces, NOW),
    ).toBe('malformed-headers');
    expect(
      verifySignedRequest({ ...sign(), nonce: 'short' }, [KEY], nonces, NOW),
    ).toBe('malformed-headers');
    expect(
      verifySignedRequest(
        { ...sign(), timestamp: 'yesterday' },
        [KEY],
        nonces,
        NOW,
      ),
    ).toBe('malformed-headers');
    expect(
      verifySignedRequest(
        { ...sign(), body: { parsed: true } },
        [KEY],
        nonces,
        NOW,
      ),
    ).toBe('malformed-headers');
  });

  it('fails closed when no usable key is configured', () => {
    expect(verifySignedRequest(sign(), [], new NonceCache(), NOW)).toBe(
      'no-key-configured',
    );
    expect(parseKeys('too-short')).toEqual([]);
    expect(parseKeys(undefined)).toEqual([]);
  });

  it('accepts either of two keys, so the key can be rotated without downtime', () => {
    const next = 'n'.repeat(48);
    const keys = parseKeys(`${KEY}, ${next}`);
    expect(keys).toHaveLength(2);
    expect(
      verifySignedRequest(sign({ key: next }), keys, new NonceCache(), NOW),
    ).toBe('ok');
  });

  it('does not let an unsigned caller fill the replay cache', () => {
    const nonces = new NonceCache();
    const forged = { ...sign(), signature: 'f'.repeat(64) };
    expect(verifySignedRequest(forged, [KEY], nonces, NOW)).toBe(
      'bad-signature',
    );
    // The genuine request with that nonce still goes through.
    expect(verifySignedRequest(sign(), [KEY], nonces, NOW)).toBe('ok');
  });
});
