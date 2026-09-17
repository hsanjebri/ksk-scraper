import type { RemoteListRow } from './mock/mock-data.generator';

/**
 * Which rows on a list page are new.
 *
 * Kept pure (no Nest, no TypeORM) so the rule is testable against real pages.
 *
 * The page is sorted by Registered date, NOT by No. — entries get backdated,
 * so a higher No. can sit below a lower one (verified on the real MAM page:
 * 66 order breaks in 2,938 rows). Nothing here may therefore look at row
 * POSITIONS. New = "No. greater than the highest No. already handled",
 * evaluated across the whole page.
 */
export interface ScanSelection {
  /** Rows to ingest, ascending by No. so progress can be recorded per row. */
  rows: RemoteListRow[];
  /** First run for this model: the page is the entire history, not new traffic. */
  backfill: boolean;
  /** Highest No. on the page — what ScrapeState should reach once ingested. */
  maxNo: string | null;
}

const numericNo = (row: RemoteListRow) => Number(row.no);

export function selectNewRows(
  pageRows: RemoteListRow[],
  lastSeenNo: string | null,
  backfillSince: Date | null = null,
): ScanSelection {
  // A No. that isn't a number can't be ordered, so it can't be tracked.
  const valid = pageRows.filter((row) => Number.isFinite(numericNo(row)));

  let maxNo: string | null = null;
  for (const row of valid) {
    if (maxNo === null || numericNo(row) > Number(maxNo)) maxNo = row.no;
  }

  const backfill = lastSeenNo === null;
  const last = Number(lastSeenNo);

  const rows = valid
    .filter((row) => {
      if (backfill) {
        return !backfillSince || new Date(row.registered).getTime() >= backfillSince.getTime();
      }
      return numericNo(row) > last;
    })
    .sort((a, b) => numericNo(a) - numericNo(b));

  return { rows, backfill, maxNo };
}
