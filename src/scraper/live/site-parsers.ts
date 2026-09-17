import type { KskModel } from '../constants';
import type {
  RemoteDetailRecord,
  RemoteErrorCodeRow,
  RemoteListRow,
} from '../mock/mock-data.generator';

/**
 * Pure parsing for the rework site (rework.jenapp0001.sebn.com).
 *
 * No Nest, no HTTP, no I/O — everything here is a function from bytes/strings
 * to data, so it can be tested directly against captured pages.
 *
 * ── Verified against real captures ─────────────────────────────────────────
 * List page:   2,938 MAM rows + 3,001 MCM rows, 100% parsed, 0 date fallbacks.
 * Detail page: MAM #2944 (still open) and MCM #3059 (closed), every field.
 *
 * Things the real markup taught us that a description of it never would:
 *
 *  1. The list page is sorted by REGISTERED date, not by No. — No. is an
 *     entry sequence and entries get backdated (No. 2940 has an earlier
 *     timestamp than No. 2937). Nothing may assume No. order on the page.
 *  2. The detail page never closes its main table. It "closes" it with a
 *     second OPENING <Table> tag and then prints the error-codes list, so the
 *     first </table> in the document belongs to the error-codes table.
 *  3. registered / reworked / quality control each carry an operator number
 *     BEFORE the timestamp ("4821 | 2026-09-17 11:19:41").
 *  4. The Comment field is clipped at 60 characters on BOTH pages. The full
 *     text only exists in the error-codes list's Info column.
 *  5. Shifts are letters (A, B), not numbers.
 */

// ==================================================================== //
// CHARSET
// ==================================================================== //

/**
 * Decodes a response body without assuming its charset.
 *
 * Legacy PHP apps commonly serve Latin-1 with no charset declared, and the
 * captured pages cannot tell us which this server uses (PowerShell decodes
 * both correctly). Decoding Latin-1 bytes as UTF-8 does not fail loudly — it
 * turns every "é" into U+FFFD and writes that into the database. So:
 *
 *   explicit override  >  non-UTF-8 charset declared in Content-Type
 *                      >  strict UTF-8  >  windows-1252 fallback
 *
 * Strict UTF-8 is a reliable discriminator here: Latin-1 "é" (0xE9) followed
 * by ASCII is never valid UTF-8, while genuine UTF-8 always is.
 */
export function decodeHtmlBytes(
  bytes: Uint8Array,
  contentType?: string | null,
  override?: string | null,
): { text: string; charset: string } {
  if (override) {
    return { text: new TextDecoder(override).decode(bytes), charset: override.toLowerCase() };
  }

  const declared = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (declared && !/^utf-?8$/i.test(declared)) {
    try {
      return { text: new TextDecoder(declared).decode(bytes), charset: declared.toLowerCase() };
    } catch {
      // Unknown label — fall through to detection.
    }
  }

  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      charset: 'utf-8',
    };
  } catch {
    // WHATWG maps "iso-8859-1" to windows-1252 anyway; it is the superset.
    return { text: new TextDecoder('windows-1252').decode(bytes), charset: 'windows-1252' };
  }
}

// ==================================================================== //
// LIST PAGE  —  POST /Szczegol.php?AK=1
// ==================================================================== //

/**
 * Result rows look like:
 *   <tr bgcolor=#DEDEDF><td>NO</td><td>MODEL</td><td><A href=..>CARID</A></td>
 *   <td>ZSB</td><td>REGISTERED</td><td>ERROR</td><td>COMMENT</td><td>COLOR</td></tr>
 *
 * Tolerates quirks observed on the live server: unquoted bgcolor, an optional
 * opening <td> before the CarID anchor, uppercase <A>, and a CarID anchor with
 * no text. The header row uses a different colour (#DDCACA) and is skipped.
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
    if (!no) continue;

    const registered = parseSiteDate(match[5].trim());

    rows.push({
      no,
      model,
      carId: unescapeHtml(match[3].replace(STRIP_TAGS, '').trim()),
      zsb: unescapeHtml(match[4].trim()),
      // 0 of 5,939 real rows failed to parse. The fallback exists so a
      // malformed row is not silently dropped; the probe flags any row whose
      // timestamp lands on "now".
      registered: (registered ?? new Date()).toISOString(),
      errorCode: match[6].trim(),
      comment: unescapeHtml(match[7].trim()),
      color: match[8].trim(),
    });
  }
  return rows;
}

// ==================================================================== //
// DETAIL PAGE  —  GET /Szczegol.php?numer=X&model=Y
// ==================================================================== //

/** Every label on the real detail page, lowercased. */
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

