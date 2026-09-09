import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  findSuggestedDuplicateGroups,
  getAliasAccountIds,
  isMergedAlias,
  linkAccounts,
  listLinkedAccountGroups,
  resolveAccountIdentity,
  resolveCanonicalAccountId,
  unlinkAccountAlias,
} from '../src/db/account-links.js';
import {
  accountsEntity,
  creditCardBillsEntity,
  creditCardsEntity,
  transactionsEntity,
} from '../src/db/list/entities.js';
import { runListQuery } from '../src/db/list/query.js';
import { migrateDatabase } from '../src/db/migrate.js';

function seedAccount(
  db: DatabaseSync,
  id: string,
  connectionItemId: string,
  type: 'CREDIT' | 'BANK' = 'CREDIT',
  rawJson: Record<string, unknown> = {},
): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES (?, '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')
     ON CONFLICT(item_id) DO NOTHING`,
  ).run(connectionItemId);
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, subtype, name, currency, raw_json, synced_at)
     VALUES (?, ?, ?, 'CHECKING_ACCOUNT', 'Same Card', 'BRL', ?, '2026-06-10T00:00:00.000Z')`,
  ).run(id, connectionItemId, type, JSON.stringify(rawJson));
}

function seedTransaction(db: DatabaseSync, id: string, accountId: string): void {
  db.prepare(
    `INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
    ) VALUES (?, ?, '2026-06-09T12:00:00.000Z', -1000, 'BRL', ?, '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(id, accountId, `tx-${id}`);
}

describe('account links', () => {
  it('applies migration 005', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrateDatabase(db)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
      27, 28, 29, 30, 31, 32, 33,
    ]);
  });

  it('links duplicate accounts and hides aliases from list queries', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedAccount(db, 'canonical', 'conn-1');
    seedAccount(db, 'alias-a', 'conn-2');
    seedAccount(db, 'alias-b', 'conn-3');
    seedTransaction(db, 'tx-canonical', 'canonical');
    seedTransaction(db, 'tx-alias-a', 'alias-a');
    seedTransaction(db, 'tx-alias-b', 'alias-b');

    linkAccounts(db, 'canonical', ['alias-a', 'alias-b']);

    expect(getAliasAccountIds(db, 'canonical')).toEqual(['alias-a', 'alias-b']);
    expect(isMergedAlias(db, 'alias-a')).toBe(true);
    expect(resolveCanonicalAccountId(db, 'alias-a')).toBe('canonical');

    expect(
      runListQuery(db, { entity: accountsEntity, filters: [], limit: 10, offset: 0 }).total,
    ).toBe(1);
    expect(
      runListQuery(db, { entity: creditCardsEntity, filters: [], limit: 10, offset: 0 }).total,
    ).toBe(1);
    expect(
      runListQuery(db, { entity: transactionsEntity, filters: [], limit: 10, offset: 0 }).total,
    ).toBe(1);
    expect(
      runListQuery(db, {
        entity: creditCardBillsEntity,
        filters: [],
        limit: 10,
        offset: 0,
      }).total,
    ).toBe(0);
  });

  it('detects duplicate accounts by type, subtype, and transfer number', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    const transferNumber = '001/1234/56789-0';
    seedAccount(db, 'acc-1', 'conn-1', 'BANK', {
      bankData: { transferNumber },
    });
    seedAccount(db, 'acc-2', 'conn-2', 'BANK', {
      bankData: { transferNumber },
    });

    const suggestions = findSuggestedDuplicateGroups(db);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.accounts.map((account) => account.id)).toEqual(['acc-1', 'acc-2']);
  });

  it('skips duplicate groups that are already fully linked', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    const transferNumber = '001/1234/56789-0';
    seedAccount(db, 'acc-1', 'conn-1', 'BANK', { bankData: { transferNumber } });
    seedAccount(db, 'acc-2', 'conn-2', 'BANK', { bankData: { transferNumber } });
    linkAccounts(db, 'acc-1', ['acc-2']);

    expect(findSuggestedDuplicateGroups(db)).toHaveLength(0);
    expect(listLinkedAccountGroups(db)).toHaveLength(1);
  });

  it('parses transfer numbers from account raw_json', () => {
    expect(
      resolveAccountIdentity(
        'BANK',
        'CHECKING_ACCOUNT',
        JSON.stringify({
          bankData: { transferNumber: '001/1234/56789-0' },
        }),
      ),
    ).toEqual({
      type: 'BANK',
      subtype: 'CHECKING_ACCOUNT',
      transferNumber: '001/1234/56789-0',
      name: null,
      number: null,
    });
  });

  it('unlinks a single alias and restores visibility', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedAccount(db, 'canonical', 'conn-1');
    seedAccount(db, 'alias-a', 'conn-2');
    linkAccounts(db, 'canonical', ['alias-a']);

    expect(unlinkAccountAlias(db, 'alias-a')).toBe(true);
    expect(isMergedAlias(db, 'alias-a')).toBe(false);
    expect(
      runListQuery(db, { entity: accountsEntity, filters: [], limit: 10, offset: 0 }).total,
    ).toBe(2);
  });
});
