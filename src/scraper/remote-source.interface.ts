import { KskModel } from './constants';
import { RemoteDetailRecord, RemoteListRow } from './mock/mock-data.generator';

/**
 * Shared contract between MockRemoteSource (fake data, used when
 * SCRAPER_MODE=mock) and LiveHttpSource (real Axios+Cheerio, used when
 * SCRAPER_MODE=live). ScraperService only ever talks to this interface.
 */
export interface RemoteSource {
  getListPage(model: KskModel): Promise<RemoteListRow[]> | RemoteListRow[];
  getDetailPage(no: string, model: KskModel): Promise<RemoteDetailRecord> | RemoteDetailRecord;
}

export const REMOTE_SOURCE = Symbol('REMOTE_SOURCE');
