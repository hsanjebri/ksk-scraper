import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { MAX_DETAIL_FETCH_PER_CYCLE } from '../constants';
import { IngestService } from './ingest.service';
import { parseDetailPayload, parseFailed, parseListPayload } from './ingest.payload';
import { SyncSecretGuard } from './sync-secret.guard';

/**
 * Where the plant-side agent pushes pages it read from the rework site.
 *
 * The flow, one model at a time, every 45–60 s:
 *   1. agent POSTs the results page          -> /api/scraper/ingest
 *      response says which detail pages to fetch
 *   2. agent POSTs those detail pages        -> /api/scraper/ingest/details
 *      response may ask for more, until it runs out or hits its budget
 *
 * Pages are sent as base64 of the raw bytes: the site declares no charset, so
 * decoding belongs here, next to the parsers that were tested against it.
 */
@Controller('api/scraper/ingest')
@UseGuards(SyncSecretGuard)
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post()
  async ingestList(@Body() body: unknown) {
    const parsed = parseListPayload(body);
    if (parseFailed(parsed)) throw new BadRequestException(parsed.error);

    const result = await this.ingest.ingestList(parsed.value);
    return { ok: true, ...result, maxDetailsPerBatch: MAX_DETAIL_FETCH_PER_CYCLE };
  }

  @Post('details')
  async ingestDetails(@Body() body: unknown) {
    const parsed = parseDetailPayload(body);
    if (parseFailed(parsed)) throw new BadRequestException(parsed.error);

    const result = await this.ingest.ingestDetails(parsed.value);
    return { ok: true, ...result, maxDetailsPerBatch: MAX_DETAIL_FETCH_PER_CYCLE };
  }
}
