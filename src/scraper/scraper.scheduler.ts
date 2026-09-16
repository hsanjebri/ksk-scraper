import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { FAST_SCAN_INTERVAL_MS, KSK_MODELS, WATCHLIST_RECHECK_INTERVAL_MS } from './constants';
import { KskRecord } from './entities/ksk-record.entity';
import { RemoteDetailRecord, RemoteListRow } from './mock/mock-data.generator';
import { ScraperGateway } from './scraper.gateway';
import { ScraperService } from './scraper.service';

@Injectable()
export class ScraperScheduler {
  private readonly logger = new Logger(ScraperScheduler.name);

  constructor(
    private readonly scraperService: ScraperService,
    private readonly gateway: ScraperGateway,
    @InjectRepository(KskRecord)
    private readonly recordRepo: Repository<KskRecord>,
  ) {}

  /**
   * Fast scan: for each model, diff the list page against what we've already
   * seen and ingest anything new.
   *
   * Processes oldest-first and only advances ScrapeState once a record is
   * actually persisted. If one fails, we stop for that model this tick rather
   * than skipping past it — it gets retried next time instead of being lost.
   */
  @Interval(FAST_SCAN_INTERVAL_MS)
  async handleFastScan(): Promise<void> {
    for (const model of KSK_MODELS) {
      let newRows: RemoteListRow[];
      try {
        newRows = await this.scraperService.fastScan(model);
      } catch (err) {
        this.logger.error(`fastScan failed for model=${model}`, err instanceof Error ? err.stack : err);
        continue;
      }

      for (const row of newRows) {
        try {
          const alreadyStored = await this.recordRepo.exists({
            where: { no: row.no, model },
          });

          if (!alreadyStored) {
            // The detail page is enrichment, not the record. A failure here
            // must not cost us the row — the list data is already verified
            // and is worth saving on its own.
            let detail: RemoteDetailRecord | null = null;
            try {
              detail = await this.scraperService.fetchDetailRaw(row.no, model);
            } catch (err) {
              this.logger.warn(
                `detail fetch failed for ${model} #${row.no} (${
                  err instanceof Error ? err.message : err
                }) — saving list data only; the watch-list recheck will fill it in`,
              );
            }

            const record = this.scraperService.buildRecord(row, detail);
            const saved = await this.recordRepo.save(record);
            saved.computeDerived();
            this.gateway.emitNewRecord(saved);
          }

          await this.scraperService.markSeen(model, row.no);
        } catch (err) {
          this.logger.error(
            `failed to process ${model} #${row.no} — will retry next tick`,
            err instanceof Error ? err.stack : err,
          );
          break; // don't skip ahead past a failed No. — retry it (and anything after) next tick
        }
      }
    }
  }

  /**
   * Watch-list recheck: re-fetch the detail page for every record still
   * "En cours" and see whether it has since been closed out.
   *
   * This is also the second chance for records whose detail fetch failed when
   * they were first ingested — they stay open, so they stay on this list.
   */
  @Interval(WATCHLIST_RECHECK_INTERVAL_MS)
  async handleWatchlistRecheck(): Promise<void> {
    const openRecords = await this.recordRepo.find({ where: { reworked: IsNull() } });
    if (openRecords.length === 0) return;

    for (const existing of openRecords) {
      try {
        const fresh = await this.scraperService.fetchDetailRaw(existing.no, existing.model);

        // Fill in detail-only fields that may have been missing at ingest —
        // but never touch `registered`, which came from the verified list row.
        existing.qualityGate = existing.qualityGate ?? fresh.qualityGate ?? null;
        existing.defectShift = existing.defectShift ?? fresh.defectShift;
        existing.detectShift = existing.detectShift ?? fresh.detectShift;
        existing.defectBy = existing.defectBy ?? fresh.defectBy;

        if (!fresh.reworked) {
          // Still open. Persist any enrichment we just picked up, quietly.
          await this.recordRepo.save(existing);
          continue;
        }

        existing.reworked = new Date(fresh.reworked);
        existing.qualityControlDate = fresh.qualityControlDate
          ? new Date(fresh.qualityControlDate)
          : null;
        existing.computeDerived();

        const saved = await this.recordRepo.save(existing);
        saved.computeDerived();
        this.gateway.emitUpdatedRecord(saved);
        this.gateway.emitClosedRecord(saved);
      } catch (err) {
        this.logger.error(
          `watch-list recheck failed for ${existing.model} #${existing.no}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
  }
}
