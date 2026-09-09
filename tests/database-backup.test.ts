import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  createDatedBackup,
  defaultBackupDir,
  parseDatedBackupFileName,
  pruneDatedBackups,
} from '../src/db/database-backup.js';
import { migrateDatabase } from '../src/db/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('dated database backups', () => {
  it('places backups beside the database using the file stem', () => {
    expect(defaultBackupDir('/data/openfinance.sqlite')).toBe(
      path.join('/data', 'openfinance-backups'),
    );
  });

  it('parses only backups that match the database stem and local date', () => {
    const databasePath = '/data/openfinance.sqlite';
    expect(parseDatedBackupFileName('openfinance-2026-08-17.sqlite', databasePath)).toEqual({
      dateKey: '2026-08-17',
    });
    expect(parseDatedBackupFileName('other-2026-08-17.sqlite', databasePath)).toBeNull();
    expect(parseDatedBackupFileName('openfinance-2026-08-17.sqlite-wal', databasePath)).toBeNull();
    expect(parseDatedBackupFileName('notes.txt', databasePath)).toBeNull();
  });

  it('shifts calendar dates without timezone conversion', () => {
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addCalendarDays('2026-08-17', -30)).toBe('2026-07-18');
  });

  it('writes a restorable VACUUM INTO copy and overwrites the same local day', () => {
    const dir = createTempDir();
    const databasePath = path.join(dir, 'openfinance.sqlite');
    const db = openMigratedDatabase(databasePath);
    insertConnection(db, 'item-1');

    const first = createDatedBackup({
      db,
      databasePath,
      today: '2026-08-17',
    });
    expect(first.backupPath).toBe(
      path.join(dir, 'openfinance-backups', 'openfinance-2026-08-17.sqlite'),
    );
    expect(readConnectionIds(first.backupPath)).toEqual(['item-1']);

    insertConnection(db, 'item-2');
    const second = createDatedBackup({
      db,
      databasePath,
      today: '2026-08-17',
    });
    expect(second.backupPath).toBe(first.backupPath);
    expect(readConnectionIds(second.backupPath)).toEqual(['item-1', 'item-2']);
    expect(existsSync(`${first.backupPath}.${process.pid}.tmp`)).toBe(false);

    db.close();
  });

  it('deletes dated backups older than the retention window and leaves other files alone', () => {
    const dir = createTempDir();
    const databasePath = path.join(dir, 'openfinance.sqlite');
    const backupDir = path.join(dir, 'openfinance-backups');
    mkdirSync(backupDir);

    const keep = path.join(backupDir, 'openfinance-2026-07-18.sqlite');
    const drop = path.join(backupDir, 'openfinance-2026-07-17.sqlite');
    const other = path.join(backupDir, 'readme.txt');
    writeFileSync(keep, 'keep');
    writeFileSync(drop, 'drop');
    writeFileSync(other, 'notes');

    expect(
      pruneDatedBackups({
        databasePath,
        backupDir,
        keepDays: 30,
        today: '2026-08-17',
      }),
    ).toEqual([drop]);

    expect(existsSync(keep)).toBe(true);
    expect(existsSync(drop)).toBe(false);
    expect(readFileSync(other, 'utf8')).toBe('notes');
  });
});

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lof-backup-'));
  tempDirs.push(dir);
  return dir;
}

function openMigratedDatabase(databasePath: string): DatabaseSync {
  const db = new DatabaseSync(databasePath);
  migrateDatabase(db);
  return db;
}

function insertConnection(db: DatabaseSync, itemId: string): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES (?, '601', 'Itau', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(itemId);
}

function readConnectionIds(databasePath: string): readonly string[] {
  const db = new DatabaseSync(databasePath);
  try {
    const rows = db.prepare('SELECT item_id FROM connections ORDER BY item_id').all() as {
      readonly item_id: string;
    }[];
    return rows.map((row) => row.item_id);
  } finally {
    db.close();
  }
}
