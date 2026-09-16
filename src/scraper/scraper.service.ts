import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KskModel } from './constants';
import { ErrorCodeEntry } from './entities/error-code.entity';
import { KskRecord } from './entities/ksk-record.entity';
import { ScrapeState } from './entities/scrape-state.entity';
import { mergeListAndDetail } from './merge';
import { RemoteDetailRecord, RemoteListRow } from './mock/mock-data.generator';
import { REMOTE_SOURCE, RemoteSource } from './remote-source.interface';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  constructor(
    @InjectRepository(ScrapeState)
    private readonly scrapeStateRepo: Repository<ScrapeState>,
    // Bound to MockRemoteSource or LiveHttpSource in ScraperModule based on
    // SCRAPER_MODE. Nothing in this service needs to change when that flips.
    @Inject(REMOTE_SOURCE)
    private readonly remoteSource: RemoteSource,
  ) {}

  /**
   * Fetches the current list page for `model` and returns the FULL ROWS that
   * are newer than the last one recorded in ScrapeState, oldest first.
   *
   * Returning whole rows rather than just No. values is deliberate: the list
   * parser is verified against real server bytes, so its data is the most
   * trustworthy thing we have. Discarding it and rebuilding the record from
   * the (unverified) detail page is how good data gets overwritten with blanks.
   *
   * Does NOT advance ScrapeState — the caller calls `markSeen()` only once a
   * record is actually persisted, so a failed save is retried next tick
   * instead of being silently skipped.
   */
  async fastScan(model: KskModel): Promise<RemoteListRow[]> {
    const rows = await this.fetchListRows(model);
    if (rows.length === 0) return [];

    const state = await this.scrapeStateRepo.findOne({ where: { model } });
    const lastSeenNo = state?.lastSeenNo ?? null;

    // The real page lists newest-first, so on a first run rows[0] is the
    // newest; we take only that rather than ingesting the whole backlog.
    const newRows =
      lastSeenNo === null
        ? rows.slice(0, 1)
        : rows.filter((row) => compareNo(row.no, lastSeenNo) > 0);

    newRows.sort((a, b) => compareNo(a.no, b.no));

    if (newRows.length > 0) {
      this.logger.log(`fastScan(${model}): found ${newRows.length} new record(s)`);
    }
    return newRows;
  }

  /** Records that `no` (and everything before it) has been handled for `model`. */
  async markSeen(model: KskModel, no: string): Promise<void> {
    await this.scrapeStateRepo.save({ model, lastSeenNo: no, updatedAt: new Date() });
  }

  /**
   * Raw detail-page record, straight from the source. May come back almost
   * empty if the detail parser doesn't match the real markup — callers must
   * treat it as enrichment, never as the record itself.
   */
  async fetchDetailRaw(no: string, model: KskModel): Promise<RemoteDetailRecord> {
    return this.fetchDetailPage(no, model);
  }

  /** Combines a verified list row with optional detail enrichment, ready to save. */
  buildRecord(row: RemoteListRow, detail: RemoteDetailRecord | null): KskRecord {
    return this.mapRemoteToEntity(mergeListAndDetail(row, detail));
  }

  /**
   * Delegates to whichever RemoteSource is wired up (mock or live — see
   * ScraperModule). Real scraping logic lives in
   * src/scraper/live/live-http.source.ts.
   */
  private async fetchListRows(model: KskModel) {
    return this.remoteSource.getListPage(model);
  }

  /**
   * Delegates to whichever RemoteSource is wired up (mock or live — see
   * ScraperModule). Real scraping logic lives in
   * src/scraper/live/live-http.source.ts.
   */
  private async fetchDetailPage(no: string, model: KskModel): Promise<RemoteDetailRecord> {
    return this.remoteSource.getDetailPage(no, model);
  }

  /**
   * Maps a parsed remote record (mock or real — same shape either way) into
   * entity instances, ready for `repository.save()`.
   */
  mapRemoteToEntity(remote: RemoteDetailRecord): KskRecord {
    const record = new KskRecord();
    record.no = remote.no;
    record.model = remote.model;
    record.carId = remote.carId;
    record.zsb = remote.zsb;
    record.registered = new Date(remote.registered);
    record.reworked = remote.reworked ? new Date(remote.reworked) : null;
    record.qualityControlDate = remote.qualityControlDate
      ? new Date(remote.qualityControlDate)
      : null;
    record.defectShift = remote.defectShift;
    record.detectShift = remote.detectShift;
    record.defectBy = remote.defectBy;
    record.errorCode = remote.errorCode;
    record.partType = remote.partType;
    record.partName = remote.partName;
    record.description = remote.description;
    record.comment = remote.comment;
    record.color = remote.color;
    record.qualityGate = remote.qualityGate ?? null;
    record.errorCodes = remote.errorCodes.map((entry) => {
      const errorCode = new ErrorCodeEntry();
      errorCode.code = entry.code;
      errorCode.description = entry.description;
      errorCode.errorProducer = entry.errorProducer;
      errorCode.partType = entry.partType;
      errorCode.partName = entry.partName;
      errorCode.cavity = entry.cavity;
      errorCode.info = entry.info;
      return errorCode;
    });

    record.computeDerived();
    return record;
  }
}

/** Numeric comparison of "No." values (they're zero-padded integers). */
function compareNo(a: string, b: string): number {
  return Number(a) - Number(b);
}
