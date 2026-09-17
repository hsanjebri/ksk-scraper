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
    const mode = this.config.get<string>('SCRAPER_MODE', 'mock');
    if (mode !== 'mock') {
      this.logger.log(`SCRAPER_MODE=${mode} — skipping fake data seed.`);
      await this.warnAboutMockLeftovers(mode);
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

    // 600 per model over ~12 weeks (~50/week each). The real MAM page carries
    // 2,938 records over the same span; 60 per model made every weekly figure
    // two orders of magnitude too small, and a rework rate of ~0.3% where the
    // real data gives ~18% against the same assumed production volume.
    this.mockRemote.seedInitial(600);

    for (const model of KSK_MODELS) {
      const remoteRecords = this.mockRemote.getAllSeeded(model);
      let newestNo: string | null = null;

      const entities = remoteRecords.map((remote) => {
        const entity = this.scraperService.mapRemoteToEntity(remote);
        entity.detailFetchedAt = new Date();
        entity.detailCheckedAt = new Date();
        if (newestNo === null || Number(remote.no) > Number(newestNo)) {
          newestNo = remote.no;
        }
        return entity;
      });
      // One transaction per chunk rather than per record: saving these one at
      // a time made a first start take minutes.
      await this.recordRepo.save(entities, { chunk: 200 });

      await this.scrapeStateRepo.save({
        model,
        lastSeenNo: newestNo,
        updatedAt: new Date(),
      });
    }

    this.logger.log(`Seeded ${await this.recordRepo.count()} fake KskRecord(s).`);
  }

  /**
   * Shouts if a live or relay database still holds records from a mock run.
   *
   * A server started without SCRAPER_MODE defaults to mock and seeds fake
   * records; pointing that same database at the plant afterwards would blend
   * invented rows into reported quality figures, with nothing on screen saying
   * so. Mock numbering starts at 100001 while the real site is in the low
   * thousands, which makes the leftovers recognisable.
   */
  private async warnAboutMockLeftovers(mode: string): Promise<void> {
    const seeded = await this.recordRepo
      .createQueryBuilder('r')
      .where('length(r.no) >= 6')
      .getCount()
      .catch(() => 0);

    if (seeded === 0) return;

    this.logger.error(
      `This database holds ${seeded} record(s) that look like mock data (No. >= 100000) ` +
        `while running in ${mode} mode. Fake and real records must not be mixed — ` +
        'clear them with `npm run db:clear-mock -- --yes` before trusting anything on the dashboard.',
    );
  }
}
