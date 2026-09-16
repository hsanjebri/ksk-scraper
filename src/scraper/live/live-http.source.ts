import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { promises as fs } from 'fs';
import * as path from 'path';
import { KskModel } from '../constants';
import { RemoteDetailRecord, RemoteErrorCodeRow, RemoteListRow } from '../mock/mock-data.generator';
import { RemoteSource } from '../remote-source.interface';

/**
 * Real scraper for the legacy "Details" PHP app at rework.jenapp0001.sebn.com.
 * Used when SCRAPER_MODE=live.
 *
 * ── Provenance ──────────────────────────────────────────────────────────────
 * Every endpoint, form field, header, regex and date format below is ported
 * from the `RelayServer.java` relay already running in the plant, whose list
 * parser was verified against real raw server bytes. This is NOT guesswork.
 *
 * Four things here are counter-intuitive and were each wrong in the first
 * (guessed) version of this file:
 *
 *  1. A session cookie is required. The search POST fails without first doing
 *     a plain GET of /main.php to collect Set-Cookie. The detail page does NOT
 *     need it.
 *  2. The search POST sends the WHOLE form, not just `model`. Seven fields,
 *     six of them empty.
 *  3. Dates are `yyyy-MM-dd HH:mm:ss` — not the `dd.MM.yyyy` that this kind of
 *     EU factory software usually uses.
 *  4. The detail page is too malformed for DOM/selector parsing. Every tag is
 *     collapsed to a delimiter and the text split on it, then matched against
 *     a known label list. Selector-based parsing does not work there.
 *
 * ── Known remaining risk ────────────────────────────────────────────────────
 * The relay's own README is explicit that the DETAIL page parser was never
 * verified against a real raw HTML capture of that page (the list parser was).
 * So `parseDetailFields` is the one part here still unproven. When it returns
 * nothing, we dump the HTML to debug/ so it can be fixed from real bytes —
 * same safety net the relay uses.
 */
@Injectable()
export class LiveHttpSource implements RemoteSource {
  private readonly logger = new Logger(LiveHttpSource.name);

  /** Collected from /main.php; required by the search POST, not by the detail GET. */
  private sessionCookie = '';

  constructor(private readonly config: ConfigService) {}

