import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { secretMatches } from './ingest.payload';

/**
 * Guards the ingest endpoints with the shared secret from SYNC_SECRET.
 *
 * These endpoints WRITE the quality data the dashboard reports, on a public
 * URL, so they are closed by default: with no SYNC_SECRET configured nothing
 * is accepted at all. The agent sends the secret in `x-sync-secret`.
 */
@Injectable()
export class SyncSecretGuard implements CanActivate {
  private readonly logger = new Logger(SyncSecretGuard.name);
  private warnedMissing = false;

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('SYNC_SECRET');
    if (!expected) {
      if (!this.warnedMissing) {
        this.warnedMissing = true;
        this.logger.error(
          'SYNC_SECRET is not set — every ingest request will be rejected. ' +
            'Set it on the server and in the plant agent.',
        );
      }
      throw new UnauthorizedException('ingest is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (!secretMatches(request.header('x-sync-secret'), expected)) {
      this.logger.warn(`Rejected ingest from ${request.ip ?? 'unknown'}: bad or missing secret.`);
      throw new UnauthorizedException('invalid sync secret');
    }
    return true;
  }
}
