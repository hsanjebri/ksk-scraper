import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { NonceCache, parseKeys, verifySignedRequest } from './signature';

/**
 * Authenticates the plant collector by HMAC signature (see signature.ts).
 *
 * Runs before anything reads the body: main.ts gives this route a raw-bytes
 * parser, so at this point the body is an unparsed Buffer.
 *
 * Every failure answers the same bare 401. The reason goes to the server log
 * only — a caller probing the endpoint learns nothing about which check
 * failed. The log never contains the key, the signature or the body.
 */
@Injectable()
export class SyncSecretGuard implements CanActivate {
  private readonly logger = new Logger(SyncSecretGuard.name);
  private readonly nonces = new NonceCache();
  private warnedNoKey = false;

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const keys = parseKeys(this.config.get<string>('SYNC_SECRET'));

    const verdict = verifySignedRequest(
      {
        timestamp: request.header('x-sync-timestamp'),
        nonce: request.header('x-sync-nonce'),
        signature: request.header('x-sync-signature'),
        body: request.body,
      },
      keys,
      this.nonces,
    );

    if (verdict === 'ok') return true;

    if (verdict === 'no-key-configured') {
      if (!this.warnedNoKey) {
        this.warnedNoKey = true;
        this.logger.error(
          `SYNC_SECRET is not set, or shorter than 32 characters — every collector request is rejected.`,
        );
      }
    } else {
      this.logger.warn(`Rejected collector request from ${request.ip ?? 'unknown'}: ${verdict}.`);
    }
    throw new UnauthorizedException();
  }
}
