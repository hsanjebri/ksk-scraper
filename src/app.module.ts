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
        const sqlite: TypeOrmModuleOptions = {
          type: 'better-sqlite3',
          database: `${config.get<string>('DB_NAME', 'ksk_scraper')}.sqlite`,
          autoLoadEntities: true,
          synchronize: true,
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
