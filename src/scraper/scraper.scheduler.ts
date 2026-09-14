import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { FAST_SCAN_INTERVAL_MS, KSK_MODELS, WATCHLIST_RECHECK_INTERVAL_MS } from './constants';
import { KskRecord } from './entities/ksk-record.entity';
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
   * Fast scan: for each model, check the list page's newest No. against
   * what we've already seen, and pull full details for anything new.
   *
   * Processes No.s oldest-first and only advances ScrapeState after each
   * one is actually persisted. If one fails (network hiccup, parse error),
   * we stop for that model this tick instead of skipping ahead — it (and
   * anything after it) gets retried on the next tick rather than lost.
   */
  @Interval(FAST_SCAN_INTERVAL_MS)
  async handleFastScan(): Promise<void> {
    for (const model of KSK_MODELS) {
      let newNos: string[];
      try {
        newNos = await this.scraperService.fastScan(model);
      } catch (err) {
        this.logger.error(`fastScan failed for model=${model}`, err instanceof Error ? err.stack : err);
        continue;
      }

      for (const no of newNos) {
        try {
          const alreadyStored = await this.recordRepo.exists({ where: { no, model } });
          if (!alreadyStored) {
            const record = await this.scraperService.fetchDetail(no, model);
            const saved = await this.recordRepo.save(record);
            saved.computeDerived();
            this.gateway.emitNewRecord(saved);
          }
          await this.scraperService.markSeen(model, no);
        } catch (err) {
          this.logger.error(
            `failed to process ${model} #${no} — will retry next tick`,
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
   */
  @Interval(WATCHLIST_RECHECK_INTERVAL_MS)
  async handleWatchlistRecheck(): Promise<void> {
    const openRecords = await this.recordRepo.find({ where: { reworked: IsNull() } });
    if (openRecords.length === 0) return;

    for (const existing of openRecords) {
      try {
        const fresh = await this.scraperService.fetchDetail(existing.no, existing.model);
        if (!fresh.reworked) continue; // still open, nothing to do

        existing.reworked = fresh.reworked;
        existing.qualityControlDate = fresh.qualityControlDate;
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
