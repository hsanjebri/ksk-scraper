import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Not, Repository } from 'typeorm';
import { KSK_MODELS, KskModel } from './constants';
import { KskRecord } from './entities/ksk-record.entity';
import { ScraperStatusService } from './scraper-status.service';

@Controller('records')
export class ScraperController {
  constructor(
    @InjectRepository(KskRecord)
    private readonly recordRepo: Repository<KskRecord>,
    private readonly status: ScraperStatusService,
  ) {}

  /**
   * Records ready for the dashboard.
   *
   * Records whose detail page hasn't been fetched yet are excluded: they come
   * from the list page only, so they have no rework timestamp and would all
   * read "En cours" — thousands of fake open cars during a first-run backfill.
   * `?includePending=true` returns them anyway, for debugging.
   */
  @Get()
  async findAll(
    @Query('model') model?: KskModel,
    @Query('includePending') includePending?: string,
  ): Promise<KskRecord[]> {
    const where: FindOptionsWhere<KskRecord> = {};
    if (model) where.model = model;
    if (includePending !== 'true' && includePending !== '1') {
      where.detailFetchedAt = Not(IsNull());
    }

    const records = await this.recordRepo.find({ where, order: { registered: 'DESC' } });
    records.forEach((record) => record.computeDerived());
    return records;
  }

  /**
   * Scraper health and sync progress — what the dashboard's sync badge shows.
   *
   * One aggregate query with no joins. `repository.count()` would join the
   * eager error-code relation and COUNT(DISTINCT) — seven of those per poll
   * measurably slowed the scraper itself during a backfill.
   */
  @Get('status')
  async getStatus() {
    const rows: { model: string; total: string | number; pending: string | number; open: string | number }[] =
      await this.recordRepo
        .createQueryBuilder('r')
        .select('r.model', 'model')
        .addSelect('COUNT(*)', 'total')
        .addSelect('SUM(CASE WHEN r.detailFetchedAt IS NULL THEN 1 ELSE 0 END)', 'pending')
        .addSelect(
          'SUM(CASE WHEN r.reworked IS NULL AND r.detailFetchedAt IS NOT NULL THEN 1 ELSE 0 END)',
          'open',
        )
        .groupBy('r.model')
        .getRawMany();

    const byModel: Record<string, { total: number; pending: number }> = {};
    for (const model of KSK_MODELS) byModel[model] = { total: 0, pending: 0 };
    let total = 0;
    let pending = 0;
    let open = 0;
    for (const row of rows) {
      // Postgres returns bigint aggregates as strings.
      const t = Number(row.total);
      const p = Number(row.pending);
      byModel[row.model] = { total: t, pending: p };
      total += t;
      pending += p;
      open += Number(row.open);
    }

    return {
      ...this.status.snapshot(),
      counts: { total, ready: total - pending, pending, open, byModel },
    };
  }
}
