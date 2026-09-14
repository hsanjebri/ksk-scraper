import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { KskRecord } from './entities/ksk-record.entity';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class ScraperGateway {
  private readonly logger = new Logger(ScraperGateway.name);

  @WebSocketServer()
  server: Server;

  emitNewRecord(record: KskRecord): void {
    this.logger.debug(`record.new -> ${record.model} #${record.no}`);
    this.server.emit('record.new', record);
  }

  emitUpdatedRecord(record: KskRecord): void {
    this.logger.debug(`record.updated -> ${record.model} #${record.no}`);
    this.server.emit('record.updated', record);
  }

  /** Emitted specifically for the "En cours" -> "Terminé" transition. */
  emitClosedRecord(record: KskRecord): void {
    this.logger.debug(`record.closed -> ${record.model} #${record.no}`);
    this.server.emit('record.closed', record);
  }
}