// Longest first, so "defect shift" can never be claimed by "shift".
const LABELS_BY_LENGTH = [...DETAIL_LABELS].sort((a, b) => b.length - a.length);

const ANY_TAG = /<[^>]+>/g;
const SEP = '';
const ERROR_LIST_MARKER = /error codes list/i;

/**
 * The main field table, and only that.
 *
 * The real page never closes its main table — it emits a second OPENING
 * <Table> and then the error-codes list. A naive `<table>…</table>` match
 * therefore runs to the end of the error-codes table and feeds "Error
 * producer", "Cavity" and every error row into the field parser. Cutting at
 * the "Error codes list" heading is what makes the field parse exact.
 */
function mainDetailSection(html: string): string | null {
  const start = html.search(/<table/i);
  if (start < 0) return null;

  const marker = html.search(ERROR_LIST_MARKER);
  if (marker > start) return html.slice(start, marker);

  const close = html.slice(start).search(/<\/table>/i);
  return close >= 0 ? html.slice(start, start + close) : html.slice(start);
}

/**
 * Collapses every tag in the main field table to a delimiter, splits on it,
 * and assigns each text fragment to the most recent label.
 *
 * A label is recognised ONLY when the fragment is exactly the label or the
 * label followed by a colon ("defect shift:", "shift: A", "time (min): 7").
 * That is every label form the real page uses. The looser startsWith() rule
 * in the plant's RelayServer.java misreads any VALUE that begins with a label
 * word — a comment like "reworked twice, comment added" — as a new field.
 */
export function parseDetailFields(html: string): Map<string, string[]> {
  const dict = new Map<string, string[]>();
  const section = mainDetailSection(html);
  if (!section) return dict;

  let current: string | null = null;
  for (const raw of section.replace(ANY_TAG, SEP).split(SEP)) {
    const text = unescapeHtml(raw.trim());
    if (!text) continue;

    const lower = text.toLowerCase();
    const label = LABELS_BY_LENGTH.find(
      (l) => lower === l || lower.startsWith(`${l}:`) || lower.startsWith(`${l} :`),
    );

    if (label) {
      current = label;
      if (!dict.has(label)) dict.set(label, []);
      const remainder = text.slice(label.length).trim().replace(/^:/, '').trim();
      if (remainder) dict.get(label)!.push(remainder);
    } else if (current) {
      dict.get(current)!.push(text);
    }
  }
  return dict;
}

/**
 * The "Error codes list" table: Code, Description, Error producer, Part type,
 * Part name, Cavity, Info. One row per defect, and a record can carry several.
 *
 * Info is where the UNTRUNCATED comment lives.
 */
export function parseErrorCodeRows(html: string): RemoteErrorCodeRow[] {
  const marker = html.search(ERROR_LIST_MARKER);
  if (marker < 0) return [];

  const rows: RemoteErrorCodeRow[] = [];
  for (const chunk of html.slice(marker).split(/<tr\b/i).slice(1)) {
    // Header cells are <th>, so only real data rows produce seven <td>s.
    const cells = [...chunk.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      unescapeHtml(m[1].replace(STRIP_TAGS, '')).trim(),
    );
    if (cells.length < 7 || !cells[0]) continue;

    const [code, description, errorProducer, partType, partName, cavity, info] = cells;
    rows.push({ code, description, errorProducer, partType, partName, cavity, info });
  }
  return rows;
}

