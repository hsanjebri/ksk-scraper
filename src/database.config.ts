import 'dotenv/config';

/**
 * Database driver selection, resolved at IMPORT time.
 *
 * This deliberately does not go through Nest's ConfigModule. Entity decorators
 * evaluate as soon as the entity files are imported, which happens before any
 * Nest module initialises — so the column types below must already be decided
 * by then. Hence the bare `dotenv/config` import.
 *
 * Note this project's TypeORM has no plain `"sqlite"` driver; that was removed
 * in favour of `better-sqlite3`. `DB_TYPE=sqlite` is accepted here and mapped
 * to it, so existing .env files keep working.
 */
export type DbDriver = 'better-sqlite3' | 'postgres';

export const DB_DRIVER: DbDriver = (process.env.DB_TYPE ?? 'sqlite')
  .toLowerCase()
  .includes('postgres')
  ? 'postgres'
  : 'better-sqlite3';

/**
 * The two drivers share NO timestamp type: Postgres has `timestamptz` and no
 * `datetime`; SQLite has `datetime` and no `timestamp`/`timestamptz`.
 * Hard-coding either one silently breaks schema sync on the other, which is
 * exactly what happened when the entities declared `timestamptz` while
 * DB_TYPE was set to sqlite.
 */
export const DATE_COLUMN_TYPE = DB_DRIVER === 'postgres' ? 'timestamptz' : 'datetime';