  // ---------------------------------------------------------------- //
  // LIST  —  POST /Szczegol.php?AK=1
  // ---------------------------------------------------------------- //
  async getListPage(model: KskModel): Promise<RemoteListRow[]> {
    const baseUrl = this.requireBaseUrl();
    if (!this.sessionCookie) await this.warmUpSession(baseUrl);

    // The real form posts all seven fields. Sending only `model` is not
    // equivalent — the empty fields are part of what the page expects.
    const body =
      `numer=&model=${encodeURIComponent(model)}&kenn=&rej1=&rej2=&komentar=&kolor=`;

    const response = await axios.post(`${baseUrl}/Szczegol.php?AK=1`, body, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Referer: `${baseUrl}/main.php`,
        Origin: baseUrl,
        ...(this.sessionCookie ? { Cookie: this.sessionCookie } : {}),
      },
    });

    this.captureCookies(response.headers as Record<string, unknown>);
    const html = this.decode(response.data as ArrayBuffer);

    const rows = parseListRows(html, model);
    if (rows.length === 0) {
      // Either the markup changed or the session was rejected — keep the page
      // so it can be diagnosed from real bytes instead of guesswork.
      await this.dumpDebugHtml(`list-${model}`, html);
      this.logger.warn(
        `List page for model=${model} parsed 0 rows (${html.length} bytes). Dumped to debug/.`,
      );
    }
    return rows;
  }

  // ---------------------------------------------------------------- //
  // DETAIL  —  GET /Szczegol.php?numer=X&model=Y
  // ---------------------------------------------------------------- //
  async getDetailPage(no: string, model: KskModel): Promise<RemoteDetailRecord> {
    const baseUrl = this.requireBaseUrl();
    const url =
      `${baseUrl}/Szczegol.php?numer=${encodeURIComponent(no)}&model=${encodeURIComponent(model)}`;

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      headers: {
        'User-Agent': USER_AGENT,
        // Not required, but harmless and keeps the session consistent.
        ...(this.sessionCookie ? { Cookie: this.sessionCookie } : {}),
      },
    });

    const html = this.decode(response.data as ArrayBuffer);
    const fields = parseDetailFields(html);

    if (fields.size === 0) {
      await this.dumpDebugHtml(`detail-${model}-${no}`, html);
      this.logger.warn(
        `Detail page ${model} #${no} yielded no recognised fields. Dumped to debug/ — ` +
          'this is the known-unverified parser; send that file to fix it.',
      );
    }

    return buildDetailRecord(no, model, fields);
  }

  // ---------------------------------------------------------------- //
  // SESSION
  // ---------------------------------------------------------------- //
  private async warmUpSession(baseUrl: string): Promise<void> {
    try {
      const response = await axios.get(`${baseUrl}/main.php`, {
        responseType: 'arraybuffer',
        timeout: 20_000,
        headers: { 'User-Agent': USER_AGENT },
      });
      this.captureCookies(response.headers as Record<string, unknown>);
      this.logger.log(
        this.sessionCookie
          ? `Session established (${this.sessionCookie.split(';').length} cookie(s)).`
          : 'No cookie returned by /main.php — continuing without one.',
      );
    } catch (err) {
      // The relay treats this as non-fatal and so do we: some deployments hand
      // out no cookie at all and the search still works.
      this.logger.warn(
        `Session warm-up failed (${err instanceof Error ? err.message : err}) — continuing.`,
      );
    }
  }

  /** Keeps only the `name=value` part of each Set-Cookie, joined with "; ". */
  private captureCookies(headers: Record<string, unknown>): void {
    const raw = headers['set-cookie'];
    if (!Array.isArray(raw) || raw.length === 0) return;
    this.sessionCookie = raw.map((c) => String(c).split(';', 1)[0]).join('; ');
  }

  /**
   * Decoded explicitly rather than letting axios guess. The page carries
   * accented French text; a wrong charset turns it into mojibake that then
   * silently pollutes the database. Override with SITE_CHARSET if needed.
   */
  private decode(data: ArrayBuffer): string {
    const charset = this.config.get<string>('SITE_CHARSET', 'utf-8');
    return new TextDecoder(charset).decode(new Uint8Array(data));
  }

  private requireBaseUrl(): string {
    const baseUrl = this.config.get<string>('SITE_BASE_URL');
    if (!baseUrl) {
      throw new Error(
        'SITE_BASE_URL is not set. Required when SCRAPER_MODE=live ' +
          '(e.g. http://rework.jenapp0001.sebn.com).',
      );
    }
    return baseUrl.replace(/\/+$/, '');
  }

  private async dumpDebugHtml(name: string, html: string): Promise<void> {
    try {
      const dir = path.resolve(process.cwd(), 'debug');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${name}.html`), html, 'utf8');
    } catch {
      // Diagnostics must never take the scraper down.
    }
  }
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SEBN-ReworkDashboard/1.0';

// ==================================================================== //
// LIST PARSING — verified against real server bytes by the relay
// ==================================================================== //

/**
 * Result rows look like:
 *   <tr bgcolor=#DEDEDF><td>NO</td><td>MODEL</td>[<td>]<A href=..>CARID</A></td>
 *   <td>ZSB</td><td>REGISTERED</td><td>ERROR</td><td>COMMENT</td><td>COLOR</td></tr>
 *
 * Real quirks this deliberately tolerates, all observed on the live server:
 *   - `bgcolor` may be unquoted
 *   - the opening `<td>` before the CarID anchor is sometimes missing
 *   - the anchor tag may be uppercase `<A>`
 *   - a row may have no CarID link at all
 *
 * This is why it is a regex and not a DOM query: the markup does not parse
 * cleanly as HTML, and a tolerant DOM parser silently restructures it.
 */
const ROW_PATTERN =
  /<tr\s+bgcolor="?#DEDEDF"?>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*(?:<td>)?([\s\S]*?)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<\/tr>/gi;

const STRIP_TAGS = /<[^>]*>/g;

export function parseListRows(html: string, model: KskModel): RemoteListRow[] {
  const rows: RemoteListRow[] = [];
  // Fresh lastIndex per call — the pattern is module-level and /g is stateful.
  ROW_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ROW_PATTERN.exec(html)) !== null) {
    const no = match[1].trim();
    if (!no) continue; // header / spacer rows

    const registeredRaw = match[5].trim();
    const registered = parseSiteDate(registeredRaw);

    rows.push({
      no,
      model,
      carId: unescapeHtml(match[3].replace(STRIP_TAGS, '').trim()),
      zsb: unescapeHtml(match[4].trim()),
      // A row with an unparseable date still matters — keep it and let the
      // caller decide, rather than silently dropping a real rework.
      registered: (registered ?? new Date()).toISOString(),
      errorCode: match[6].trim(),
      comment: unescapeHtml(match[7].trim()),
      color: match[8].trim(),
    });
  }
  return rows;
}

// ==================================================================== //
// DETAIL PARSING — label-based; the one part still unverified
// ==================================================================== //

/** Exact labels the detail page uses, lowercased. Order is not significant. */
const DETAIL_LABELS = [
  'rework id',
  'model',
  'carid / unique no.',
  'zsb / partname',
  'car type',
  'registered',
  'week',
  'reworked',
  'shift',
  'time (min)',
  'quality control',
  'defect shift',
  'defect by',
  'defect date',
  'detect shift',
  'quality gate',
  'error code',
  'part name',
  'type part',
  'description',
  'erp order no.',
  'board no.',
  'conveyor no.',
  'comment',
] as const;

const ANY_TAG = /<[^>]+>/g;
const SEP = '';

/**
 * Collapses every tag in the first <table> to a delimiter, splits on it, and
 * assigns each text fragment to the most recent recognised label.
 *
 * Deliberately not a DOM/selector parse: this page's HTML is malformed enough
 * that cell pairing is unreliable, which is exactly why the relay does it this
 * way too. One label can own several fragments, hence string[] per key.
 */
export function parseDetailFields(html: string): Map<string, string[]> {
  const dict = new Map<string, string[]>();

  const table = html.match(/<table[\s\S]*?<\/table>/i);
  if (!table) return dict;

  const pieces = table[0].replace(ANY_TAG, SEP).split(SEP);

  let current: string | null = null;
  for (const piece of pieces) {
    const text = unescapeHtml(piece.trim());
    if (!text) continue;

    const lower = text.toLowerCase();

    // DELIBERATE DIVERGENCE FROM THE RELAY.
    // RelayServer.java matches a label with startsWith(), which means any
    // VALUE that happens to begin with a label word is misread as that label:
    // a comment of "Reworked & verified" is filed as the Reworked timestamp
    // and the comment is lost. Real rework comments start with words like
    // "Reworked"/"Registered" all the time, so this is not hypothetical.
    //
    // A label cell contains the label and nothing else, or "Label: value".
    // Requiring an exact match or a colon keeps the inline form working while
    // refusing to swallow ordinary prose.
    // Longest label first, so "defect shift" is never shadowed by "shift".
    const label = DETAIL_LABELS.filter((l) => lower.startsWith(l))
      .sort((a, b) => b.length - a.length)
      .find((l) => {
        // The cell holds the label alone — the normal case.
        if (lower === l) return true;

        const rest = text.slice(l.length);
        // "Label: value" on one line.
        if (rest.trimStart().startsWith(':')) return true;
        // "Label 2026-09-14 11:45:00" — an inline value with no colon. Accepted
        // ONLY when what follows starts with a digit, which every inline field
        // on this page does (timestamps, shifts, counts). Prose like
        // "Reworked & verified" is therefore left alone as a value.
        return /^\s+\d/.test(rest);
      });

    if (label) {
      current = label;
      if (!dict.has(label)) dict.set(label, []);
      let remainder = text.slice(label.length).trim();
      if (remainder.startsWith(':')) remainder = remainder.slice(1).trim();
      if (remainder) dict.get(label)!.push(remainder);
    } else if (current) {
      dict.get(current)!.push(text);
    }
  }
  return dict;
}

/** 1-based, matching the relay's `piece()` helper. */
function piece(dict: Map<string, string[]>, key: string, index1 = 1): string {
  const list = dict.get(key);
  if (!list || index1 < 1 || index1 > list.length) return '';
  return list[index1 - 1];
}

function buildDetailRecord(
  no: string,
  model: KskModel,
  dict: Map<string, string[]>,
): RemoteDetailRecord {
  // NOTE: index 2, not 1. On this page the "reworked" label owns two
  // fragments and the timestamp is the second. Taking the first yields a
  // value that looks plausible but is wrong — ported exactly from the relay.
  const reworkedRaw = piece(dict, 'reworked', 2);
  const reworked = reworkedRaw ? parseSiteDate(reworkedRaw) : null;

  const registeredRaw = piece(dict, 'registered', 2) || piece(dict, 'registered', 1);
  const registered = parseSiteDate(registeredRaw);

  const qualityControlRaw = piece(dict, 'quality control', 2) || piece(dict, 'quality control', 1);
  const qualityControl = qualityControlRaw ? parseSiteDate(qualityControlRaw) : null;

  const errorCode = piece(dict, 'error code');
  const partName = piece(dict, 'part name');
  const partType = piece(dict, 'type part');
  const description = piece(dict, 'description');
  const defectBy = piece(dict, 'defect by');

  // The detail page carries a single defect, not a sub-table, so we surface it
  // as a one-entry list to keep the rest of the app (which aggregates over
  // errorCodes) working unchanged.
  const errorCodes: RemoteErrorCodeRow[] = errorCode
    ? [
        {
          code: errorCode,
          description,
          errorProducer: defectBy,
          partType,
          partName,
          cavity: '',
          info: piece(dict, 'quality gate'),
        },
      ]
    : [];

  return {
    no,
    model,
    carId: piece(dict, 'carid / unique no.'),
    zsb: piece(dict, 'zsb / partname'),
    // The list page's Registered is the reliable one; this is only a fallback
    // for a detail fetched outside a list context (e.g. the probe command).
    registered: (registered ?? new Date()).toISOString(),
    errorCode,
    comment: piece(dict, 'comment'),
    color: '',
    reworked: reworked ? reworked.toISOString() : null,
    qualityControlDate: qualityControl ? qualityControl.toISOString() : null,
    defectShift: piece(dict, 'defect shift') || null,
    detectShift: piece(dict, 'detect shift') || null,
    defectBy: defectBy || null,
    partType,
    partName,
    description,
    qualityGate: piece(dict, 'quality gate') || null,
    errorCodes,
  };
}

// ==================================================================== //
// SHARED
// ==================================================================== //

/**
 * The site renders `yyyy-MM-dd HH:mm:ss`. Parsed as LOCAL time, matching the
 * relay's LocalDateTime — the factory reads these as wall-clock times, so
 * shifting them into UTC would misattribute records across shift boundaries.
 */
export function parseSiteDate(raw: string): Date | null {
  if (!raw) return null;
  const m = raw
    .trim()
    .match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;

  const date = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
