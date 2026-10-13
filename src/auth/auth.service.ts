import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseDashboardUsers, sessionSecretProblem } from './auth-config';
import { hashPassword, verifyPassword } from './password';
import { signToken, verifyToken } from './session-token';

/** A string discriminant: this project compiles without strictNullChecks, where
 *  a boolean one (ok: true/false) does not narrow. */
export type LoginResult =
  | { status: 'ok'; user: string; token: string; maxAgeSeconds: number }
  | { status: 'invalid' | 'locked' | 'not-configured' };

/** Failed attempts allowed per user name before it is locked for the window. */
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const WS_TICKET_SECONDS = 60;

/**
 * Dashboard authentication.
 *
 * Fails closed: without valid DASHBOARD_USERS and SESSION_SECRET nobody can
 * sign in and every protected route answers 401. The misconfiguration is
 * logged once at startup — without echoing any secret or hash.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private users = new Map<string, string>();
  private secret: string | null = null;
  private sessionSeconds = 8 * 3600;
  /** Hash checked for unknown user names, so response time does not reveal
   *  which names exist. */
  private dummyHash: string | null = null;
  private readonly failures = new Map<
    string,
    { count: number; firstAt: number }
  >();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const { users, problems } = parseDashboardUsers(
      this.config.get<string>('DASHBOARD_USERS'),
    );
    for (const problem of problems)
      this.logger.error(`DASHBOARD_USERS: ${problem}`);
    this.users = users;

    const secret = this.config.get<string>('SESSION_SECRET');
    const secretProblem = sessionSecretProblem(secret);
    if (secretProblem)
      this.logger.error(`${secretProblem} — dashboard sign-in is disabled.`);
    this.secret = secretProblem ? null : (secret as string);

    const hours = Number(this.config.get<string>('SESSION_TTL_HOURS', '8'));
    if (Number.isFinite(hours) && hours > 0 && hours <= 24)
      this.sessionSeconds = Math.round(hours * 3600);

    this.dummyHash = await hashPassword(`unused-${Date.now()}`);

    if (this.configured) {
      this.logger.log(
        `Dashboard sign-in enabled for ${users.size} user(s); sessions last ${this.sessionSeconds / 3600} h.`,
      );
    } else if (users.size === 0) {
      this.logger.error(
        'No dashboard users configured (DASHBOARD_USERS) — dashboard sign-in is disabled.',
      );
    }
  }

  get configured(): boolean {
    return this.secret !== null && this.users.size > 0;
  }

  async login(username: string, password: string): Promise<LoginResult> {
    if (!this.configured) return { status: 'not-configured' };

    const name = username.trim().toLowerCase();
    if (this.isLocked(name)) return { status: 'locked' };

    const hash = this.users.get(name);
    // Always run one scrypt check, known user or not.
    const valid = await verifyPassword(
      password,
      hash ?? (this.dummyHash as string),
    );

    if (!hash || !valid) {
      this.recordFailure(name);
      this.logger.warn(`Failed dashboard sign-in for "${name.slice(0, 64)}".`);
      return { status: this.isLocked(name) ? 'locked' : 'invalid' };
    }

    this.failures.delete(name);
    this.logger.log(`Dashboard sign-in: ${name}.`);
    const now = Math.floor(Date.now() / 1000);
    const token = signToken(
      { sub: name, typ: 'session', iat: now, exp: now + this.sessionSeconds },
      this.secret as string,
    );
    return {
      status: 'ok',
      user: name,
      token,
      maxAgeSeconds: this.sessionSeconds,
    };
  }

  /** The signed-in user, or null. Also null once the user has been removed. */
  verifySession(token: unknown): string | null {
    return this.verify(token, 'session');
  }

  issueWsTicket(user: string): string {
    const now = Math.floor(Date.now() / 1000);
    return signToken(
      { sub: user, typ: 'ws', iat: now, exp: now + WS_TICKET_SECONDS },
      this.secret as string,
    );
  }

  verifyWsTicket(ticket: unknown): string | null {
    return this.verify(ticket, 'ws');
  }

  private verify(token: unknown, type: 'session' | 'ws'): string | null {
    if (!this.secret) return null;
    const claims = verifyToken(token, this.secret, type);
    if (!claims || !this.users.has(claims.sub)) return null;
    return claims.sub;
  }

  private isLocked(name: string): boolean {
    const entry = this.failures.get(name);
    if (!entry) return false;
    if (Date.now() - entry.firstAt > FAILURE_WINDOW_MS) {
      this.failures.delete(name);
      return false;
    }
    return entry.count >= MAX_FAILURES;
  }

  private recordFailure(name: string): void {
    const now = Date.now();
    const entry = this.failures.get(name);
    if (!entry || now - entry.firstAt > FAILURE_WINDOW_MS) {
      this.failures.set(name, { count: 1, firstAt: now });
    } else {
      entry.count += 1;
    }
    // Bound memory against a flood of random user names.
    if (this.failures.size > 10_000) {
      const oldest = this.failures.keys().next().value;
      if (oldest !== undefined) this.failures.delete(oldest);
    }
  }
}
