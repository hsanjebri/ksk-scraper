import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { readCookie } from './auth-config';
import { AuthService } from './auth.service';
import { IS_PUBLIC } from './public.decorator';

/**
 * `__Host-` pins the cookie to this exact host over HTTPS (no Domain, Path=/,
 * Secure). Browsers refuse the prefix on plain http://localhost, so local
 * development uses the bare name — with the same HttpOnly / Secure /
 * SameSite=Strict attributes. The production image sets NODE_ENV=production.
 */
export const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-ksk_session' : 'ksk_session';

/** Request with the signed-in user attached by SessionGuard. */
export interface AuthenticatedRequest extends Request {
  user?: string;
}

/**
 * Applied to every HTTP route (registered as a global guard in AuthModule).
 * A route is public only when marked @Public().
 *
 * The WebSocket is not covered here — it authenticates in its handshake,
 * see ScraperGateway.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = this.auth.verifySession(readCookie(request.headers.cookie, SESSION_COOKIE));
    if (!user) throw new UnauthorizedException();

    request.user = user;
    return true;
  }
}
