import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'crypto';

/**
 * Password hashing with scrypt (memory-hard, in Node's standard library — no
 * extra dependency to audit).
 *
 * Stored format: `scrypt$<N>$<r>$<p>$<salt b64>$<key b64>`, so the cost can be
 * raised later without invalidating existing hashes.
 *
 * Pure module: no Nest or TypeORM imports, so it is cheap to test.
 */

const DEFAULTS = { N: 2 ** 15, r: 8, p: 1, keyLength: 32, saltLength: 16 };

/** Bounds on parameters read back from configuration, so a bad or hostile
 *  value cannot make every login burn gigabytes of memory. */
const LIMITS = { maxN: 2 ** 20, maxR: 16, maxP: 4, minKey: 16, maxKey: 64 };

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Headroom above scrypt's working set (128·N·r bytes). */
const maxmemFor = (N: number, r: number) => 128 * N * r * 2;

/** Unicode-normalised so the same password typed on two keyboards matches. */
const normalise = (password: string) => password.normalize('NFKC');

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p, keyLength, saltLength } = DEFAULTS;
  const salt = randomBytes(saltLength);
  const key = await scrypt(normalise(password), salt, keyLength, {
    N,
    r,
    p,
    maxmem: maxmemFor(N, r),
  });
  return [
    'scrypt',
    N,
    r,
    p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/** Parsed form of a stored hash, or null when it is not one we accept. */
function parse(encoded: string) {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const key = Buffer.from(parts[5], 'base64');

  const powerOfTwo = Number.isInteger(N) && N > 1 && (N & (N - 1)) === 0;
  if (!powerOfTwo || N > LIMITS.maxN) return null;
  if (!Number.isInteger(r) || r < 1 || r > LIMITS.maxR) return null;
  if (!Number.isInteger(p) || p < 1 || p > LIMITS.maxP) return null;
  if (
    salt.length < 8 ||
    key.length < LIMITS.minKey ||
    key.length > LIMITS.maxKey
  )
    return null;
  return { N, r, p, salt, key };
}

export function isValidPasswordHash(encoded: string): boolean {
  return parse(encoded) !== null;
}

/**
 * Constant-time check of a password against a stored hash. Never throws on
 * bad input — a malformed hash is simply a failed login.
 */
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parsed = parse(encoded);
  if (!parsed) return false;
  const { N, r, p, salt, key } = parsed;
  try {
    const actual = await scrypt(normalise(password), salt, key.length, {
      N,
      r,
      p,
      maxmem: maxmemFor(N, r),
    });
    return timingSafeEqual(actual, key);
  } catch {
    return false;
  }
}
