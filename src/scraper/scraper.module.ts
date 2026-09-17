import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ErrorCodeEntry } from './entities/error-code.entity';
import { KskRecord } from './entities/ksk-record.entity';
import { ScrapeState } from './entities/scrape-state.entity';
import { DetailQueueService } from './detail-queue.service';
import { IngestController } from './ingest/ingest.controller';
import { IngestService } from './ingest/ingest.service';
import { SyncSecretGuard } from './ingest/sync-secret.guard';
import { LiveHttpSource } from './live/live-http.source';
import { MockRemoteSource } from './mock/mock-remote.source';
import { RELAY_SOURCE, REMOTE_SOURCE } from './remote-source.interface';
import { ScraperStatusService } from './scraper-status.service';
import { ScraperController } from './scraper.controller';
import { ScraperGateway } from './scraper.gateway';
import { ScraperScheduler } from './scraper.scheduler';
import { ScraperSeedService } from './scraper.seed.service';
import { ScraperService } from './scraper.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([KskRecord, ErrorCodeEntry, ScrapeState]),
  ],
  controllers: [ScraperController, IngestController],
  providers: [
    ScraperStatusService,
    ScraperService,
    ScraperScheduler,
    ScraperGateway,
    ScraperSeedService,
    DetailQueueService,
    IngestService,
    SyncSecretGuard,
    MockRemoteSource,
    LiveHttpSource,
    {
      // SCRAPER_MODE=mock (default) -> MockRemoteSource, fake in-memory data.
      // SCRAPER_MODE=live           -> LiveHttpSource, real HTTP against
      //                                SITE_BASE_URL, parsed by site-parsers.ts.
      // SCRAPER_MODE=relay          -> nothing is fetched here at all: a plant
      //                                agent pushes pages to /api/scraper/ingest.
      provide: REMOTE_SOURCE,
      useFactory: (config: ConfigService, mock: MockRemoteSource, live: LiveHttpSource) => {
        const mode = config.get<string>('SCRAPER_MODE', 'mock');
        if (mode === 'relay') return RELAY_SOURCE;
        return mode === 'live' ? live : mock;
      },
      inject: [ConfigService, MockRemoteSource, LiveHttpSource],
    },
  ],
})
export class ScraperModule {}
