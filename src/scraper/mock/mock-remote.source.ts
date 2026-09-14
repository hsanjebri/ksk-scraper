import { Injectable } from '@nestjs/common';
import { KSK_MODELS, KskModel } from '../constants';
import { RemoteSource } from '../remote-source.interface';
import {
  generateRandomDetailRecord,
  RemoteDetailRecord,
  RemoteListRow,
  SEED_HISTORY_HOURS,
} from './mock-data.generator';

/**
 * Stands in for the legacy PHP site (Szczegol.php) while there's no network
 * access to it yet. This is the ONLY place that fakes network I/O — every
 * other class talks to this the same way it will later talk to Axios.
 *
 * Swap-out plan once the real site is reachable:
 *   - Delete this class (or leave it for tests/offline dev).
 *   - In ScraperService, replace `this.mockRemote.getListPage(model)` and
 *     `this.mockRemote.getDetailPage(no, model)` with the real
 *     Axios + Cheerio calls (see TODOs in scraper.service.ts).
 *   - Nothing outside ScraperService needs to change.
 */
@Injectable()
export class MockRemoteSource implements RemoteSource {
  private readonly store = new Map<string, RemoteDetailRecord>();
  private readonly order = new Map<KskModel, string[]>();

  constructor() {
    for (const model of KSK_MODELS) this.order.set(model, []);
  }

  /**
   * Populates the mock store with an initial batch per model, spread across
   * SEED_HISTORY_HOURS (~12 weeks) rather than the last few days — the
   * dashboard's week-over-week deltas, sparklines and anomaly detection all
   * need several weeks of history to show anything.
   */
  seedInitial(perModel = 60): void {
    for (const model of KSK_MODELS) {
      for (let i = 0; i < perModel; i++) {
        const forceOpen = i >= perModel - Math.ceil(perModel / 6);
        this.createRandomRecord(model, forceOpen, SEED_HISTORY_HOURS);
      }
      // The list page is read newest-first by No., so the seeded No. order
      // must agree with registration time or fastScan's diff is meaningless.
      this.sortByRegistered(model);
    }
  }

  /**
   * Re-assigns No. values in registration order. Generated records get random
   * dates, so without this the highest No. wouldn't be the newest record.
   */
  private sortByRegistered(model: KskModel): void {
    const list = this.order.get(model)!;
    const records = list.map((no) => this.mustGet(model, no));
    records.sort(
      (a, b) => new Date(a.registered).getTime() - new Date(b.registered).getTime(),
    );

    for (const no of list) this.store.delete(this.key(model, no));
    list.length = 0;

    let next = 100_001;
    for (const record of records) {
      const no = String(next++);
      record.no = no;
      this.store.set(this.key(model, no), record);
      list.push(no);
    }
  }

  getAllSeeded(model: KskModel): RemoteDetailRecord[] {
    return (this.order.get(model) ?? []).map((no) => this.mustGet(model, no));
  }

  /**
   * TODO(real-scraper): replace this method's body with:
   *   const body = new URLSearchParams({ model }).toString();
   *   const { data: html } = await axios.post(
   *     'http://<factory-host>/Szczegol.php?AK=1', body,
   *     { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
   *   );
   *   const $ = cheerio.load(html);
   *   return $('table tr')
   *     .slice(1) // skip header row
   *     .map((_, tr) => parseListRow($, tr))
   *     .get();
   *
   * Occasionally injects a brand-new record so the 15s fast-scan interval
   * has something new to find, simulating real production activity.
   */
  getListPage(model: KskModel): RemoteListRow[] {
    // 8% per 15s poll per model ≈ 1 new record every ~3 min. The old 35% was
    // ~1.4/min, which piled ~80 records into the current ISO week within an
    // hour and made every week-over-week comparison on the dashboard useless.
    if (Math.random() < 0.08) {
      this.createRandomRecord(model, true);
    }
    return [...this.order.get(model)!]
      .sort((a, b) => Number(b) - Number(a)) // newest No. first, like the real page
      .map((no) => toListRow(this.mustGet(model, no)));
  }

  /**
   * TODO(real-scraper): replace this method's body with:
   *   const { data: html } = await axios.get(
   *     `http://<factory-host>/Szczegol.php?numer=${no}&model=${model}`,
   *   );
   *   const $ = cheerio.load(html);
   *   return parseDetailPage($); // fields table + error-code sub-table
   *
   * While mocking: a still-open record has a small chance per poll of
   * "finishing rework", so the 45s watch-list recheck has something to
   * transition to "Terminé".
   */
  getDetailPage(no: string, model: KskModel): RemoteDetailRecord {
    const record = this.mustGet(model, no);
    if (!record.reworked && Math.random() < 0.2) {
      record.reworked = new Date().toISOString();
      record.qualityControlDate = new Date(Date.now() + 30 * 60_000).toISOString();
    }
    return record;
  }

  private mustGet(model: KskModel, no: string): RemoteDetailRecord {
    const record = this.store.get(this.key(model, no));
    if (!record) {
      throw new Error(`Mock remote: no record for model=${model} no=${no}`);
    }
    return record;
  }

  private createRandomRecord(
    model: KskModel,
    forceOpen: boolean,
    maxHoursAgo?: number,
  ): RemoteDetailRecord {
    const no = this.nextNo(model);
    const record = generateRandomDetailRecord(model, no, forceOpen, maxHoursAgo);
    this.store.set(this.key(model, no), record);
    this.order.get(model)!.push(no);
    return record;
  }

  private nextNo(model: KskModel): string {
    const list = this.order.get(model)!;
    const last = list.length ? Number(list[list.length - 1]) : 100_000;
    return String(last + 1);
  }

  private key(model: KskModel, no: string): string {
    return `${model}:${no}`;
  }
}

function toListRow(record: RemoteDetailRecord): RemoteListRow {
  const { no, model, carId, zsb, registered, errorCode, comment, color } = record;
  return { no, model, carId, zsb, registered, errorCode, comment, color };
}
