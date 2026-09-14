import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { KskModel } from '../constants';
import { RemoteDetailRecord, RemoteErrorCodeRow, RemoteListRow } from '../mock/mock-data.generator';
import { RemoteSource } from '../remote-source.interface';

/**
 * Real scraper for the legacy "Details" PHP app (Szczegol.php), used when
 * SCRAPER_MODE=live.
 *
 * ⚠️ UNVERIFIED SELECTORS: everything below was written from the column
 * descriptions you gave me (No./Model/CarID/ZSB/Registered/Error/Comment/
 * Color on the list page; registered/reworked/quality control date/defect
 * shift/detect shift/defect by/error code/part type/part name/description/
 * comment + an error-code sub-table on the detail page) — NOT from actual
 * HTML. The first time this runs against the real site it will very likely
 * need selector fixes. To fix it:
 *   1. On Mohamed's network, open the list page and a detail page, then
 *      View Source (not DevTools-rendered DOM — Cheerio sees raw HTML).
 *   2. Compare the real <table>/<tr>/<td> structure and date format
 *      against parseListPage/parseDetailPage/parseSiteDate below.
 *   3. Adjust the td:nth-child indices / field() label lookups / date
 *      regex to match.
 * Everything else in the app (entities, scheduler, gateway) stays the same
 * no matter what you change here, since it all goes through RemoteSource.
 */
@Injectable()
export class LiveHttpSource implements RemoteSource {
  private readonly logger = new Logger(LiveHttpSource.name);

  constructor(private readonly config: ConfigService) {}

  async getListPage(model: KskModel): Promise<RemoteListRow[]> {
    const baseUrl = this.requireBaseUrl();
    const body = new URLSearchParams({ model }).toString();
    const { data: html } = await axios.post(`${baseUrl}/Szczegol.php?AK=1`, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10_000,
    });
    return parseListPage(html, model);
  }

  async getDetailPage(no: string, model: KskModel): Promise<RemoteDetailRecord> {
    const baseUrl = this.requireBaseUrl();
    const url = `${baseUrl}/Szczegol.php?numer=${encodeURIComponent(no)}&model=${encodeURIComponent(model)}`;
    const { data: html } = await axios.get(url, { timeout: 10_000 });
    return parseDetailPage(html, no, model);
  }

  private requireBaseUrl(): string {
    const baseUrl = this.config.get<string>('SITE_BASE_URL');
    if (!baseUrl) {
      throw new Error(
        'SITE_BASE_URL is not set. Required when SCRAPER_MODE=live (e.g. http://10.0.x.x).',
      );
    }
    return baseUrl.replace(/\/+$/, '');
  }
}

// ---- HTML parsing — UNVERIFIED, see class doc above ----

function parseListPage(html: string, model: KskModel): RemoteListRow[] {
  const $ = cheerio.load(html);
  const rows: RemoteListRow[] = [];

  $('table tr').each((i, tr) => {
    if (i === 0) return; // header row
    const cells = $(tr).find('td');
    if (cells.length < 8) return;
    rows.push({
      no: $(cells[0]).text().trim(),
      model,
      carId: $(cells[2]).text().trim(),
      zsb: $(cells[3]).text().trim(),
      registered: parseSiteDate($(cells[4]).text().trim()).toISOString(),
      errorCode: $(cells[5]).text().trim(),
      comment: $(cells[6]).text().trim(),
      color: $(cells[7]).text().trim(),
    });
  });

  return rows;
}

function parseDetailPage(html: string, no: string, model: KskModel): RemoteDetailRecord {
  const $ = cheerio.load(html);

  // Assumes a label/value layout, e.g. <tr><td>Registered</td><td>...</td></tr>.
  const field = (label: string): string =>
    $(`td:contains("${label}")`).first().next('td').text().trim();

  const registered = parseSiteDate(field('Registered'));
  const reworkedRaw = field('Reworked');
  const qualityRaw = field('Quality control');

  const errorCodes: RemoteErrorCodeRow[] = [];
  $('table').each((_, table) => {
    const headerText = $(table).find('tr').first().text();
    if (!/producer|cavity/i.test(headerText)) return; // find the error-code sub-table
    $(table)
      .find('tr')
      .each((i, tr) => {
        if (i === 0) return;
        const cells = $(tr).find('td');
        if (cells.length < 7) return;
        errorCodes.push({
          code: $(cells[0]).text().trim(),
          description: $(cells[1]).text().trim(),
          errorProducer: $(cells[2]).text().trim(),
          partType: $(cells[3]).text().trim(),
          partName: $(cells[4]).text().trim(),
          cavity: $(cells[5]).text().trim(),
          info: $(cells[6]).text().trim(),
        });
      });
  });

  return {
    no,
    model,
    carId: field('CarID'),
    zsb: field('ZSB'),
    registered: registered.toISOString(),
    errorCode: field('Error code'),
    comment: field('Comment'),
    color: field('Color'),
    reworked: reworkedRaw ? parseSiteDate(reworkedRaw).toISOString() : null,
    qualityControlDate: qualityRaw ? parseSiteDate(qualityRaw).toISOString() : null,
    defectShift: field('Defect shift') || null,
    detectShift: field('Detect shift') || null,
    defectBy: field('Defect by') || null,
    partType: field('Part type'),
    partName: field('Part name'),
    description: field('Description'),
    errorCodes,
  };
}

/**
 * Assumes "DD.MM.YYYY HH:mm" — common in EU factory floor software.
 * Falls back to native Date parsing if that pattern doesn't match, but
 * verify this against a real timestamp before trusting it.
 */
function parseSiteDate(raw: string): Date {
  const match = raw.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (!match) return new Date(raw);
  const [, day, month, year, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}
