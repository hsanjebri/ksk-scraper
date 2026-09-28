import { Logger } from '@nestjs/common';
import { OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { KskRecord } from './entities/ksk-record.entity';

/** Origins allowed to open the socket, from CORS_ORIGINS. Empty = any origin
 *  holding a valid ticket (the ticket is the control; this is defence in depth). */
const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Live record events for signed-in dashboards only.
 *
 * Every handshake must carry a one-minute ticket from GET /auth/ws-ticket
 * (which itself requires a session). Before this, any anonymous client could
 * connect and receive every new and closed record.
 *
 * WebSocket transport only: the long-polling fallback is a cross-origin HTTP
 * exchange that would need CORS opened up again.
 */
@WebSocketGateway({ cors: false, transports: ['websocket'] })
export class ScraperGateway implements OnGatewayInit {
  private readonly logger = new Logger(ScraperGateway.name);

  constructor(private readonly auth: AuthService) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      const origin = socket.handshake.headers.origin;
      if (allowedOrigins.length > 0 && (!origin || !allowedOrigins.includes(origin))) {
        return next(new Error('unauthorized'));
      }
      const ticket = (socket.handshake.auth as Record<string, unknown> | undefined)?.ticket;
      const user = this.auth.verifyWsTicket(ticket);
      if (!user) return next(new Error('unauthorized'));
      (socket.data as Record<string, unknown>).user = user;
      next();
    });
  }

  @WebSocketServer()
  server: Server;

  /**
   * No server exists when the app runs without an HTTP listener — the CLI
   * tools (seed:captured, db:clear-mock) build an application context and go
   * through the same ingest code. Emitting then threw and killed the command
   * halfway through, leaving the database half-loaded.
   */
  private emit(event: string, payload?: unknown): void {
    if (!this.server) return;
    this.server.emit(event, payload);
  }

  emitNewRecord(record: KskRecord): void {
    this.logger.debug(`record.new -> ${record.model} #${record.no}`);
    this.emit('record.new', record);
  }

  emitUpdatedRecord(record: KskRecord): void {
    this.logger.debug(`record.updated -> ${record.model} #${record.no}`);
    this.emit('record.updated', record);
  }

  /** Emitted specifically for the "En cours" -> "Terminé" transition. */
  emitClosedRecord(record: KskRecord): void {
    this.logger.debug(`record.closed -> ${record.model} #${record.no}`);
    this.emit('record.closed', record);
  }

  /**
   * "Many records changed — refetch." Used instead of per-record events while
   * history is being enriched: thousands of individual record.new events would
   * make every connected dashboard re-render thousands of times.
   */
  emitRefresh(): void {
    this.logger.debug('records.refresh');
    this.emit('records.refresh');
  }
}
