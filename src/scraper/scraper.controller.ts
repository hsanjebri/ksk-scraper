import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KskModel } from './constants';
import { KskRecord } from './entities/ksk-record.entity';

@Controller('records')
export class ScraperController {
  constructor(
    @InjectRepository(KskRecord)
    private readonly recordRepo: Repository<KskRecord>,
  ) {}

  @Get()
  async findAll(@Query('model') model?: KskModel): Promise<KskRecord[]> {
    const records = await this.recordRepo.find({
      where: model ? { model } : {},
      order: { registered: 'DESC' },
    });
    records.forEach((record) => record.computeDerived());
    return records;
  }
}
