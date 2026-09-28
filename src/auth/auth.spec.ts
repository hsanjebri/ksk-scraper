import { parseDashboardUsers, readCookie, sessionSecretProblem } from './auth-config';
import { hashPassword, isValidPasswordHash, verifyPassword } from './password';
import { signToken, verifyToken } from './session-token';

const SECRET = 'a'.repeat(40);
const now = () => Math.floor(Date.now() / 1000);

describe('password hashing', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await hashPassword('correct horse battery staple');
  });

  it('verifies the right password and rejects others', async () => {
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('salts every hash, so equal passwords do not produce equal hashes', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('never stores the password itself', () => {
    expect(hash).not.toContain('correct');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('rejects malformed or hostile stored hashes instead of throwing', async () => {
    expect(await verifyPassword('x', 'plain-text-password')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$garbage')).toBe(false);
    // A cost this high would take gigabytes per login — refused outright.
    expect(isValidPasswordHash(hash.replace(/^scrypt\$\d+/, 'scrypt$1073741824'))).toBe(false);
    expect(isValidPasswordHash(hash.replace(/^scrypt\$\d+/, 'scrypt$1000'))).toBe(false); // not a power of two
  });
});

describe('session tokens', () => {
  const claims = (overrides = {}) => ({ sub: 'alice', typ: 'session' as const, iat: now(), exp: now() + 3600, ...overrides });

  it('round-trips a valid token', () => {
    expect(verifyToken(signToken(claims(), SECRET), SECRET, 'session')?.sub).toBe('alice');
  });

  it('rejects a token signed with another secret', () => {
    expect(verifyToken(signToken(claims(), 'b'.repeat(40)), SECRET, 'session')).toBeNull();
  });

  it('rejects a token whose claims were edited', () => {
    const token = signToken(claims(), SECRET);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: 'admin' }),
    ).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, SECRET, 'session')).toBeNull();
  });

  it('rejects an expired token', () => {
    expect(verifyToken(signToken(claims({ iat: now() - 7200, exp: now() - 1 }), SECRET), SECRET, 'session')).toBeNull();
  });

  it('never accepts a socket ticket as a session, or the reverse', () => {
    const wsTicket = signToken(claims({ typ: 'ws' }), SECRET);
    expect(verifyToken(wsTicket, SECRET, 'session')).toBeNull();
    expect(verifyToken(signToken(claims(), SECRET), SECRET, 'ws')).toBeNull();
  });

  it('rejects junk without throwing', () => {
    for (const junk of [undefined, null, 42, '', '.', 'a.b.c', 'x'.repeat(5000), 'not-a-token']) {
      expect(verifyToken(junk, SECRET, 'session')).toBeNull();
    }
  });
});

describe('dashboard user configuration', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await hashPassword('a strong password here');
  });

  it('reads several users, case-insensitively', () => {
    const { users, problems } = parseDashboardUsers(`Alice:${hash};bob:${hash}`);
    expect(problems).toEqual([]);
    expect([...users.keys()]).toEqual(['alice', 'bob']);
  });

  it('refuses a plain-text password in place of a hash', () => {
    const { users, problems } = parseDashboardUsers('kskscrapper:kskscrapper');
    expect(users.size).toBe(0);
    expect(problems[0]).toMatch(/not have a valid scrypt hash/);
    // The problem message must not leak what was configured.
    expect(problems.join(' ')).not.toContain(':kskscrapper');
  });

  it('treats an unset variable as no users — sign-in disabled, not open', () => {
    expect(parseDashboardUsers(undefined).users.size).toBe(0);
  });

  it('requires a long session secret', () => {
    expect(sessionSecretProblem(undefined)).toMatch(/not set/);
    expect(sessionSecretProblem('short')).toMatch(/at least 32/);
    expect(sessionSecretProblem(SECRET)).toBeNull();
  });

  it('reads a cookie by exact name only', () => {
    const header = 'other=1; __Host-ksk_session=abc.def; ksk_session_evil=zzz';
    expect(readCookie(header, '__Host-ksk_session')).toBe('abc.def');
    expect(readCookie(header, 'missing')).toBeNull();
    expect(readCookie(undefined, '__Host-ksk_session')).toBeNull();
  });
});
