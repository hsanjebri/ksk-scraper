import { isValidPasswordHash } from './password';

/**
 * Parsing of the authentication settings. Pure — no Nest imports.
 *
 *   DASHBOARD_USERS  one entry per person:  name:scrypt$...  separated by ";" ","
 *                    or new lines. Generate entries with `npm run auth:hash-password`.
 *   SESSION_SECRET   at least 32 characters; signs session cookies and socket
 *                    tickets. Rotating it signs everyone out.
 *
 * Individual accounts rather than one shared login, so access can be revoked
 * per person and the server log says who signed in.
 */

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;
export const MIN_SESSION_SECRET_LENGTH = 32;

export interface ParsedUsers {
  users: Map<string, string>;
  /** Human-readable problems, safe to log: they never contain hashes. */
  problems: string[];
}

export function parseDashboardUsers(raw: string | undefined): ParsedUsers {
  const users = new Map<string, string>();
  const problems: string[] = [];

  for (const entry of (raw ?? '').split(/[;,\n]/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const colon = trimmed.indexOf(':');
    const name = colon > 0 ? trimmed.slice(0, colon).trim().toLowerCase() : '';
    const hash = colon > 0 ? trimmed.slice(colon + 1).trim() : '';

    if (!USERNAME_PATTERN.test(name)) {
      problems.push(
        `an entry has an invalid user name (3–64 of a-z 0-9 . _ -)`,
      );
      continue;
    }
    if (!isValidPasswordHash(hash)) {
      problems.push(
        `user "${name}" does not have a valid scrypt hash — plain passwords are not accepted`,
      );
      continue;
    }
    if (users.has(name)) {
      problems.push(`user "${name}" is listed twice; the first entry is used`);
      continue;
    }
    users.set(name, hash);
  }

  return { users, problems };
}

export function sessionSecretProblem(
  secret: string | undefined,
): string | null {
  if (!secret) return 'SESSION_SECRET is not set';
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    return `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters`;
  }
  return null;
}

/** Reads one cookie from a Cookie header without a parsing library. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}
