import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { readQuickCheckResult, rebuildFtsIndexes } from '../src/db/database-health.js';
import { migrateDatabase } from '../src/db/migrate.js';

describe('database health', () => {
  it('reports ok for migrated databases', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    expect(readQuickCheckResult(db)).toBe('ok');
    expect(rebuildFtsIndexes(db)).toEqual(['transactions_fts', 'annotation_notes_fts']);
    expect(readQuickCheckResult(db)).toBe('ok');
  });

  it('rebuilds transactions fts after migration 006 recreates the content table', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    db.prepare(
      `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
       VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (
        id, connection_item_id, type, name, currency, raw_json, synced_at
      ) VALUES ('acc-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
      ) VALUES ('tx-1', 'acc-1', '2026-06-10T12:00:00.000Z', -1000, 'BRL', 'Coffee', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    rebuildFtsIndexes(db);

    const ftsCount = db.prepare('SELECT COUNT(*) AS total FROM transactions_fts').get() as {
      readonly total: number;
    };
    expect(ftsCount.total).toBe(1);
  });
});
