import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../../app.module';
import { KskRecord } from '../entities/ksk-record.entity';

/**
 * Removes mock records from the database the current .env points at.
 *
 * A server started without SCRAPER_MODE defaults to mock and seeds fake data.
 * If that happened on the cloud database before it was switched to relay mode,
 * those rows would sit alongside real plant records and quietly inflate every
 * figure on the dashboard.
 *
 *   npm run db:clear-mock            # counts them, deletes nothing
 *   npm run db:clear-mock -- --yes   # deletes them
 *
 * Mock records are recognised by their numbering: the generator starts at
 * 100001, while the real site's numbers are in the low thousands. Real records
 * are never touched — and a dry run is the default because this cannot be
 * undone.
 */
async function main(): Promise<void> {
  const logger = new Logger('ClearMock');
  const confirmed = process.argv.includes('--yes');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const records: Repository<KskRecord> = app.get(getRepositoryToken(KskRecord), { strict: false });

  try {
    const suspect = await records
      .createQueryBuilder('r')
      .where('length(r.no) >= 6')
      .getMany();
    const total = await records.count();

    if (suspect.length === 0) {
      logger.log(`No mock-looking records found (${total} record(s) in total). Nothing to do.`);
      return;
    }

    const sample = suspect.slice(0, 5).map((r) => `${r.model} #${r.no} (${r.carId})`).join(', ');
    logger.warn(`${suspect.length} of ${total} record(s) look like mock data: ${sample}…`);

    if (!confirmed) {
      logger.warn('Dry run — nothing deleted. Re-run with `-- --yes` to delete them.');
      return;
    }

    // remove() so the cascade takes each record's error-code rows with it.
    await records.remove(suspect, { chunk: 200 });
    logger.log(`Deleted ${suspect.length} mock record(s). ${await records.count()} record(s) remain.`);
  } finally {
    await app.close();
  }
}

void main();
