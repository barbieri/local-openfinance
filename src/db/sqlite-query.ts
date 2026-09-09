import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { logger } from '../logger.js';

export class SqliteQueryError extends Error {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly sqliteCode: string | undefined;

  constructor(sql: string, params: readonly unknown[], cause: unknown) {
    const sqliteMessage = cause instanceof Error ? cause.message : String(cause);
    const sqliteCode = readSqliteCode(cause);
    super(sqliteMessage);
    this.name = 'SqliteQueryError';
    this.sql = sql;
    this.params = params;
    this.sqliteCode = sqliteCode;
  }
}

function readSqliteCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

export function isSqliteQueryError(error: unknown): error is SqliteQueryError {
  return error instanceof SqliteQueryError;
}

export function isNodeSqliteError(error: unknown): error is Error & { code?: string } {
  return (
    error instanceof Error &&
    typeof (error as { code?: string }).code === 'string' &&
    (error as { code?: string }).code?.startsWith('ERR_SQLITE_') === true
  );
}

export function logSqliteQueryError(error: SqliteQueryError): void {
  logger.error(
    {
      err: error,
      sql: error.sql,
      params: error.params,
      sqliteCode: error.sqliteCode,
    },
    'sqlite query failed',
  );
}

export function formatSqliteUserMessage(error: unknown): string {
  const message =
    error instanceof SqliteQueryError || error instanceof Error ? error.message : String(error);

  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return 'Database constraint failed: referenced record does not exist.';
  }
  if (/UNIQUE constraint failed/i.test(message)) {
    const match = message.match(/UNIQUE constraint failed: (\S+)/i);
    return match
      ? `Database constraint failed: duplicate value (${match[1]}).`
      : 'Database constraint failed: duplicate value.';
  }
  if (/NOT NULL constraint failed/i.test(message)) {
    const match = message.match(/NOT NULL constraint failed: (\S+)/i);
    return match
      ? `Database constraint failed: ${match[1]} is required.`
      : 'Database constraint failed: required value is missing.';
  }
  if (/CHECK constraint failed/i.test(message)) {
    return 'Database constraint failed: invalid value.';
  }

  return message;
}

function wrapSqliteError(sql: string, params: readonly unknown[], error: unknown): never {
  const wrapped = new SqliteQueryError(sql, params, error);
  logSqliteQueryError(wrapped);
  throw wrapped;
}

export function runSql(db: DatabaseSync, sql: string, ...params: SQLInputValue[]) {
  try {
    return db.prepare(sql).run(...params);
  } catch (error) {
    wrapSqliteError(sql, params, error);
  }
}

export function getSql<T>(
  db: DatabaseSync,
  sql: string,
  ...params: SQLInputValue[]
): T | undefined {
  try {
    return db.prepare(sql).get(...params) as T | undefined;
  } catch (error) {
    wrapSqliteError(sql, params, error);
  }
}

export function allSql<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  try {
    return db.prepare(sql).all(...params) as T[];
  } catch (error) {
    wrapSqliteError(sql, params, error);
  }
}
