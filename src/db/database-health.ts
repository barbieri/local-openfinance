import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const FTS_TABLES = ['transactions_fts', 'annotation_notes_fts'] as const;

export class DatabaseCorruptionError extends Error {
  readonly databasePath: string;
  readonly details: string;

  constructor(databasePath: string, details: string) {
    super(formatDatabaseCorruptionMessage(databasePath, details));
    this.name = 'DatabaseCorruptionError';
    this.databasePath = databasePath;
    this.details = details;
  }
}

export function configureDatabase(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
}

export function readQuickCheckResult(db: DatabaseSync): string {
  const row = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
  if (!row) {
    return 'unknown';
  }

  return String(Object.values(row)[0] ?? 'unknown');
}

export function assertDatabaseHealthy(db: DatabaseSync, databasePath: string): void {
  const result = readQuickCheckResult(db);
  if (result === 'ok') {
    return;
  }

  throw new DatabaseCorruptionError(databasePath, result);
}

export function rebuildFtsIndexes(db: DatabaseSync): readonly string[] {
  const rebuilt: string[] = [];

  for (const table of FTS_TABLES) {
    if (!ftsTableExists(db, table)) {
      continue;
    }

    db.exec(`INSERT INTO ${table}(${table}) VALUES ('rebuild')`);
    rebuilt.push(table);
  }

  return rebuilt;
}

export function vacuumDatabase(db: DatabaseSync): void {
  db.exec('VACUUM');
}

export function backupDatabase(db: DatabaseSync, destinationPath: string): void {
  const resolvedPath = path.resolve(destinationPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const escapedPath = resolvedPath.replaceAll("'", "''");
  db.exec(`VACUUM INTO '${escapedPath}'`);
}

export function formatDatabaseCorruptionMessage(databasePath: string, details: string): string {
  return [
    `SQLite database is corrupted (${details}).`,
    `Path: ${databasePath}`,
    'Try:',
    `  pnpm run local-openfinance check-database --config <config> --repair`,
    'If repair fails, back up annotations/state if needed, remove the database file, and run sync again.',
  ].join('\n');
}

function ftsTableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);

  return row !== undefined;
}
