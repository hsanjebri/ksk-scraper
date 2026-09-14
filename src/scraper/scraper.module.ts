import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ErrorCodeEntry } from './entities/error-code.entity';
import { KskRecord } from './entities/ksk-record.entity';
import { ScrapeState } from './entities/scrape-state.entity';
import { LiveHttpSource } from './live/live-http.source';
import { MockRemoteSource } from './mock/mock-remote.source';
import { REMOTE_SOURCE } from './remote-source.interface';
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
  controllers: [ScraperController],
  providers: [
    ScraperService,
    ScraperScheduler,
    ScraperGateway,
    ScraperSeedService,
    MockRemoteSource,
    LiveHttpSource,
    {
      // SCRAPER_MODE=mock (default) -> MockRemoteSource, fake in-memory data.
      // SCRAPER_MODE=live           -> LiveHttpSource, real Axios+Cheerio
      //                                calls against SITE_BASE_URL.
      provide: REMOTE_SOURCE,
      useFactory: (config: ConfigService, mock: MockRemoteSource, live: LiveHttpSource) =>
        config.get<string>('SCRAPER_MODE', 'mock') === 'live' ? live : mock,
      inject: [ConfigService, MockRemoteSource, LiveHttpSource],
    },
  ],
})
export class ScraperModule {}
