import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { INLINE_DETAIL_LIMIT, KskModel, MAX_DETAIL_FETCH_PER_CYCLE } from '../constants';
import { DetailQueueService } from '../detail-queue.service';
import { KskRecord } from '../entities/ksk-record.entity';
import { ScrapeState } from '../entities/scrape-state.entity';
import { decodeHtmlBytes, parseDetailPage, parseListRows } from '../live/site-parsers';
import { RemoteListRow } from '../mock/mock-data.generator';
import { selectNewRows } from '../scan';
import { ScraperStatusService } from '../scraper-status.service';
import { ScraperGateway } from '../scraper.gateway';
import { ScraperService } from '../scraper.service';
import { DetailPayload, ListPayload } from './ingest.payload';

export interface ListIngestResult {
  model: KskModel;
  rowsOnPage: number;
  stored: number;
  charset: string;
  /** Record numbers the agent should fetch and post back next. */
  needDetails: string[];
  /**
   * How many records of this model are still waiting for a detail page,
   * beyond the batch above. The agent uses it to tell a first-run backfill
   * (thousands, worth hurrying) from normal traffic (a handful).
   */
  pending: number;
}

export interface DetailIngestResult {
  model: KskModel;
  applied: number;
  failed: number;
  newlyVisible: number;
  closed: number;
  needDetails: string[];
  pending: number;
}

