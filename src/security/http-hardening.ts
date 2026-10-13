import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import { bucketFor, FixedWindowLimiter, normaliseIp, parseAllowlist } from './rate-limit';

const logger = new Logger('HttpHardening');

/**
 * Transport-level protections, applied before any route or body parser runs
 * (so a flood is refused before its body is read).
 *
 * Settings:
 *   TRUST_PROXY_HOPS    proxies in front of the app (Railway's edge: 1). Wrong
 *                       values make the client IP spoofable via
 *                       X-Forwarded-For, so it is a number, never "true".
 *   CORS_ORIGINS        comma-separated origins allowed to call the API from a
 *                       browser. Empty (default) = none: the dashboard goes
 *                       through its same-origin /api proxy and needs no CORS.
 *   INGEST_ALLOWED_IPS  optional allowlist for the collector route, e.g. the
 *                       plant's public egress IP. Empty = any IP (the HMAC
 *                       signature is still required).
 */
export function applyHttpHardening(app: NestExpressApplication): void {
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? '1');
  app.set('trust proxy', Number.isInteger(hops) && hops >= 0 ? hops : 1);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(rateLimiter());
  app.use(ingestAllowlist());

  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length > 0) {
    app.enableCors({ origin: origins, credentials: true, methods: ['GET', 'POST'] });
  }
}

/**
 * Headers for an API that only ever returns JSON:
 *  - no-store: responses carry plant data behind a session; no browser,
 *    proxy or CDN (the Vercel rewrite) may keep a copy
 *  - a CSP that allows nothing, and no framing
 *  - HSTS so browsers never retry over plain HTTP
 */
function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
}

function rateLimiter() {
  const limiter = new FixedWindowLimiter();
  return (req: Request, res: Response, next: NextFunction): void => {
    const bucket = bucketFor(req.method, req.path);
    const decision = limiter.hit(bucket, normaliseIp(req.ip));
    if (decision.allowed) return next();

    res.setHeader('Retry-After', String(decision.retryAfterSeconds));
    if (bucket.name !== 'default') logger.warn(`Rate limit hit on ${bucket.name} by ${normaliseIp(req.ip)}.`);
    res.status(429).json({ statusCode: 429, message: 'Too many requests' });
  };
}

function ingestAllowlist() {
  const allowed = parseAllowlist(process.env.INGEST_ALLOWED_IPS);
  if (allowed.size > 0) logger.log(`Collector route restricted to ${allowed.size} IP address(es).`);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (allowed.size === 0 || !req.path.startsWith('/api/scraper/ingest')) return next();
    const ip = normaliseIp(req.ip);
    if (allowed.has(ip)) return next();
    logger.warn(`Collector request from a non-allowlisted address (${ip}) refused.`);
    // Same bare answer as a bad signature: nothing to learn from probing.
    res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
  };
}
