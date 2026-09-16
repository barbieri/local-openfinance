import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { softDeleteInvestment } from '../src/db/entry-deletion.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { buildNetWorthSnapshot } from '../src/intelligence/net-worth.js';

describe('net worth', () => {
  it('excludes deleted investments from the public report snapshot', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    db.prepare(
      `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
       VALUES ('item-1', '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO investments (
        id, connection_item_id, name, balance_cents, currency, raw_json, synced_at
      ) VALUES
        ('visible', 'item-1', 'Visible', 10000, 'BRL', '{}', '2026-06-10T00:00:00.000Z'),
        ('deleted', 'item-1', 'Deleted', 20000, 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    softDeleteInvestment(db, {
      investmentId: 'deleted',
      deletedAt: '2026-09-15T12:00:00.000Z',
    });

    expect(
      buildNetWorthSnapshot(db, 'weekly', { start: '2026-09-01', end: '2026-09-07' }, []),
    ).toMatchObject({
      currencies: [{ currency: 'BRL', investmentCents: 10000, netCents: 10000 }],
    });
  });
});