/**
 * The cloud half of the plant bridge.
 *
 * The rework site is only reachable from inside the SEBN network, so this
 * instance never fetches anything: an agent on a plant PC posts the raw pages
 * here (POST /api/scraper/ingest) and asks what to fetch next.
 *
 * Everything past the decode is the code that runs when scraping directly —
 * same parsers, same merge rules, same priorities — so the two deployments
 * cannot drift apart.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly scraperService: ScraperService,
    private readonly detailQueue: DetailQueueService,
    private readonly gateway: ScraperGateway,
    private readonly status: ScraperStatusService,
    @InjectRepository(KskRecord)
    private readonly recordRepo: Repository<KskRecord>,
    @InjectRepository(ScrapeState)
    private readonly scrapeStateRepo: Repository<ScrapeState>,
  ) {}

  /** One model's results page, exactly as the site returned it. */
  async ingestList(payload: ListPayload): Promise<ListIngestResult> {
    const { text, charset } = decodeHtmlBytes(payload.bytes, payload.contentType, null);
    const pageRows = parseListRows(text, payload.model);

    if (pageRows.length === 0) {
      // A login page, an error page, or markup that changed. Never treated as
      // "the plant produced nothing" — that would advance the watermark and
      // skip real records.
      this.status.listFailed(payload.model, new Error('pushed page contained no rows'));
      this.logger.warn(
        `${payload.model}: pushed page had no rows (${text.length} chars) — ignored.`,
      );
      return { model: payload.model, rowsOnPage: 0, stored: 0, charset, needDetails: [], pending: 0 };
    }

    this.status.setCharset(charset);
    this.status.listScanned(payload.model, pageRows.length);
    this.status.agentSeen(payload.agent);

    const state = await this.scrapeStateRepo.findOne({ where: { model: payload.model } });
    const selection = selectNewRows(pageRows, state?.lastSeenNo ?? null);

    let stored = 0;
    if (selection.rows.length > 0) {
      stored = await this.storeListOnly(payload.model, selection.rows);
      if (selection.maxNo) await this.scraperService.markSeen(payload.model, selection.maxNo);
    }

    return {
      model: payload.model,
      rowsOnPage: pageRows.length,
      stored,
      charset,
      needDetails: await this.nextDetailWork(payload.model),
      pending: await this.pendingCount(payload.model),
    };
  }

  /** A batch of detail pages the agent fetched on our behalf. */
  async ingestDetails(payload: DetailPayload): Promise<DetailIngestResult> {
    this.status.agentSeen(payload.agent);

    const stored = await this.recordRepo.find({
      where: { model: payload.model, no: In(payload.pages.map((page) => page.no)) },
    });
    const byNo = new Map(stored.map((record) => [record.no, record]));

    let applied = 0;
    let failed = 0;
    let closed = 0;
    const becameVisible: KskRecord[] = [];
    const started = Date.now();

    for (const page of payload.pages) {
      const record = byNo.get(page.no);
      if (!record) {
        // Only ever happens if the agent posts something we did not ask for.
        failed++;
        continue;
      }

      try {
        const { text } = decodeHtmlBytes(page.bytes, page.contentType, null);
        const fresh = parseDetailPage(text, page.no, payload.model);
        const wasPending = record.detailFetchedAt === null;
        const hadQualityControl = record.qualityControlDate !== null;

        const { closedNow } = this.scraperService.applyDetail(record, fresh);
        const saved = await this.recordRepo.save(record);
        saved.computeDerived();
        applied++;

        if (wasPending) {
          becameVisible.push(saved);
        } else if (closedNow) {
          closed++;
          this.gateway.emitUpdatedRecord(saved);
          this.gateway.emitClosedRecord(saved);
        } else if (!hadQualityControl && saved.qualityControlDate !== null) {
          this.gateway.emitUpdatedRecord(saved);
        }
      } catch (err) {
        failed++;
        await this.recordRepo
          .update({ id: record.id }, { detailCheckedAt: new Date() })
          .catch(() => undefined);
        if (failed <= 3) {
          this.logger.warn(
            `detail ${payload.model} #${page.no} rejected: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // A handful of records appearing is live traffic worth animating; a
    // history backfill is thousands, and one refresh beats 5,939 events.
    if (becameVisible.length > 0 && becameVisible.length <= INLINE_DETAIL_LIMIT) {
      for (const record of becameVisible) this.gateway.emitNewRecord(record);
    } else if (becameVisible.length > 0) {
      this.gateway.emitRefresh();
    }

    this.status.detailCycle(
      {
        fetched: applied,
        failed,
        enrichedPending: becameVisible.length,
        closed,
        durationMs: Date.now() - started,
      },
      null,
    );

    return {
      model: payload.model,
      applied,
      failed,
      newlyVisible: becameVisible.length,
      closed,
      needDetails: await this.nextDetailWork(payload.model),
      pending: await this.pendingCount(payload.model),
    };
  }

  /** Records of this model still waiting for a detail page. */
  private pendingCount(model: KskModel): Promise<number> {
    return this.recordRepo.count({ where: { model, detailFetchedAt: IsNull() } });
  }

  /** What the agent should fetch next for this model, newest and live first. */
  private async nextDetailWork(model: KskModel): Promise<string[]> {
    const candidates = await this.detailQueue.pick(MAX_DETAIL_FETCH_PER_CYCLE, model);
    return candidates.map((record) => record.no);
  }

  /**
   * Stores rows the list page shows but we have never seen. They stay hidden
   * from the dashboard until their detail page arrives — without it a record
   * has no rework timestamp and would read "En cours" whether or not it is.
   */
  private async storeListOnly(model: KskModel, rows: RemoteListRow[]): Promise<number> {
    const known = await this.knownNos(model, rows.map((row) => row.no));
    const fresh = rows.filter((row) => !known.has(row.no));
    if (fresh.length === 0) return 0;

    const records = fresh.map((row) => this.scraperService.buildListOnlyRecord(row));
    await this.recordRepo.save(records, { chunk: 500 });
    this.logger.log(`${model}: ${fresh.length} new row(s) from the pushed list page.`);
    return fresh.length;
  }

  private async knownNos(model: KskModel, nos: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < nos.length; i += 500) {
      const rows = await this.recordRepo.find({
        select: { id: true, no: true },
        where: { model, no: In(nos.slice(i, i + 500)) },
        loadEagerRelations: false,
      });
      for (const row of rows) found.add(row.no);
    }
    return found;
  }
}
