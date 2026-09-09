import { existsSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { backupDatabase } from './database-health.js';

export const DEFAULT_BACKUP_KEEP_DAYS = 30;

export type CreateDatedBackupOptions = {
  readonly db: DatabaseSync;
  readonly databasePath: string;
  readonly backupDir?: string | undefined;
  readonly today: string;
};

export type CreateDatedBackupResult = {
  readonly backupDir: string;
  readonly backupPath: string;
};

export type PruneDatedBackupsOptions = {
  readonly databasePath: string;
  readonly backupDir: string;
  readonly keepDays: number;
  readonly today: string;
};

export function defaultBackupDir(databasePath: string): string {
  const fileName = path.basename(databasePath);
  const stem = path.basename(fileName, path.extname(fileName));
  return path.join(path.dirname(databasePath), `${stem}-backups`);
}

export function datedBackupFileName(databasePath: string, dateKey: string): string {
  if (!isLocalDateKey(dateKey)) {
    throw new Error(`Invalid backup date: ${dateKey}`);
  }
  const fileName = path.basename(databasePath);
  const stem = path.basename(fileName, path.extname(fileName));
  return `${stem}-${dateKey}.sqlite`;
}

export function parseDatedBackupFileName(
  fileName: string,
  databasePath: string,
): { readonly dateKey: string } | null {
  if (fileName !== path.basename(fileName)) {
    return null;
  }
  const stem = escapeRegExp(path.basename(databasePath, path.extname(databasePath)));
  const match = new RegExp(`^${stem}-(\\d{4}-\\d{2}-\\d{2})\\.sqlite$`, 'u').exec(fileName);
  const dateKey = match?.[1];
  return dateKey === undefined ? null : { dateKey };
}

export function addCalendarDays(dateKey: string, days: number): string {
  const [yearText, monthText, dayText] = dateKey.split('-');
  const shifted = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText) + days),
  );

  return [
    String(shifted.getUTCFullYear()).padStart(4, '0'),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function createDatedBackup(options: CreateDatedBackupOptions): CreateDatedBackupResult {
  const backupDir = path.resolve(options.backupDir ?? defaultBackupDir(options.databasePath));
  const backupPath = resolveInsideDir(
    backupDir,
    datedBackupFileName(options.databasePath, options.today),
  );
  const tempPath = `${backupPath}.${process.pid}.tmp`;

  try {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    backupDatabase(options.db, tempPath);
    renameSync(tempPath, backupPath);
  } catch (error) {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw error;
  }

  return { backupDir, backupPath };
}

export function pruneDatedBackups(options: PruneDatedBackupsOptions): readonly string[] {
  if (options.keepDays < 1) {
    throw new Error('--keep-days must be at least 1');
  }
  if (!existsSync(options.backupDir)) {
    return [];
  }

  const cutoff = addCalendarDays(options.today, -options.keepDays);
  const pruned: string[] = [];

  for (const fileName of readdirSync(options.backupDir)) {
    const parsed = parseDatedBackupFileName(fileName, options.databasePath);
    if (!parsed || parsed.dateKey >= cutoff) {
      continue;
    }

    const fullPath = resolveInsideDir(options.backupDir, fileName);
    unlinkSync(fullPath);
    pruned.push(fullPath);
  }

  pruned.sort();
  return pruned;
}

function isLocalDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function resolveInsideDir(dir: string, fileName: string): string {
  const resolvedDir = path.resolve(dir);
  const resolvedFile = path.resolve(resolvedDir, path.basename(fileName));
  if (resolvedFile === resolvedDir || !resolvedFile.startsWith(`${resolvedDir}${path.sep}`)) {
    throw new Error(`Refusing to use backup path outside ${resolvedDir}`);
  }
  return resolvedFile;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
