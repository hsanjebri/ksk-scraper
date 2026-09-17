import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ListScanStatus {
  lastScanAt: string | null;
  rowsOnPage: number;
  lastError: string | null;
}

export interface DetailCycleStatus {
  lastCycleAt: string | null;
  fetched: number;
  failed: number;
  enrichedPending: number;
  closed: number;
  durationMs: number;
  lastError: string | null;
}

/**
 * In-memory scraper health, exposed at GET /records/status.
 *
 * Exists for the first run on a new machine: a live start begins by queueing
 * the site's entire history (~6,000 records) and enriching it over several
 * minutes. Without a visible progress figure an empty dashboard looks exactly
 * like a broken one.
 */
@Injectable()
export class ScraperStatusService {
  private readonly startedAt = new Date().toISOString();
  private charset: string | null = null;
  private readonly lists = new Map<string, ListScanStatus>();
  private detail: DetailCycleStatus = {
    lastCycleAt: null,
    fetched: 0,
    failed: 0,
    enrichedPending: 0,
    closed: 0,
    durationMs: 0,
    lastError: null,
  };
  private totals = { fetched: 0, failed: 0 };
  private agent: { name: string | null; lastSeenAt: string } | null = null;

  constructor(private readonly config: ConfigService) {}

  setCharset(charset: string): void {
    this.charset = charset;
  }

  /**
   * Last contact from the plant-side agent (relay mode). This is how the
   * dashboard can tell "nothing is happening in the plant" from "the bridge
   * is down", which look identical from outside the network.
   */
  agentSeen(agent: string | null): void {
    this.agent = { name: agent, lastSeenAt: new Date().toISOString() };
  }

  listScanned(model: string, rowsOnPage: number): void {
    this.lists.set(model, { lastScanAt: new Date().toISOString(), rowsOnPage, lastError: null });
  }

  listFailed(model: string, err: unknown): void {
    const previous = this.lists.get(model);
    this.lists.set(model, {
      lastScanAt: new Date().toISOString(),
      rowsOnPage: previous?.rowsOnPage ?? 0,
      lastError: err instanceof Error ? err.message : String(err),
    });
  }

  detailCycle(result: Omit<DetailCycleStatus, 'lastCycleAt' | 'lastError'>, lastError: string | null): void {
    this.detail = { ...result, lastCycleAt: new Date().toISOString(), lastError };
    this.totals.fetched += result.fetched;
    this.totals.failed += result.failed;
  }

  snapshot() {
    return {
      mode: this.config.get<string>('SCRAPER_MODE', 'mock'),
      startedAt: this.startedAt,
      charset: this.charset,
      lists: Object.fromEntries(this.lists),
      // Null unless a plant-side agent is pushing pages (relay mode).
      agent: this.agent,
      detail: { ...this.detail, totalFetched: this.totals.fetched, totalFailed: this.totals.failed },
    };
  }
}
