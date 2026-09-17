import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThanOrEqual, Not, Repository } from 'typeorm';
import {
  DETAIL_CYCLE_INTERVAL_MS,
  DETAIL_FETCH_DELAY_MS,
  FAST_SCAN_INTERVAL_MS,
  INLINE_DETAIL_LIMIT,
  KSK_MODELS,
  KskModel,
  LIVE_WATCH_WINDOW_HOURS,
  MAX_DETAIL_FETCH_PER_CYCLE,
  OPEN_RECHECK_MS,
  PENDING_RETRY_MS,
  STALE_OPEN_RECHECK_MS,
} from './constants';
import { KskRecord } from './entities/ksk-record.entity';
import { RemoteDetailRecord, RemoteListRow } from './mock/mock-data.generator';
import { ScraperStatusService } from './scraper-status.service';
import { ScraperGateway } from './scraper.gateway';
import { ScraperService } from './scraper.service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Two jobs, mirroring the relay that already runs in the plant:
 *
 *  1. LIST SCAN — download each model's list page, store any rows not seen
 *     before. A handful of new rows get their detail page immediately so they
 *     appear on the dashboard live. A large batch (the first run's backfill of
 *     the whole history, or a catch-up after downtime) is stored list-only and
 *     handed to job 2.
 *
 *  2. DETAIL CYCLE — fetch detail pages at a throttled pace (the relay's 250
 *     per cycle, 150 ms apart). Priority: live open records first (so closures
 *     show up fast), then list-only records newest-first, then long-open
 *     stragglers.
 *
 * Neither job can overlap itself. @Interval fires on a timer regardless of
 * whether the previous run finished, and a detail cycle of 250 requests
 * routinely outlasts its interval.
 */
@Injectable()
export class ScraperScheduler {
  private readonly logger = new Logger(ScraperScheduler.name);
  private listRunning = false;
  private detailRunning = false;

  constructor(
    private readonly scraperService: ScraperService,
    private readonly gateway: ScraperGateway,
    private readonly status: ScraperStatusService,
    @InjectRepository(KskRecord)
    private readonly recordRepo: Repository<KskRecord>,
  ) {}

  // ================================================================ //
  // 1. LIST SCAN
  // ================================================================ //

  @Interval(FAST_SCAN_INTERVAL_MS)
  async handleListScan(): Promise<void> {
    if (this.listRunning) return;
    this.listRunning = true;
    try {
      for (const model of KSK_MODELS) await this.scanModel(model);
    } finally {
      this.listRunning = false;
    }
  }

  private async scanModel(model: KskModel): Promise<void> {
    let pageRows: RemoteListRow[];
    let selection;
    try {
      ({ pageRows, selection } = await this.scraperService.scanList(model));
    } catch (err) {
      this.status.listFailed(model, err);
      this.logger.error(`list scan failed for ${model}: ${errorText(err)}`);
      return;
    }
    this.status.listScanned(model, pageRows.length);
    if (selection.rows.length === 0) return;

    const existing = await this.existingNos(model, selection.rows.map((r) => r.no));
    const fresh = selection.rows.filter((row) => !existing.has(row.no));

    if (selection.backfill || fresh.length > INLINE_DETAIL_LIMIT) {
      await this.storeListOnly(model, fresh, selection.backfill);
      if (selection.maxNo) await this.scraperService.markSeen(model, selection.maxNo);
      return;
    }

    // Normal live traffic: a few new rows, oldest No. first.
    for (const row of selection.rows) {
      try {
        if (!existing.has(row.no)) await this.ingestLive(row);
        await this.scraperService.markSeen(model, row.no);
      } catch (err) {
        this.logger.error(`failed to store ${model} #${row.no} — retrying next scan: ${errorText(err)}`);
        break; // never skip past a failed No.
      }
    }
  }

  /** One new record, with its detail page, pushed to dashboards straight away. */
  private async ingestLive(row: RemoteListRow): Promise<void> {
    let detail: RemoteDetailRecord | null = null;
    try {
      detail = await this.scraperService.fetchDetailRaw(row.no, row.model as KskModel);
    } catch (err) {
      this.logger.warn(
        `detail for ${row.model} #${row.no} failed (${errorText(err)}) — stored list-only, queued for retry`,
      );
    }

    if (!detail) {
      const pending = this.scraperService.buildListOnlyRecord(row);
      pending.detailCheckedAt = new Date(); // back off before the retry
      await this.recordRepo.save(pending);
      return;
    }

    const saved = await this.recordRepo.save(this.scraperService.buildRecord(row, detail));
    saved.computeDerived();
    this.gateway.emitNewRecord(saved);
  }

  private async storeListOnly(model: KskModel, rows: RemoteListRow[], backfill: boolean): Promise<void> {
    if (rows.length === 0) return;
    const started = Date.now();

    const records = rows.map((row) => this.scraperService.buildListOnlyRecord(row));
    await this.recordRepo.save(records, { chunk: 500 });

    this.logger.log(
      `${model}: ${backfill ? 'backfilled' : 'caught up'} ${rows.length} record(s) from the list page ` +
        `in ${Date.now() - started} ms — detail pages will be fetched progressively`,
    );
  }

