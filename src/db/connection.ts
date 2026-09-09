import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ResolvedConfig } from '../types.js';
import {
  assertDatabaseHealthy,
  backupDatabase,
  configureDatabase,
  DatabaseCorruptionError,
  rebuildFtsIndexes,
} from './database-health.js';
import { adoptLegacyIntelligenceReport } from './intelligence.js';
import { migrateDatabase } from './migrate.js';
import { backfillTransactionDocumentKeys } from './transaction-document-keys.js';

export type OpenDatabaseResult = {
  readonly db: DatabaseSync;
  readonly databasePath: string;
  readonly appliedMigrations: readonly number[];
  readonly migrationBackupPath: string | null;
};

export type OpenDatabaseOptions = {
  readonly skipHealthCheck?: boolean | undefined;
};

export function openDatabase(
  resolved: ResolvedConfig,
  options: OpenDatabaseOptions = {},
): OpenDatabaseResult {
  return openDatabaseAtPath(
    resolved.config.storage.databasePath,
    resolved.config.reports.map((report) => report.id),
    options,
  );
}

export function openDatabaseReadWrite(
  resolved: ResolvedConfig,
  options: OpenDatabaseOptions = {},
): OpenDatabaseResult {
  return openDatabase(resolved, options);
}

function openDatabaseAtPath(
  databasePath: string,
  configuredReportIds: readonly string[],
  options: OpenDatabaseOptions,
): OpenDatabaseResult {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const databaseExisted = existsSync(databasePath);

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(databasePath);
    configureDatabase(db);
  } catch (error) {
    throw wrapOpenFailure(databasePath, error);
  }

  try {
    if (!options.skipHealthCheck) {
      assertDatabaseHealthy(db, databasePath);
    }

    const migrationBackupPath = databaseExisted
      ? backupBeforeDestructiveMigrations(db, databasePath)
      : null;
    const appliedMigrations = migrateDatabase(db);
    adoptLegacyIntelligenceReport(db, configuredReportIds);
    // Populate CPF/CNPJ peer keys for cascade assist matching (idempotent).
    backfillTransactionDocumentKeys(db);
    rebuildFtsIndexes(db);

    if (!options.skipHealthCheck) {
      assertDatabaseHealthy(db, databasePath);
    }

    return { db, databasePath, appliedMigrations, migrationBackupPath };
  } catch (error) {
    try {
      db.close();
    } catch {
      // ignore close errors while handling the original failure
    }

    if (error instanceof DatabaseCorruptionError) {
      throw error;
    }

    throw wrapOpenFailure(databasePath, error);
  }
}

export function backupBeforeDestructiveMigrations(
  db: DatabaseSync,
  databasePath: string,
): string | null {
  if (
    databasePath === ':memory:' ||
    !tableExists(db, 'schema_migrations') ||
    migrationApplied(db, 30) ||
    !hasLegacyIntelligenceArtifacts(db)
  ) {
    return null;
  }
  const stamp = new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/gu, '')
    .slice(0, 17);
  const backupPath = `${databasePath}.${stamp}-${process.pid}-before-reset-legacy-intelligence.sqlite`;
  backupDatabase(db, backupPath);
  return backupPath;
}

function migrationApplied(db: DatabaseSync, version: number): boolean {
  return Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version));
}

function hasLegacyIntelligenceArtifacts(db: DatabaseSync): boolean {
  for (const table of [
    'intelligence_memory',
    'intelligence_runs',
    'intelligence_run_charts',
    'intelligence_chats',
  ]) {
    if (!tableExists(db, table)) continue;
    const row = db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    if (row) return true;
  }
  return false;
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName),
  );
}

function wrapOpenFailure(databasePath: string, error: unknown): Error {
  if (error instanceof DatabaseCorruptionError) {
    return error;
  }

  if (isSqliteCorruptionError(error)) {
    return new DatabaseCorruptionError(databasePath, error.message);
  }

  return error instanceof Error ? error : new Error(String(error));
}

function isSqliteCorruptionError(error: unknown): error is Error & { code?: string } {
  if (!(error instanceof Error)) {
    return false;
  }

  const record = error as Error & { code?: string; errcode?: number };
  return (
    record.code === 'ERR_SQLITE_ERROR' &&
    (record.message.includes('malformed') ||
      record.message.includes('corrupt') ||
      record.errcode === 267 ||
      record.errcode === 11)
  );
}
