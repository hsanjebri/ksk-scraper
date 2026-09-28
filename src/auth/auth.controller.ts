import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { CookieOptions, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { AuthenticatedRequest, SESSION_COOKIE } from './session.guard';

/**
 * The session lives in an HttpOnly cookie that JavaScript cannot read, bound
 * to the dashboard's own site (the dashboard reaches this API through its
 * /api proxy, so the cookie is first-party):
 *  - HttpOnly      a script injected into the page cannot steal it
 *  - Secure        never sent over plain HTTP
 *  - SameSite=Strict  never sent on a request started by another site (CSRF)
 *  - __Host- prefix   no Domain, Path=/, Secure — cannot be set by a sibling
 *                     subdomain
 */
const cookieOptions = (maxAgeMs?: number): CookieOptions => ({
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
});

function readCredentials(body: unknown): { username: string; password: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Expected a JSON object');
  }
  const keys = Object.keys(body);
  if (keys.some((key) => key !== 'username' && key !== 'password')) {
    throw new BadRequestException('Unexpected field');
  }
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new BadRequestException('username and password are required');
  }
  if (username.length === 0 || username.length > 64 || password.length === 0 || password.length > 256) {
    throw new BadRequestException('username or password has an invalid length');
  }
  return { username, password };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Public: this is how a session is obtained. Brute force is bounded by the
  // per-user lockout in AuthService and the per-IP rate limit.
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.NO_CONTENT)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<void> {
    const { username, password } = readCredentials(body);
    const result = await this.auth.login(username, password);

    if (result.status !== 'ok') {
      if (result.status === 'not-configured') {
        throw new ServiceUnavailableException('Sign-in is not configured on the server');
      }
      if (result.status === 'locked') {
        throw new HttpException('Too many failed attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
      }
      // One message for unknown user and wrong password alike.
      throw new UnauthorizedException('Invalid user name or password');
    }

    res.cookie(SESSION_COOKIE, result.token, cookieOptions(result.maxAgeSeconds * 1000));
  }

  // Public: clearing a cookie needs no proof of holding it.
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, cookieOptions());
  }

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return { user: req.user };
  }

  /**
   * A one-minute ticket for opening the live socket. The socket connects to
   * the backend's own host (the dashboard's proxy cannot carry WebSockets), so
   * it cannot use the session cookie; the ticket is fetched through the
   * proxy, where the cookie does apply.
   */
  @Get('ws-ticket')
  wsTicket(@Req() req: AuthenticatedRequest) {
    return { ticket: this.auth.issueWsTicket(req.user as string) };
  }
}
