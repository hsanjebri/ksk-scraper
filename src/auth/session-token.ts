import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed, expiring tokens — stateless, so the server keeps no session table.
 *
 *   token = base64url(JSON claims) + "." + base64url(HMAC-SHA256(secret, first part))
 *
 * Two kinds, and a token of one kind is never accepted as the other:
 *  - `session`: the dashboard session, carried in an HttpOnly cookie (hours).
 *  - `ws`: a one-minute ticket that authorises opening the live socket, which
 *    cannot carry the cookie because it connects to a different site.
 *
 * Revocation: rotating SESSION_SECRET invalidates every token at once; removing
 * a user from DASHBOARD_USERS invalidates that user's tokens (the service
 * checks the user still exists on every request).
 *
 * Pure module: no Nest imports, cheap to test.
 */

export type TokenType = 'session' | 'ws';

export interface TokenClaims {
  /** Username. */
  sub: string;
  typ: TokenType;
  /** Issued at, seconds since epoch. */
  iat: number;
  /** Expires at, seconds since epoch. */
  exp: number;
}

/** Long enough for any legitimate token, short enough to bound parsing work. */
const MAX_TOKEN_LENGTH = 1024;

const mac = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export function signToken(claims: TokenClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${payload}.${mac(payload, secret)}`;
}

/**
 * The claims if the token is authentic, of the expected type and unexpired;
 * otherwise null. Never throws on malformed input.
 */
export function verifyToken(
  token: unknown,
  secret: string,
  expectedType: TokenType,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): TokenClaims | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;

  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isClaims(claims)) return null;
  if (claims.typ !== expectedType) return null;
  if (claims.exp <= nowSeconds || claims.iat > nowSeconds + 60) return null;
  return claims;
}

function isClaims(value: unknown): value is TokenClaims {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.sub === 'string' &&
    c.sub.length > 0 &&
    (c.typ === 'session' || c.typ === 'ws') &&
    Number.isInteger(c.iat) &&
    Number.isInteger(c.exp)
  );
}
