import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  enrichListRows,
  formatConnectionRecentTransactions,
  listConnectionRecentTransactions,
  resolveAccountDisplayName,
  resolveConnectionDisplayName,
  upsertConnectionLabel,
} from '../src/db/connection-labels.js';
import { connectionsEntity } from '../src/db/list/entities.js';
import { migrateDatabase } from '../src/db/migrate.js';

function seedConnection(db: DatabaseSync, itemId: string): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES (?, '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(itemId);
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
     VALUES ('acct-1', ?, 'BANK', 'UPSTREAM NAME', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(itemId);
}

describe('connection labels', () => {
  it('applies migration and prefers manual display names', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrateDatabase(db)).toContain(5);

    seedConnection(db, 'item-1');
    upsertConnectionLabel(db, 'item-1', {
      branch: '1234',
      account: '56789-0',
      name: 'Itaú Personal',
    });

    expect(resolveConnectionDisplayName(db, 'item-1')).toBe('Itaú Personal · ag 1234 · cc 56789-0');
    expect(resolveAccountDisplayName(db, 'acct-1')).toBe('UPSTREAM NAME');

    const [row] = enrichListRows(db, connectionsEntity.name, [
      {
        item_id: 'item-1',
        connector_id: '601',
        connector_name: 'Itaú',
        status: 'UPDATED',
        synced_at: '2026-06-10T00:00:00.000Z',
      },
    ]);

    expect(row?.['display_name']).toBe('Itaú Personal · ag 1234 · cc 56789-0');
    expect(row?.['connector_name']).toBe('Itaú Personal');
  });

  it('keeps credit card account names independent of connection labels', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    db.prepare(
      `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
       VALUES ('item-1', '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, name, number, currency, raw_json, synced_at)
       VALUES (
         'card-1', 'item-1', 'CREDIT', 'Gold Card', '************3725', 'BRL',
         ?, '2026-06-10T00:00:00.000Z'
       )`,
    ).run(
      JSON.stringify({
        creditData: { brand: 'MASTERCARD', level: 'PLATINUM' },
      }),
    );

    upsertConnectionLabel(db, 'item-1', {
      branch: '3214',
      account: '109358-4',
      name: 'SOLID',
    });

    expect(resolveConnectionDisplayName(db, 'item-1')).toBe('SOLID · ag 3214 · cc 109358-4');
    expect(resolveAccountDisplayName(db, 'card-1')).toBe('MASTERCARD (3725)');
  });

  it('lists recent transactions for a connection newest first', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedConnection(db, 'item-1');

    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
      ) VALUES ('tx-old', 'acct-1', '2026-06-08T10:00:00.000Z', -1000, 'BRL', 'Older purchase', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
      ) VALUES ('tx-new', 'acct-1', '2026-06-10T12:00:00.000Z', -2500, 'BRL', 'Latest coffee', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    const recent = listConnectionRecentTransactions(db, 'item-1', 2);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.description).toBe('Latest coffee');
    expect(formatConnectionRecentTransactions(recent)).toContain('Latest coffee');
  });
});
