import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThanOrEqual, Not, Repository } from 'typeorm';
import {
  KskModel,
  LIVE_WATCH_WINDOW_HOURS,
  OPEN_RECHECK_MS,
  PENDING_RETRY_MS,
  STALE_OPEN_RECHECK_MS,
} from './constants';
import { KskRecord } from './entities/ksk-record.entity';

/**
 * Decides which detail pages are worth fetching next.
 *
 * Shared by the two halves of the system, which must agree on priorities:
 *  - ScraperScheduler, when this instance scrapes the site directly;
 *  - IngestService, when a plant-side agent is doing the fetching and asks
 *    the server what to fetch (relay mode).
 */
@Injectable()
export class DetailQueueService {
  constructor(
    @InjectRepository(KskRecord)
    private readonly recordRepo: Repository<KskRecord>,
  ) {}

  /**
   * Fills one cycle's budget in priority order, so a multi-thousand-record
   * backfill can never delay a live closure by more than one cycle.
   */
  async pick(budget: number, model?: KskModel): Promise<KskRecord[]> {
    const now = Date.now();
    const scope = model ? { model } : {};
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
    //    (rework system manual §5). Dropping a record at "reworked" left every
    //    quality control timestamp null.
    const recheckBefore = new Date(now - OPEN_RECHECK_MS);
    take(
      await this.recordRepo.find({
        where: [
          {
            ...scope,
            reworked: IsNull(),
            detailFetchedAt: Not(IsNull()),
            registered: MoreThanOrEqual(liveCutoff),
            detailCheckedAt: LessThan(recheckBefore),
          },
          {
            ...scope,
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
            { ...scope, detailFetchedAt: IsNull(), detailCheckedAt: IsNull() },
            { ...scope, detailFetchedAt: IsNull(), detailCheckedAt: LessThan(new Date(now - PENDING_RETRY_MS)) },
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
              ...scope,
              reworked: IsNull(),
              detailFetchedAt: Not(IsNull()),
              registered: LessThan(liveCutoff),
              detailCheckedAt: LessThan(staleBefore),
            },
            {
              ...scope,
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
