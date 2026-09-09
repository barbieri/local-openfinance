import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  deleteAccountLabel,
  getAccountLabel,
  listLabelableAccounts,
  upsertAccountLabel,
} from '../src/db/account-labels.js';
import {
  enrichListRows,
  resolveAccountDisplayName,
  resolveConnectionDisplayName,
} from '../src/db/connection-labels.js';
import { accountsEntity } from '../src/db/list/entities.js';
import { migrateDatabase } from '../src/db/migrate.js';

function seedBankAccount(db: DatabaseSync, accountId: string, itemId: string): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES (?, '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(itemId);
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
     VALUES (?, ?, 'BANK', 'UPSTREAM NAME', 'BRL', ?, '2026-06-10T00:00:00.000Z')`,
  ).run(accountId, itemId, JSON.stringify({ bankData: { transferNumber: '341/1234/56789-0' } }));
}

describe('account labels', () => {
  it('applies migration and prefers manual account display names', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrateDatabase(db)).toContain(8);

    seedBankAccount(db, 'acct-1', 'item-1');
    expect(resolveAccountDisplayName(db, 'acct-1')).toBe('341/1234/56789-0');

    upsertAccountLabel(db, 'acct-1', 'Checking · Personal');
    expect(getAccountLabel(db, 'acct-1')?.name).toBe('Checking · Personal');
    expect(resolveAccountDisplayName(db, 'acct-1')).toBe('Checking · Personal');

    const [row] = enrichListRows(db, accountsEntity.name, [
      {
        id: 'acct-1',
        connection_item_id: 'item-1',
        type: 'BANK',
        name: 'UPSTREAM NAME',
        currency: 'BRL',
        raw_json: JSON.stringify({ bankData: { transferNumber: '341/1234/56789-0' } }),
        synced_at: '2026-06-10T00:00:00.000Z',
      },
    ]);

    expect(row?.['display_name']).toBe('Checking · Personal');
  });

  it('includes labeled accounts in connection display names', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBankAccount(db, 'acct-1', 'item-1');

    upsertAccountLabel(db, 'acct-1', 'Main checking');
    expect(resolveConnectionDisplayName(db, 'item-1')).toBe('Main checking');
  });

  it('lists account subtype for label-account selection', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    db.prepare(
      `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
       VALUES ('item-1', '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, subtype, name, currency, raw_json, synced_at)
       VALUES ('checking-1', 'item-1', 'BANK', 'CHECKING_ACCOUNT', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, subtype, name, currency, raw_json, synced_at)
       VALUES ('savings-1', 'item-1', 'BANK', 'SAVINGS_ACCOUNT', 'Savings', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    const accounts = listLabelableAccounts(db);
    expect(accounts.map((account) => [account.id, account.subtype])).toEqual([
      ['checking-1', 'CHECKING_ACCOUNT'],
      ['savings-1', 'SAVINGS_ACCOUNT'],
    ]);
  });

  it('removes manual labels with deleteAccountLabel', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBankAccount(db, 'acct-1', 'item-1');

    upsertAccountLabel(db, 'acct-1', 'Main checking');
    expect(deleteAccountLabel(db, 'acct-1')).toBe(true);
    expect(getAccountLabel(db, 'acct-1')).toBeNull();
    expect(resolveAccountDisplayName(db, 'acct-1')).toBe('341/1234/56789-0');
  });
});
