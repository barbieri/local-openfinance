import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { backupBeforeDestructiveMigrations } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';

describe('database migration backup boundary', () => {
  it('backs up pre-migration entries before migration 034 adds soft-delete fields', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'local-openfinance-migration-backup-'));
    const databasePath = path.join(dir, 'openfinance.sqlite');
    const db = new DatabaseSync(databasePath);
    try {
      migrateDatabase(db);
      db.exec(`
        INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
        VALUES ('item-1', 'test', 'Test Bank', 'UPDATED', '{}', '2026-09-15T00:00:00.000Z');
        INSERT INTO accounts (
          id, connection_item_id, type, name, balance_cents, currency, raw_json, synced_at
        ) VALUES (
          'account-1', 'item-1', 'CHECKING', 'Checking', 10000, 'BRL', '{}', '2026-09-15T00:00:00.000Z'
        );
        INSERT INTO transactions (
          id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
        ) VALUES (
          'transaction-1', 'account-1', '2026-09-15T00:00:00.000Z', -100, 'BRL', 'Before migration', '{"source":"pre-migration"}', '2026-09-15T00:00:00.000Z'
        );
        INSERT INTO investments (
          id, connection_item_id, type, name, balance_cents, currency, raw_json, synced_at
        ) VALUES (
          'investment-1', 'item-1', 'FIXED_INCOME', 'Investment', 10000, 'BRL', '{"source":"pre-migration"}', '2026-09-15T00:00:00.000Z'
        );
        DROP INDEX idx_transactions_deleted_at;
        DROP INDEX idx_investments_deleted_at;
        ALTER TABLE transactions DROP COLUMN deleted_at;
        ALTER TABLE transactions DROP COLUMN delete_reason;
        ALTER TABLE investments DROP COLUMN deleted_at;
        ALTER TABLE investments DROP COLUMN delete_reason;
      `);
      db.prepare('DELETE FROM schema_migrations WHERE version = 34').run();

      const backupPath = backupBeforeDestructiveMigrations(db, databasePath);

      expect(backupPath).toMatch(/before-soft-delete-entries\.sqlite$/u);
      const backup = new DatabaseSync(backupPath ?? '', { readOnly: true });
      try {
        expect(
          backup.prepare("SELECT raw_json FROM transactions WHERE id = 'transaction-1'").get()?.[
            'raw_json'
          ],
        ).toBe('{"source":"pre-migration"}');
        expect(
          backup.prepare("SELECT raw_json FROM investments WHERE id = 'investment-1'").get()?.[
            'raw_json'
          ],
        ).toBe('{"source":"pre-migration"}');
      } finally {
        backup.close();
      }
      expect(migrateDatabase(db)).toEqual([34]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backs up legacy intelligence artifacts before migration 030 can delete them', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'local-openfinance-migration-backup-'));
    const databasePath = path.join(dir, 'openfinance.sqlite');
    const db = new DatabaseSync(databasePath);
    try {
      migrateDatabase(db);
      db.prepare(
        `INSERT INTO intelligence_memory (id, markdown, updated_at, updated_by)
         VALUES ('weekly', '# Legacy memory', '2026-08-27T00:00:00Z', 'user')`,
      ).run();
      db.prepare('DELETE FROM schema_migrations WHERE version = 30').run();

      const backupPath = backupBeforeDestructiveMigrations(db, databasePath);

      expect(backupPath).not.toBeNull();
      const backup = new DatabaseSync(backupPath ?? '', { readOnly: true });
      try {
        expect(
          backup.prepare("SELECT markdown FROM intelligence_memory WHERE id = 'weekly'").get()?.[
            'markdown'
          ],
        ).toBe('# Legacy memory');
      } finally {
        backup.close();
      }
      expect(migrateDatabase(db)).toEqual([30]);
      expect(db.prepare('SELECT COUNT(*) AS count FROM intelligence_memory').get()?.['count']).toBe(
        0,
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
