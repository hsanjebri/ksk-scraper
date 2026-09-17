import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { AppModule } from '../../app.module';
import { KSK_MODELS, KskModel } from '../constants';
import { IngestService } from '../ingest/ingest.service';

/**
 * Loads pages captured from the live site into whatever database the current
 * .env points at — including the cloud one, so the dashboard shows real plant
 * history from the moment it is deployed, before any agent has run.
 *
 *   npm run seed:captured                 # ./captured/captured
 *   npm run seed:captured -- <folder>
 *
 * It goes through the same ingest path the plant agent uses, so this is also a
 * genuine test of that path: same decoding, same parsers, same merge rules.
 *
 * Records whose detail page is not in the folder are stored but stay hidden
 * from the dashboard (they have no rework timestamp yet, so their status would
 * be a guess). The agent fills them in once it runs.
 */
async function main(): Promise<void> {
  const logger = new Logger('SeedCaptured');
  const folder = resolve(process.argv[2] ?? join(process.cwd(), 'captured', 'captured'));

  // In mock mode the app seeds ~5,800 generated records into an empty database
  // on startup — including this one, right before the real pages land on top.
  const mode = (process.env.SCRAPER_MODE ?? 'mock').toLowerCase();
  if (mode === 'mock') {
    logger.error(
      'Refusing to run with SCRAPER_MODE=mock: the app would seed fake records into this same ' +
        'database first, mixing invented rows into real plant history. Set SCRAPER_MODE=relay ' +
        '(cloud bridge) or live before seeding.',
    );
    process.exitCode = 1;
    return;
  }

  let files: string[];
  try {
    files = readdirSync(folder);
  } catch {
    logger.error(`No such folder: ${folder}`);
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const ingest = app.get(IngestService, { strict: false });

  try {
    for (const model of KSK_MODELS) {
      const listFile = files.find((name) => name.toLowerCase() === `list-${model.toLowerCase()}.html`);
      if (!listFile) {
        logger.warn(`${model}: no list-${model}.html in ${folder} — skipped.`);
        continue;
      }

      const bytes = new Uint8Array(readFileSync(join(folder, listFile)));
      const result = await ingest.ingestList({
        model,
        bytes,
        contentType: null,
        agent: 'captured-files',
      });
      logger.log(
        `${model}: ${result.rowsOnPage} row(s) on the page, ${result.stored} new, decoded as ${result.charset}.`,
      );

      // Any detail page for this model that came with the capture.
      const detailFiles = files.filter((name) =>
        new RegExp(`^detail-${model}-(\\d+)\\.html$`, 'i').test(name),
      );
      if (detailFiles.length === 0) continue;

      const pages = detailFiles.map((name) => ({
        no: /-(\d+)\.html$/i.exec(name)![1],
        bytes: new Uint8Array(readFileSync(join(folder, name))),
        contentType: null,
      }));
      const applied = await ingest.ingestDetails({ model, pages, agent: 'captured-files' });
      logger.log(
        `${model}: ${applied.applied} detail page(s) applied, ${applied.failed} rejected, ` +
          `${applied.pending} record(s) still waiting for one.`,
      );
    }

    logger.log(
      'Done. Records without a detail page stay hidden until the plant agent fetches it — ' +
        'GET /records/status shows the remaining count as "pending".',
    );
  } finally {
    await app.close();
  }
}

void main();
