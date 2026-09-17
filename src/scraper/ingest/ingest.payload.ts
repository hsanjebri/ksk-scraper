import { KSK_MODELS, KskModel } from '../constants';

/**
 * Validation and decoding for pages pushed by the plant-side agent.
 *
 * Pure on purpose: this is the one part of the bridge that handles input from
 * outside the process, and it has to be cheap to test. It also decides nothing
 * about the data — the same parsers used when scraping directly do that.
 *
 * Pages arrive as base64 of the RAW BYTES, not as text. The rework site
 * declares no charset, so decoding has to happen here with the same detection
 * the direct scraper uses; letting PowerShell decode first would corrupt the
 * accented French comments that make up a third of the data.
 */

/** One model's results page. */
export interface ListPayload {
  model: KskModel;
  bytes: Uint8Array;
  contentType: string | null;
  agent: string | null;
}

/** A batch of detail pages the agent was asked to fetch. */
export interface DetailPayload {
  model: KskModel;
  pages: { no: string; bytes: Uint8Array; contentType: string | null }[];
  agent: string | null;
}

export interface ParsedOk<T> {
  ok: true;
  value: T;
}
export interface ParsedError {
  ok: false;
  error: string;
}
export type Parsed<T> = ParsedOk<T> | ParsedError;

/**
 * Narrowing helper. This project compiles with `strictNullChecks: false`,
 * where TypeScript will not discriminate a union on a boolean literal — so
 * `if (!result.ok)` alone leaves `result.error` unreachable. An explicit type
 * predicate narrows regardless.
 */
export function parseFailed<T>(result: Parsed<T>): result is ParsedError {
  return !result.ok;
}

/** Generous but finite: the real list page is ~700 KB, ~1 MB of base64. */
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
/** One cycle's worth of detail pages; the agent is told how many to send. */
const MAX_PAGES_PER_BATCH = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asModel = (value: unknown): KskModel | null =>
  typeof value === 'string' && (KSK_MODELS as readonly string[]).includes(value)
    ? (value as KskModel)
    : null;

const asOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 200) : null;

/**
 * Decodes base64 and rejects anything that is not valid base64 of a plausible
 * size. Node's Buffer.from silently ignores invalid characters, so a truncated
 * or mangled upload would otherwise arrive as a short, half-valid page and be
 * parsed as if it were real.
 */
export function decodeBase64Page(value: unknown, label: string): Parsed<Uint8Array> {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, error: `${label} is missing` };
  }
  const compact = value.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    return { ok: false, error: `${label} is not valid base64` };
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length === 0) return { ok: false, error: `${label} is empty` };
  if (bytes.length > MAX_PAGE_BYTES) {
    return { ok: false, error: `${label} is too large (${bytes.length} bytes)` };
  }
  return { ok: true, value: new Uint8Array(bytes) };
}

export function parseListPayload(body: unknown): Parsed<ListPayload> {
  if (!isRecord(body)) return { ok: false, error: 'body must be a JSON object' };

  const model = asModel(body.model);
  if (!model) return { ok: false, error: `model must be one of ${KSK_MODELS.join(', ')}` };

  const decoded = decodeBase64Page(body.listBase64, 'listBase64');
  if (parseFailed(decoded)) return decoded;

  return {
    ok: true,
    value: {
      model,
      bytes: decoded.value,
      contentType: asOptionalString(body.contentType),
      agent: asOptionalString(body.agent),
    },
  };
}

export function parseDetailPayload(body: unknown): Parsed<DetailPayload> {
  if (!isRecord(body)) return { ok: false, error: 'body must be a JSON object' };

  const model = asModel(body.model);
  if (!model) return { ok: false, error: `model must be one of ${KSK_MODELS.join(', ')}` };

  if (!Array.isArray(body.pages)) return { ok: false, error: 'pages must be an array' };
  if (body.pages.length === 0) return { ok: false, error: 'pages is empty' };
  if (body.pages.length > MAX_PAGES_PER_BATCH) {
    return { ok: false, error: `too many pages in one batch (max ${MAX_PAGES_PER_BATCH})` };
  }

  const pages: DetailPayload['pages'] = [];
  for (const entry of body.pages) {
    if (!isRecord(entry)) return { ok: false, error: 'each page must be an object' };
    const no = typeof entry.no === 'string' ? entry.no.trim() : '';
    if (!/^\d{1,12}$/.test(no)) return { ok: false, error: `invalid record number "${String(entry.no)}"` };

    const decoded = decodeBase64Page(entry.base64, `page ${no}`);
    if (parseFailed(decoded)) return decoded;

    pages.push({ no, bytes: decoded.value, contentType: asOptionalString(entry.contentType) });
  }

  return { ok: true, value: { model, pages, agent: asOptionalString(body.agent) } };
}

/**
 * Constant-time-ish comparison of the shared secret.
 *
 * Compares every character regardless of where the first difference is, so the
 * time taken says nothing about how much of the secret was correct.
 */
export function secretMatches(provided: unknown, expected: string | undefined): boolean {
  if (!expected) return false; // fail closed: no secret configured, no ingest
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
