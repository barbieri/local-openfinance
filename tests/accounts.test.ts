import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { upsertAccountLabel } from '../src/db/account-labels.js';
import { listEnrichedAccounts, parseAccountGroupBy } from '../src/db/account-list-details.js';
import {
  formatAccountDetailsPlain,
  renderAccountsTree,
  serializeAccountForJson,
} from '../src/db/accounts/present.js';
import { migrateDatabase } from '../src/db/migrate.js';

function seedAccount(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly itemId: string;
    readonly type: string;
    readonly subtype?: string | undefined;
    readonly name: string;
    readonly balanceCents?: number | undefined;
    readonly rawJson: Record<string, unknown>;
    readonly number?: string | undefined;
  },
): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES (?, '341', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')
     ON CONFLICT(item_id) DO NOTHING`,
  ).run(input.itemId);

  db.prepare(
    `INSERT INTO accounts (
      id, connection_item_id, type, subtype, name, number, balance_cents, currency, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'BRL', ?, '2026-06-10T00:00:00.000Z')`,
  ).run(
    input.id,
    input.itemId,
    input.type,
    input.subtype ?? null,
    input.name,
    input.number ?? null,
    input.balanceCents ?? null,
    JSON.stringify(input.rawJson),
  );
}

describe('account list details', () => {
  it('defaults group-by to account, type, and subtype', () => {
    expect(parseAccountGroupBy(undefined)).toEqual(['account', 'type', 'subtype']);
  });

  it('renders display name, type/subtype, branch/account, and balance prominently', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedAccount(db, {
      id: 'bank-1',
      itemId: 'item-1',
      type: 'BANK',
      subtype: 'CHECKING_ACCOUNT',
      name: 'Checking',
      balanceCents: 123456,
      rawJson: {
        bankData: { transferNumber: '341/1234/56789-0' },
      },
    });

    seedAccount(db, {
      id: 'card-1',
      itemId: 'item-1',
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      name: 'Platinum Card',
      balanceCents: -150000,
      number: '************3725',
      rawJson: {
        creditData: {
          brand: 'MASTERCARD',
          level: 'PLATINUM',
        },
      },
    });

    upsertAccountLabel(db, 'bank-1', 'Checking · Personal');

    const { accounts } = listEnrichedAccounts(db, { limit: 10, offset: 0 });
    const output = renderAccountsTree(accounts, parseAccountGroupBy(undefined));

    expect(output).toContain('Itaú');
    expect(output).toContain('Checking · Personal');
    expect(output).toContain('BANK');
    expect(output).toContain('CHECKING_ACCOUNT');
    expect(output).toContain('ag 1234');
    expect(output).toContain('cc 56789-0');
    expect(output).toContain('R$\u00a01.234,56');
    expect(output).toContain('MASTERCARD (3725)');
    expect(output).toContain('CREDIT');
    expect(output).toContain('card ****3725');
    expect(output).toContain('-R$\u00a01.500,00');

    const card = accounts.find((account) => account.id === 'card-1');
    expect(card).toBeDefined();
    if (!card) {
      throw new Error('expected seeded credit card');
    }
    expect(formatAccountDetailsPlain(card)).toBe('MASTERCARD PLATINUM 3725');
  });

  it('serializes db, parsed, and raw_json sections for debugging', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedAccount(db, {
      id: 'bank-1',
      itemId: 'item-1',
      type: 'BANK',
      subtype: 'CHECKING_ACCOUNT',
      name: 'Checking',
      balanceCents: 123456,
      rawJson: {
        bankData: { transferNumber: '341/1234/56789-0' },
      },
    });

    const { accounts } = listEnrichedAccounts(db, { limit: 10, offset: 0 });
    const [account] = accounts;
    if (!account) {
      throw new Error('expected seeded account');
    }

    const json = serializeAccountForJson(account);
    expect(json['db']).toMatchObject({
      id: 'bank-1',
      type: 'BANK',
      subtype: 'CHECKING_ACCOUNT',
      balance_cents: 123456,
    });
    expect(json['parsed']).toMatchObject({
      display_name: '341/1234/56789-0',
      branch: '1234',
      account: '56789-0',
      transfer_number: '341/1234/56789-0',
    });
  });
});
