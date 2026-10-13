/**
 * Fixed-window rate limiting, per client IP and per bucket. Pure module (no
 * Nest imports) with no third-party dependency to audit.
 *
 * In memory, so the limits apply per server instance — right for the single
 * Railway replica this runs as. With several replicas, move the counters to a
 * shared store (see SECURITY.md, residual risks).
 */

export interface Bucket {
  name: string;
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export interface Decision {
  allowed: boolean;
  /** Seconds until the window resets; for the Retry-After header. */
  retryAfterSeconds: number;
  remaining: number;
}

export class FixedWindowLimiter {
  private readonly counters = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(private readonly maxKeys = 100_000) {}

  hit(bucket: Bucket, clientKey: string, now: number = Date.now()): Decision {
    const key = `${bucket.name}|${clientKey}`;
    let entry = this.counters.get(key);
    if (!entry || entry.resetAt <= now) {
      if (!entry && this.counters.size >= this.maxKeys) this.prune(now);
      entry = { count: 0, resetAt: now + bucket.windowMs };
      this.counters.set(key, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= bucket.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      remaining: Math.max(0, bucket.limit - entry.count),
    };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.counters) {
      if (entry.resetAt <= now) this.counters.delete(key);
    }
    // Still full under a flood of distinct addresses: drop the oldest.
    while (this.counters.size >= this.maxKeys) {
      const oldest = this.counters.keys().next().value;
      if (oldest === undefined) break;
      this.counters.delete(oldest);
    }
  }
}

/**
 * Which bucket a request falls in.
 *  - sign-in: tight, it is the one route an attacker would brute-force
 *    (on top of the per-user lockout in AuthService)
 *  - collector: roomy, a first-run backfill posts a few hundred batches
 *  - everything else: generous; the dashboard polls every few seconds
 */
export function bucketFor(method: string, path: string): Bucket {
  if (method === 'POST' && path === '/auth/login')
    return { name: 'login', limit: 20, windowMs: 60_000 };
  if (path.startsWith('/api/scraper/ingest'))
    return { name: 'ingest', limit: 600, windowMs: 60_000 };
  return { name: 'default', limit: 600, windowMs: 60_000 };
}

/** Exact-match IP allowlist from a comma-separated setting; empty = allow all. */
export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
  );
}

/** Express reports IPv4 clients as ::ffff:1.2.3.4 on dual-stack sockets. */
export function normaliseIp(ip: string | undefined): string {
  return (ip ?? '').replace(/^::ffff:/, '');
}
