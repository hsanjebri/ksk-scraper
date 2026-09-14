import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KskModel } from './constants';
import { ErrorCodeEntry } from './entities/error-code.entity';
import { KskRecord } from './entities/ksk-record.entity';
import { ScrapeState } from './entities/scrape-state.entity';
import { RemoteDetailRecord } from './mock/mock-data.generator';
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
   * Fetches the current list page for `model` and returns the No. values
   * that are newer than the last one we've recorded in ScrapeState, oldest
   * first. Does NOT advance ScrapeState — the caller must call `markSeen()`
   * only after a No. has actually been persisted, so a failed save (network
   * hiccup, etc.) gets retried on the next tick instead of being silently
   * dropped.
   *
   * TODO(real-scraper): the only thing that changes here for production is
   * inside `fetchListRows()` below — everything after that call (the diff
   * against ScrapeState) stays the same.
   */
  async fastScan(model: KskModel): Promise<string[]> {
    const rows = await this.fetchListRows(model);
    if (rows.length === 0) return [];

    // The real page lists newest-first, same as the mock source.
    const newestNo = rows[0].no;

    const state = await this.scrapeStateRepo.findOne({ where: { model } });
    const lastSeenNo = state?.lastSeenNo ?? null;

    const newNos = lastSeenNo === null
      ? [newestNo] // first run for this model: only take the newest, not the whole backlog
      : rows.filter((row) => compareNo(row.no, lastSeenNo) > 0).map((row) => row.no);

    newNos.sort(compareNo);

    if (newNos.length > 0) {
      this.logger.log(`fastScan(${model}): found ${newNos.length} new record(s)`);
    }
    return newNos;
  }

  /** Records that `no` (and everything before it) has been handled for `model`. */
  async markSeen(model: KskModel, no: string): Promise<void> {
    await this.scrapeStateRepo.save({ model, lastSeenNo: no, updatedAt: new Date() });
  }

  /**
   * Fetches and parses a single detail page into a ready-to-save KskRecord
   * (with its error-code sub-rows attached). Does NOT save it — callers
   * decide when/whether to persist.
   */
  async fetchDetail(no: string, model: KskModel): Promise<KskRecord> {
    const remote = await this.fetchDetailPage(no, model);
    return this.mapRemoteToEntity(remote);
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
