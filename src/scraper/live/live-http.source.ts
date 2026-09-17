import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { promises as fs } from 'fs';
import * as path from 'path';
import { KskModel } from '../constants';
import { RemoteDetailRecord, RemoteListRow } from '../mock/mock-data.generator';
import { RemoteSource } from '../remote-source.interface';
import { ScraperStatusService } from '../scraper-status.service';
import {
  decodeHtmlBytes,
  detailLooksEmpty,
  parseDetailPage,
  parseListRows,
} from './site-parsers';

// Re-exported so existing imports (specs, probe) keep working.
export {
  decodeHtmlBytes,
  parseDetailFields,
  parseDetailPage,
  parseErrorCodeRows,
  parseListRows,
  parseSiteDate,
} from './site-parsers';

/**
 * Real scraper for the legacy "Details" PHP app at rework.jenapp0001.sebn.com.
 * Used when SCRAPER_MODE=live.
 *
 * This class only does HTTP: session, requests, decoding, diagnostics. All
 * parsing lives in site-parsers.ts, where it is tested against pages captured
 * from the live site on Mohamed's machine.
 *
 * Request shapes (from the plant's RelayServer.java, confirmed by capture.ps1
 * running successfully against the real server):
 *  - GET /main.php first, to collect the session cookie the search POST needs
 *  - POST /Szczegol.php?AK=1 with all seven form fields, six of them empty
 *  - GET /Szczegol.php?numer=N&model=M for a detail page (no cookie required)
 */
@Injectable()
export class LiveHttpSource implements RemoteSource {
  private readonly logger = new Logger(LiveHttpSource.name);

  private sessionCookie = '';
  private charsetLogged = false;

  constructor(
    private readonly config: ConfigService,
    // Optional so the probe can construct this without the Nest container.
    @Optional() private readonly status?: ScraperStatusService,
  ) {}

  // ---------------------------------------------------------------- //
  // LIST  —  POST /Szczegol.php?AK=1
  // ---------------------------------------------------------------- //
  async getListPage(model: KskModel): Promise<RemoteListRow[]> {
    const baseUrl = this.requireBaseUrl();
    if (!this.sessionCookie) await this.warmUpSession(baseUrl);

    const body =
      `numer=&model=${encodeURIComponent(model)}&kenn=&rej1=&rej2=&komentar=&kolor=`;

    // The real list page is the full history: ~700 KB per model.
    const response = await retryOnReset(() =>
      axios.post(`${baseUrl}/Szczegol.php?AK=1`, body, {
        responseType: 'arraybuffer',
        timeout: 60_000,
        maxContentLength: 50 * 1024 * 1024,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Referer: `${baseUrl}/main.php`,
          Origin: baseUrl,
          ...(this.sessionCookie ? { Cookie: this.sessionCookie } : {}),
        },
      }),
    );

    this.captureCookies(response.headers as Record<string, unknown>);
    const html = this.decode(response.data as ArrayBuffer, response.headers['content-type']);

    const rows = parseListRows(html, model);
    if (rows.length === 0) {
      // Either the markup changed or the session was rejected. Drop the cookie
      // so the next attempt starts a fresh session, and keep the page.
      this.sessionCookie = '';
      await this.dumpDebugHtml(`list-${model}`, html);
      this.logger.warn(
        `List page for model=${model} parsed 0 rows (${html.length} chars). Dumped to debug/.`,
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

    const response = await retryOnReset(() =>
      axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30_000,
        headers: {
          'User-Agent': USER_AGENT,
          ...(this.sessionCookie ? { Cookie: this.sessionCookie } : {}),
        },
      }),
    );

    const html = this.decode(response.data as ArrayBuffer, response.headers['content-type']);
    const record = parseDetailPage(html, no, model);

    if (detailLooksEmpty(record)) {
      await this.dumpDebugHtml(`detail-${model}-${no}`, html);
      // Thrown rather than returned: an empty record would otherwise be marked
      // as fetched and never retried.
      throw new Error(`Detail page ${model} #${no} contained no recognisable fields (dumped to debug/)`);
    }
    return record;
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

  private decode(data: ArrayBuffer, contentType: unknown): string {
    const bytes = new Uint8Array(data);
    const override = this.config.get<string>('SITE_CHARSET') || null;
    const { text, charset } = decodeHtmlBytes(
      bytes,
      typeof contentType === 'string' ? contentType : null,
      override,
    );

    // A pure-ASCII page decodes identically under every candidate, so it says
    // nothing about the site's charset — reporting it would flip the status
    // to "utf-8" whenever a detail page happened to carry no accents.
    if (!bytes.some((b) => b >= 0x80)) return text;

    if (!this.charsetLogged) {
      this.charsetLogged = true;
      this.logger.log(`Site pages decoded as ${charset}${override ? ' (SITE_CHARSET override)' : ''}.`);
    }
    this.status?.setCharset(charset);
    return text;
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

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SEBN-ReworkDashboard/1.0';

const RESET_CODES = new Set(['ECONNRESET', 'EPIPE']);

/**
 * Retries once, after a short pause, when the connection was dropped.
 *
 * Node keeps HTTP connections alive between requests, and servers close idle
 * ones on their own schedule (Apache's default is 5 s). A request written onto
 * a connection the server is closing at that instant fails with ECONNRESET
 * although nothing is wrong. Timeouts are NOT retried — a slow server should
 * not receive twice the traffic.
 */
async function retryOnReset<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (err) {
    const code = (err as { code?: string }).code;
    const hangUp = err instanceof Error && /socket hang up/i.test(err.message);
    if (!(code && RESET_CODES.has(code)) && !hangUp) throw err;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return request();
  }
}
