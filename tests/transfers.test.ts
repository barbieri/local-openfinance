import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/db/migrate.js';
import { lookupTransferGroup } from '../src/state/entry-attributes.js';
import { detectTransferGroups } from '../src/transfers/detect.js';

function seedTransferPair(db: DatabaseSync): { readonly outId: string; readonly inId: string } {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
     VALUES ('acct-checking', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
     VALUES ('acct-savings', 'item-1', 'BANK', 'Savings', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();

  const outId = 'tx-out';
  const inId = 'tx-in';
  db.prepare(
    `INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
    ) VALUES (?, 'acct-checking', '2026-06-10T10:00:00.000Z', -100000, 'BRL', 'Transfer out', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(outId);
  db.prepare(
    `INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
    ) VALUES (?, 'acct-savings', '2026-06-10T10:30:00.000Z', 100000, 'BRL', 'Transfer in', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(inId);

  return { outId, inId };
}

describe('transfer detection', () => {
  it('applies transfer migration and links opposite transactions', async () => {
    const db = new DatabaseSync(':memory:');
    expect(migrateDatabase(db)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
      27, 28, 29, 30, 31, 32, 33,
    ]);

    const { outId, inId } = seedTransferPair(db);
    const summary = await detectTransferGroups(db, {
      windowHours: 1,
      feeToleranceCents: 0,
      dryRun: false,
    });

    expect(summary.groupsCreated).toBe(1);
    expect(summary.membersLinked).toBe(2);
    expect(summary.proposed).toBe(1);
    expect(summary.skipped).toBe(0);

    const outGroup = lookupTransferGroup(db, 'transaction', outId);
    expect(outGroup?.kind).toBe('internal_transfer');
    expect(outGroup?.relatedEntryIds).toContain(inId);

    const { listEnrichedTransactions } = await import('../src/db/transaction-details.js');
    const enriched = listEnrichedTransactions(
      db,
      {
        status: 'all',
        accountIds: 'all',
        categoryIds: 'all',
        merchantPattern: null,
        paymentTypes: 'all',
        startDate: null,
        endDate: null,
      },
      'UTC',
    );
    const outRow = enriched.find((row) => row.id === outId);
    expect(outRow?.transfer_group?.related?.transaction_id).toBe(inId);
    expect(outRow?.transfer_group?.related?.description).toBe('Transfer in');
    expect(outRow?.transfer_group?.related?.amount_difference_cents).toBe(0);
  });

  it('ignores credit card transactions when detecting transfers', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const { outId } = seedTransferPair(db);

    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
       VALUES ('acct-card', 'item-1', 'CREDIT', 'Card', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
      ) VALUES ('tx-card', 'acct-card', '2026-06-10T10:15:00.000Z', 100000, 'BRL', 'Card in', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    const summary = await detectTransferGroups(db, {
      windowHours: 24,
      feeToleranceCents: 0,
      dryRun: false,
    });

    expect(summary.groupsCreated).toBe(1);
    expect(lookupTransferGroup(db, 'transaction', outId)?.relatedEntryIds).not.toContain('tx-card');
  });

  it('skips pairs rejected by confirmPair and tries the next candidate', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransferPair(db);

    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
       VALUES ('acct-other', 'item-1', 'BANK', 'Other', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
      ) VALUES ('tx-other', 'acct-other', '2026-06-10T10:15:00.000Z', 100000, 'BRL', 'Other in', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    let promptCount = 0;
    const summary = await detectTransferGroups(db, {
      windowHours: 1,
      feeToleranceCents: 0,
      dryRun: false,
      confirmPair: async () => {
        promptCount += 1;
        return promptCount > 1;
      },
    });

    expect(summary.proposed).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.groupsCreated).toBe(1);
  });
});
