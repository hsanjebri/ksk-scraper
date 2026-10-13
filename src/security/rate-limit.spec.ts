import {
  bucketFor,
  FixedWindowLimiter,
  normaliseIp,
  parseAllowlist,
} from './rate-limit';

describe('rate limiting', () => {
  const login = bucketFor('POST', '/auth/login');

  it('allows up to the limit, then refuses with a retry delay', () => {
    const limiter = new FixedWindowLimiter();
    const now = 1_000_000;
    for (let i = 0; i < login.limit; i++)
      expect(limiter.hit(login, '1.2.3.4', now).allowed).toBe(true);
    const refused = limiter.hit(login, '1.2.3.4', now);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each client separately', () => {
    const limiter = new FixedWindowLimiter();
    for (let i = 0; i <= login.limit; i++) limiter.hit(login, 'attacker', 0);
    expect(limiter.hit(login, 'attacker', 0).allowed).toBe(false);
    expect(limiter.hit(login, 'colleague', 0).allowed).toBe(true);
  });

  it('resets after the window', () => {
    const limiter = new FixedWindowLimiter();
    for (let i = 0; i <= login.limit; i++) limiter.hit(login, 'x', 0);
    expect(limiter.hit(login, 'x', login.windowMs + 1).allowed).toBe(true);
  });

  it('keeps sign-in far tighter than the rest of the API', () => {
    expect(login.limit).toBeLessThan(bucketFor('GET', '/records').limit);
    expect(bucketFor('POST', '/api/scraper/ingest/details').name).toBe(
      'ingest',
    );
  });

  it('stays bounded in memory under a flood of distinct addresses', () => {
    const limiter = new FixedWindowLimiter(100);
    for (let i = 0; i < 1000; i++)
      limiter.hit(login, `10.0.${i >> 8}.${i & 255}`, 0);
    // No assertion on internals beyond not throwing and still answering.
    expect(limiter.hit(login, 'new-client', 0).allowed).toBe(true);
  });
});

describe('IP allowlist parsing', () => {
  it('reads a comma-separated list, empty meaning no restriction', () => {
    expect([...parseAllowlist(' 41.226.1.2 , 41.226.1.3 ')]).toEqual([
      '41.226.1.2',
      '41.226.1.3',
    ]);
    expect(parseAllowlist(undefined).size).toBe(0);
  });

  it('matches IPv4 clients reported in IPv6-mapped form', () => {
    expect(normaliseIp('::ffff:41.226.1.2')).toBe('41.226.1.2');
  });
});
