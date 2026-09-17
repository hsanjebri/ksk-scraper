import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BACKFILL_DAYS, KskModel } from './constants';
import { ErrorCodeEntry } from './entities/error-code.entity';
import { KskRecord } from './entities/ksk-record.entity';
import { ScrapeState } from './entities/scrape-state.entity';
import { enrichWithDetail, mergeListAndDetail, syncErrorCodes } from './merge';
import { RemoteDetailRecord, RemoteErrorCodeRow, RemoteListRow } from './mock/mock-data.generator';
import { REMOTE_SOURCE, RemoteSource } from './remote-source.interface';
import { ScanSelection, selectNewRows } from './scan';

@Injectable()
export class ScraperService {
  constructor(
    @InjectRepository(ScrapeState)
    private readonly scrapeStateRepo: Repository<ScrapeState>,
    // MockRemoteSource or LiveHttpSource, chosen in ScraperModule by SCRAPER_MODE.
    @Inject(REMOTE_SOURCE)
    private readonly remoteSource: RemoteSource,
  ) {}

  /**
   * Downloads the list page for `model` and decides which rows are new.
   *
   * Does NOT advance ScrapeState — the caller records progress only once rows
   * are actually persisted, so a failure is retried instead of skipped.
   */
  async scanList(model: KskModel): Promise<{ pageRows: RemoteListRow[]; selection: ScanSelection }> {
    const pageRows = await this.remoteSource.getListPage(model);
    const state = await this.scrapeStateRepo.findOne({ where: { model } });
    const backfillSince =
      BACKFILL_DAYS > 0 ? new Date(Date.now() - BACKFILL_DAYS * 86_400_000) : null;

    return { pageRows, selection: selectNewRows(pageRows, state?.lastSeenNo ?? null, backfillSince) };
  }

  /** Records that `no` (and every lower No.) has been handled for `model`. */
  async markSeen(model: KskModel, no: string): Promise<void> {
    await this.scrapeStateRepo.save({ model, lastSeenNo: no, updatedAt: new Date() });
  }

  /** Raw detail-page record. Throws when the page can't be fetched or parsed. */
  async fetchDetailRaw(no: string, model: KskModel): Promise<RemoteDetailRecord> {
    return this.remoteSource.getDetailPage(no, model);
  }

  /** A new record built from a verified list row plus its detail page. */
  buildRecord(row: RemoteListRow, detail: RemoteDetailRecord): KskRecord {
    const record = this.mapRemoteToEntity(mergeListAndDetail(row, detail));
    const now = new Date();
    record.detailFetchedAt = now;
    record.detailCheckedAt = now;
    return record;
  }

  /**
   * A record known only from the list page. Stored so nothing is lost, but it
   * stays hidden from the dashboard until its detail page has been fetched —
   * until then its status would read "En cours" whether or not it is.
   */
  buildListOnlyRecord(row: RemoteListRow): KskRecord {
    const record = this.mapRemoteToEntity(mergeListAndDetail(row, null));
    record.detailFetchedAt = null;
    record.detailCheckedAt = null;
    return record;
  }

  /**
   * Applies a detail page to a stored record. Safe to repeat — see
   * enrichWithDetail.
   */
  applyDetail(record: KskRecord, fresh: RemoteDetailRecord): { closedNow: boolean } {
    const result = enrichWithDetail(record, fresh);
    record.errorCodes = syncErrorCodes(record.errorCodes, fresh.errorCodes, toErrorCodeEntity);
    const now = new Date();
    record.detailFetchedAt = now;
    record.detailCheckedAt = now;
    record.computeDerived();
    return result;
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
    record.errorCodes = remote.errorCodes.map(toErrorCodeEntity);
    record.computeDerived();
    return record;
  }
}

function toErrorCodeEntity(entry: RemoteErrorCodeRow): ErrorCodeEntry {
  const errorCode = new ErrorCodeEntry();
  errorCode.code = entry.code;
  errorCode.description = entry.description;
  errorCode.errorProducer = entry.errorProducer;
  errorCode.partType = entry.partType;
  errorCode.partName = entry.partName;
  errorCode.cavity = entry.cavity;
  errorCode.info = entry.info;
  return errorCode;
}
