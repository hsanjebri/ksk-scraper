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

/**
 * Stand-in used when SCRAPER_MODE=relay: this instance is outside the SEBN
 * network and has no route to the rework site. Pages arrive by push instead
 * (see IngestService). Throwing rather than returning nothing is deliberate —
 * empty results would look like a plant with no defects.
 */
export const RELAY_SOURCE: RemoteSource = {
  getListPage(): never {
    throw new Error(
      'SCRAPER_MODE=relay: this server does not fetch pages. The plant agent posts them to /api/scraper/ingest.',
    );
  },
  getDetailPage(): never {
    throw new Error(
      'SCRAPER_MODE=relay: this server does not fetch pages. The plant agent posts them to /api/scraper/ingest.',
    );
  },
};
