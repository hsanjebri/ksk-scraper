import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Request signing for the plant collector. Pure module, no Nest imports.
 *
 * The key itself never travels. Each request carries:
 *   X-Sync-Timestamp  Unix seconds when it was signed
 *   X-Sync-Nonce      16–64 hex characters, unique per request
 *   X-Sync-Signature  hex HMAC-SHA256(key, timestamp + "." + nonce + "." + body)
 *
 * The body is the exact bytes the agent sent, after gzip decompression and
 * before any JSON parsing — the server checks the signature before it reads
 * a single field.
 *
 * A captured request cannot be reused: outside the time window it is stale,
 * inside it its nonce has already been seen.
 */

export const SIGNATURE_WINDOW_SECONDS = 300;
export const MIN_KEY_LENGTH = 32;

export type SignatureVerdict =
  | 'ok'
  | 'no-key-configured'
  | 'missing-headers'
  | 'malformed-headers'
  | 'outside-time-window'
  | 'replayed'
  | 'bad-signature';

export function computeSignature(key: string, timestamp: string, nonce: string, body: Buffer): string {
  return createHmac('sha256', key)
    .update(`${timestamp}.${nonce}.`, 'utf8')
    .update(body)
    .digest('hex');
}

/**
 * SYNC_SECRET may hold two keys separated by a comma — the current one and
 * its replacement — so a key can be rotated without stopping the collector.
 * Keys shorter than MIN_KEY_LENGTH are ignored.
 */
export function parseKeys(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length >= MIN_KEY_LENGTH);
}

/** Nonces seen inside the time window. In memory: a single server instance. */
export class NonceCache {
  private readonly expiries = new Map<string, number>();

  constructor(private readonly maxEntries = 50_000) {}

  has(nonce: string, nowSeconds: number): boolean {
    const expiry = this.expiries.get(nonce);
    return expiry !== undefined && expiry > nowSeconds;
  }

  add(nonce: string, expiresAt: number, nowSeconds: number): void {
    if (this.expiries.size >= this.maxEntries) this.prune(nowSeconds);
    // Still full of live entries: drop the oldest. A legitimate agent sends a
    // few requests a minute, so this only happens under a flood.
    if (this.expiries.size >= this.maxEntries) {
      const oldest = this.expiries.keys().next().value;
      if (oldest !== undefined) this.expiries.delete(oldest);
    }
    this.expiries.set(nonce, expiresAt);
  }

  prune(nowSeconds: number): void {
    for (const [nonce, expiry] of this.expiries) {
      if (expiry <= nowSeconds) this.expiries.delete(nonce);
    }
  }
}

export interface SignedRequest {
  timestamp: unknown;
  nonce: unknown;
  signature: unknown;
  body: unknown;
}

export function verifySignedRequest(
  request: SignedRequest,
  keys: string[],
  nonces: NonceCache,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureVerdict {
  if (keys.length === 0) return 'no-key-configured';

  const { timestamp, nonce, signature, body } = request;
  if (timestamp === undefined || nonce === undefined || signature === undefined) return 'missing-headers';
  if (
    typeof timestamp !== 'string' ||
    typeof nonce !== 'string' ||
    typeof signature !== 'string' ||
    !/^\d{9,11}$/.test(timestamp) ||
    !/^[0-9a-f]{16,64}$/i.test(nonce) ||
    !/^[0-9a-f]{64}$/i.test(signature) ||
    !Buffer.isBuffer(body)
  ) {
    return 'malformed-headers';
  }

  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_WINDOW_SECONDS) return 'outside-time-window';

  const given = Buffer.from(signature.toLowerCase(), 'hex');
  const valid = keys.some((key) => {
    const expected = Buffer.from(computeSignature(key, timestamp, nonce, body), 'hex');
    return timingSafeEqual(given, expected);
  });
  if (!valid) return 'bad-signature';

  // Checked after the signature, so an unauthenticated caller cannot fill
  // the cache or probe which nonces have been used.
  const nonceKey = nonce.toLowerCase();
  if (nonces.has(nonceKey, nowSeconds)) return 'replayed';
  nonces.add(nonceKey, Number(timestamp) + SIGNATURE_WINDOW_SECONDS, nowSeconds);
  return 'ok';
}
