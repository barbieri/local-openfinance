import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { backupBeforeDestructiveMigrations } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';

describe('database migration backup boundary', () => {
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
