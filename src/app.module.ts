import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DB_DRIVER } from './database.config';
import { ScraperModule } from './scraper/scraper.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => {
        // Each branch is annotated separately: as a single inline union the
        // compiler cannot discriminate on `type` and tries to validate the
        // SQLite shape against the mssql options interface.
        if (DB_DRIVER === 'postgres') {
          const postgres: TypeOrmModuleOptions = {
            type: 'postgres',
            host: config.get<string>('DB_HOST', 'localhost'),
            port: config.get<number>('DB_PORT', 5432),
            username: config.get<string>('DB_USERNAME', 'postgres'),
            password: config.get<string>('DB_PASSWORD', 'postgres'),
            database: config.get<string>('DB_NAME', 'ksk_scraper'),
            autoLoadEntities: true,
            synchronize: true,
          };
          return postgres;
        }

        // Single-file database — no Docker, no server to install. This is what
        // makes the plant deployment a plain `npm start`.
        //
        // One file PER MODE (ksk_scraper-mock.sqlite / ksk_scraper-live.sqlite).
        // With a shared file, anyone who tried the demo first and then switched
        // to live would get fake records mixed permanently into real factory
        // data — the seed only runs on an empty database, so nothing would ever
        // clean them out.
        const mode = config.get<string>('SCRAPER_MODE', 'mock') === 'live' ? 'live' : 'mock';
        const sqlite: TypeOrmModuleOptions = {
          type: 'better-sqlite3',
          database: `${config.get<string>('DB_NAME', 'ksk_scraper')}-${mode}.sqlite`,
          autoLoadEntities: true,
          synchronize: true,
          // better-sqlite3 is synchronous: every statement blocks the event
          // loop. In the default rollback-journal mode each save's COMMIT
          // waits on a disk flush — profiled at 43% of wall time during a
          // backfill, long enough for keep-alive sockets to the rework site to
          // be reset mid-request. WAL + synchronous=NORMAL skips the per-commit
          // flush; a power cut can lose the last few writes, which the next
          // detail cycle simply re-fetches.
          enableWAL: true,
          prepareDatabase: (db: { pragma: (sql: string) => unknown }) => {
            db.pragma('synchronous = NORMAL');
          },
        };
        return sqlite;
      },
    }),
    ScraperModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
