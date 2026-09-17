import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { KSK_MODELS } from './constants';
import { KskRecord } from './entities/ksk-record.entity';
import { ScrapeState } from './entities/scrape-state.entity';
import { MockRemoteSource } from './mock/mock-remote.source';
import { ScraperService } from './scraper.service';

/**
 * Populates the database with fake KskRecords on first startup in mock mode,
 * so the dashboard, watch-list and WebSocket events have something to show.
 *
 * Only runs when SCRAPER_MODE=mock (the default). Live mode never seeds, and
 * uses its own database file (see app.module.ts) so mock records can never
 * end up mixed in with real factory data.
 */
@Injectable()
export class ScraperSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScraperSeedService.name);

  constructor(
    @InjectRepository(KskRecord)
    private readonly recordRepo: Repository<KskRecord>,
    @InjectRepository(ScrapeState)
    private readonly scrapeStateRepo: Repository<ScrapeState>,
    private readonly mockRemote: MockRemoteSource,
    private readonly scraperService: ScraperService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('SCRAPER_MODE', 'mock') !== 'mock') {
      this.logger.log('SCRAPER_MODE=live — skipping fake data seed.');
      return;
    }

    const existing = await this.recordRepo.count();
    if (existing > 0) {
      // Mock records are always complete. Databases created before detail
      // tracking existed have these columns null, which would hide every
      // record from the API — mark them as fetched.
      const now = new Date();
      const result = await this.recordRepo.update(
        { detailFetchedAt: IsNull() },
        { detailFetchedAt: now, detailCheckedAt: now },
      );
      if (result.affected) {
        this.logger.log(`Marked ${result.affected} existing mock record(s) as detail-complete.`);
      }
      this.logger.log(`Skipping seed — ${existing} record(s) already in DB.`);
      return;
    }

    // 60 per model (~120 total) spread over ~12 weeks — enough per-week volume
    // for the dashboard's weekly trend, deltas and sparklines to be meaningful.
    this.mockRemote.seedInitial(60);

    for (const model of KSK_MODELS) {
      const remoteRecords = this.mockRemote.getAllSeeded(model);
      let newestNo: string | null = null;

      for (const remote of remoteRecords) {
        const entity = this.scraperService.mapRemoteToEntity(remote);
        entity.detailFetchedAt = new Date();
        entity.detailCheckedAt = new Date();
        await this.recordRepo.save(entity);
        if (newestNo === null || Number(remote.no) > Number(newestNo)) {
          newestNo = remote.no;
        }
      }

      await this.scrapeStateRepo.save({
        model,
        lastSeenNo: newestNo,
        updatedAt: new Date(),
      });
    }

    this.logger.log(`Seeded ${await this.recordRepo.count()} fake KskRecord(s).`);
  }
}