/** First fragment of a label, or '' — the label may be present with no value. */
function firstValue(dict: Map<string, string[]>, key: string): string {
  return dict.get(key)?.[0] ?? '';
}

/**
 * First fragment under a label that parses as a site timestamp.
 *
 * Positional access is wrong here: these labels are followed by an operator
 * number, then the date. An open record has neither, and a record typed in
 * without an operator would shift the date into first position.
 */
function firstDate(dict: Map<string, string[]>, key: string): Date | null {
  for (const fragment of dict.get(key) ?? []) {
    const date = parseSiteDate(fragment);
    if (date) return date;
  }
  return null;
}

const normalizeSpace = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The main table clips Comment at 60 characters, exactly like the list page;
 * the error-codes list repeats it in full in its Info column. Use the Info that
 * extends the clipped comment, so the database never stores the stump.
 */
function resolveComment(main: string, rows: RemoteErrorCodeRow[]): string {
  const infos = rows.map((r) => r.info).filter(Boolean);
  if (!main) return infos[0] ?? '';

  const clipped = normalizeSpace(main);
  const fuller = infos
    .filter((info) => {
      const full = normalizeSpace(info);
      return full.length > clipped.length && full.startsWith(clipped);
    })
    .sort((a, b) => b.length - a.length)[0];

  return fuller ?? main;
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Everything the detail page knows about one record. */
export function parseDetailPage(html: string, no: string, model: KskModel): RemoteDetailRecord {
  const dict = parseDetailFields(html);
  const errorRows = parseErrorCodeRows(html);
  const primary = errorRows[0];

  const errorCode = firstValue(dict, 'error code') || primary?.code || '';
  const description = firstValue(dict, 'description') || primary?.description || '';
  const partName = firstValue(dict, 'part name') || primary?.partName || '';
  const partType = firstValue(dict, 'type part') || primary?.partType || '';
  const defectBy = firstValue(dict, 'defect by') || primary?.errorProducer || '';

  const errorCodes: RemoteErrorCodeRow[] =
    errorRows.length > 0
      ? errorRows
      : errorCode
        ? [{ code: errorCode, description, errorProducer: defectBy, partType, partName, cavity: '', info: '' }]
        : [];

  const registered = firstDate(dict, 'registered');

  return {
    no,
    model,
    carId: firstValue(dict, 'carid / unique no.'),
    zsb: firstValue(dict, 'zsb / partname'),
    // Deliberately NOT "now" when missing: the list row owns this field, and
    // a fabricated timestamp is exactly the kind of value that quietly moves a
    // record into the wrong week. mergeListAndDetail ignores this anyway.
    registered: iso(registered) ?? '',
    errorCode,
    comment: resolveComment(firstValue(dict, 'comment'), errorRows),
    color: '',
    reworked: iso(firstDate(dict, 'reworked')),
    qualityControlDate: iso(firstDate(dict, 'quality control')),
    defectShift: firstValue(dict, 'defect shift') || null,
    detectShift: firstValue(dict, 'detect shift') || null,
    defectBy: defectBy || null,
    partType,
    partName,
    description,
    qualityGate: firstValue(dict, 'quality gate') || null,
    errorCodes,
  };
}

/** True when a detail page yielded nothing usable — worth dumping for diagnosis. */
export function detailLooksEmpty(record: RemoteDetailRecord): boolean {
  return !record.carId && !record.errorCode && !record.qualityGate && record.errorCodes.length === 0;
}

// ==================================================================== //
// SHARED
// ==================================================================== //

/**
 * The site renders `yyyy-MM-dd HH:mm:ss`. Parsed as LOCAL time: the factory
 * reads these as wall-clock times, so shifting them into UTC would move
 * records across shift boundaries.
 */
export function parseSiteDate(raw: string): Date | null {
  if (!raw) return null;
  const m = raw.trim().match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
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

export function unescapeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