  /** Which of these No. values are already stored — one query per chunk, not per row. */
  private async existingNos(model: KskModel, nos: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < nos.length; i += 500) {
      const rows = await this.recordRepo.find({
        select: { id: true, no: true },
        where: { model, no: In(nos.slice(i, i + 500)) },
        loadEagerRelations: false,
      });
      for (const row of rows) found.add(row.no);
    }
    return found;
  }

  // ================================================================ //
  // 2. DETAIL CYCLE
  // ================================================================ //

  @Interval(DETAIL_CYCLE_INTERVAL_MS)
  async handleDetailCycle(): Promise<void> {
    if (this.detailRunning) return;
    this.detailRunning = true;

    const started = Date.now();
    let fetched = 0;
    let failed = 0;
    let enrichedPending = 0;
    let closed = 0;
    let lastError: string | null = null;

    try {
      const candidates = await this.pickDetailCandidates(MAX_DETAIL_FETCH_PER_CYCLE);

      for (const record of candidates) {
        const wasPending = record.detailFetchedAt === null;
        const hadQualityControl = record.qualityControlDate !== null;
        try {
          const fresh = await this.scraperService.fetchDetailRaw(record.no, record.model);
          const { closedNow } = this.scraperService.applyDetail(record, fresh);
          const saved = await this.recordRepo.save(record);
          saved.computeDerived();
          fetched++;

          if (wasPending) {
            // Appearing for the first time — announced in bulk below.
            enrichedPending++;
          } else if (closedNow) {
            closed++;
            this.gateway.emitUpdatedRecord(saved);
            this.gateway.emitClosedRecord(saved);
          } else if (!hadQualityControl && saved.qualityControlDate !== null) {
            // Released by quality control — the record is unchanged otherwise,
            // so this is an update, not a closure.
            this.gateway.emitUpdatedRecord(saved);
          }
        } catch (err) {
          failed++;
          lastError = `${record.model} #${record.no}: ${errorText(err)}`;
          if (failed <= 3) this.logger.warn(`detail fetch failed — ${lastError}`);
          await this.recordRepo
            .update({ id: record.id }, { detailCheckedAt: new Date() })
            .catch(() => undefined);
        }

        if (DETAIL_FETCH_DELAY_MS > 0) await sleep(DETAIL_FETCH_DELAY_MS);
      }

      if (enrichedPending > 0) this.gateway.emitRefresh();
      if (candidates.length > 0) {
        this.logger.log(
          `detail cycle: ${fetched} fetched (${enrichedPending} new, ${closed} closed), ` +
            `${failed} failed, ${Date.now() - started} ms`,
        );
      }
    } catch (err) {
      lastError = errorText(err);
      this.logger.error(`detail cycle failed: ${lastError}`);
    } finally {
      this.status.detailCycle(
        { fetched, failed, enrichedPending, closed, durationMs: Date.now() - started },
        lastError,
      );
      this.detailRunning = false;
    }
  }

  /**
   * Fills one cycle's budget in priority order, so a multi-thousand-record
   * backfill can never delay a live closure by more than one cycle.
   */
  private async pickDetailCandidates(budget: number): Promise<KskRecord[]> {
    const now = Date.now();
    const liveCutoff = new Date(now - LIVE_WATCH_WINDOW_HOURS * 3_600_000);
    const picked: KskRecord[] = [];
    const seen = new Set<number>();

    const take = (rows: KskRecord[]) => {
      for (const row of rows) {
        if (picked.length >= budget) return;
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        picked.push(row);
      }
    };
    const remaining = () => budget - picked.length;

    // 1. The live watch-list: recent records that have not finished the
    //    three-stage flow yet — still open, OR repaired but not yet released
    //    by quality control, which lands seconds to minutes after the repair
    //    (manual §5). Dropping a record at "reworked" left every quality
    //    control timestamp null.
    const recheckBefore = new Date(now - OPEN_RECHECK_MS);
    take(
      await this.recordRepo.find({
        where: [
          {
            reworked: IsNull(),
            detailFetchedAt: Not(IsNull()),
            registered: MoreThanOrEqual(liveCutoff),
            detailCheckedAt: LessThan(recheckBefore),
          },
          {
            reworked: Not(IsNull()),
            qualityControlDate: IsNull(),
            detailFetchedAt: Not(IsNull()),
            registered: MoreThanOrEqual(liveCutoff),
            detailCheckedAt: LessThan(recheckBefore),
          },
        ],
        order: { registered: 'DESC' },
        take: budget,
      }),
    );

    // 2. Known only from the list page — newest first, failed ones backed off.
    if (remaining() > 0) {
      take(
        await this.recordRepo.find({
          where: [
            { detailFetchedAt: IsNull(), detailCheckedAt: IsNull() },
            { detailFetchedAt: IsNull(), detailCheckedAt: LessThan(new Date(now - PENDING_RETRY_MS)) },
          ],
          order: { registered: 'DESC' },
          take: remaining(),
        }),
      );
    }

    // 3. Unfinished far longer than normal — checked rarely, least recently
    //    first, so one abandoned record can never crowd out live traffic.
    if (remaining() > 0) {
      const staleBefore = new Date(now - STALE_OPEN_RECHECK_MS);
      take(
        await this.recordRepo.find({
          where: [
            {
              reworked: IsNull(),
              detailFetchedAt: Not(IsNull()),
              registered: LessThan(liveCutoff),
              detailCheckedAt: LessThan(staleBefore),
            },
            {
              reworked: Not(IsNull()),
              qualityControlDate: IsNull(),
              detailFetchedAt: Not(IsNull()),
              registered: LessThan(liveCutoff),
              detailCheckedAt: LessThan(staleBefore),
            },
          ],
          order: { detailCheckedAt: 'ASC' },
          take: remaining(),
        }),
      );
    }

    return picked;
  }
}
