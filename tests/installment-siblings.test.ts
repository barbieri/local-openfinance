import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  findFirstInstallmentTransactionId,
  getInstallmentPlanInfo,
  installmentAmountsMatch,
  listInstallmentSiblingTransactionIds,
} from '../src/db/installment-siblings.js';
import { migrateDatabase } from '../src/db/migrate.js';

function seedInstallmentTransaction(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly accountId: string;
    readonly merchantName: string;
    readonly installmentNumber: number;
    readonly totalInstallments: number;
    readonly amountCents?: number;
  },
): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', 'pluggy', 'Bank', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')
     ON CONFLICT(item_id) DO NOTHING`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, subtype, name, balance_cents, currency, raw_json, synced_at)
     VALUES (?, 'item-1', 'CREDIT', 'CREDIT_CARD', 'Card', 0, 'BRL', '{}', '2026-06-10T00:00:00.000Z')
     ON CONFLICT(id) DO NOTHING`,
  ).run(input.accountId);
  db.prepare(
    `INSERT INTO transactions (
       id, account_id, occurred_at, amount_cents, currency, description, merchant_name,
       payment_type, status, raw_json, synced_at
     ) VALUES (?, ?, '2026-06-01T12:00:00.000Z', ?, 'BRL', ?, ?, 'CREDIT_CARD', 'POSTED', ?, '2026-06-10T00:00:00.000Z')`,
  ).run(
    input.id,
    input.accountId,
    input.amountCents ?? -1000,
    input.merchantName,
    input.merchantName,
    JSON.stringify({
      creditCardMetadata: {
        installmentNumber: input.installmentNumber,
        totalInstallments: input.totalInstallments,
      },
    }),
  );
}

describe('installment siblings', () => {
  it('finds other installments with the same merchant plan on the same account', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedInstallmentTransaction(db, {
      id: 'tx-1',
      accountId: 'acc-1',
      merchantName: 'Store Purchase 01/03',
      installmentNumber: 1,
      totalInstallments: 3,
    });
    seedInstallmentTransaction(db, {
      id: 'tx-2',
      accountId: 'acc-1',
      merchantName: 'Store Purchase 02/03',
      installmentNumber: 2,
      totalInstallments: 3,
    });
    seedInstallmentTransaction(db, {
      id: 'tx-3',
      accountId: 'acc-1',
      merchantName: 'Store Purchase 03/03',
      installmentNumber: 3,
      totalInstallments: 3,
    });
    seedInstallmentTransaction(db, {
      id: 'tx-other',
      accountId: 'acc-1',
      merchantName: 'Other Shop 01/03',
      installmentNumber: 1,
      totalInstallments: 3,
    });

    const siblings = listInstallmentSiblingTransactionIds(db, 'tx-1');
    expect([...siblings].sort()).toEqual(['tx-2', 'tx-3']);

    const plan = getInstallmentPlanInfo(db, 'tx-2');
    expect(plan?.installmentNumber).toBe(2);
    expect(plan?.totalInstallments).toBe(3);
    expect([...(plan?.siblingIds ?? [])].sort()).toEqual(['tx-1', 'tx-3']);
  });

  it('returns empty siblings for non-installment transactions', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    db.prepare(
      `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
       VALUES ('item-1', 'pluggy', 'Bank', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')
     ON CONFLICT(item_id) DO NOTHING`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, subtype, name, balance_cents, currency, raw_json, synced_at)
       VALUES ('acc-1', 'item-1', 'BANK', 'CHECKING', 'Checking', 0, 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
         id, account_id, occurred_at, amount_cents, currency, description, merchant_name,
         payment_type, status, raw_json, synced_at
       ) VALUES ('tx-1', 'acc-1', '2026-06-01T12:00:00.000Z', -1000, 'BRL', 'Coffee', 'Coffee', 'DEBIT', 'POSTED', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    expect(getInstallmentPlanInfo(db, 'tx-1')).toBeNull();
    expect(listInstallmentSiblingTransactionIds(db, 'tx-1')).toEqual([]);
  });

  it('finds the first installment transaction id in a plan', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedInstallmentTransaction(db, {
      id: 'tx-1',
      accountId: 'acc-1',
      merchantName: 'Store Purchase 01/03',
      installmentNumber: 1,
      totalInstallments: 3,
    });
    seedInstallmentTransaction(db, {
      id: 'tx-2',
      accountId: 'acc-1',
      merchantName: 'Store Purchase 02/03',
      installmentNumber: 2,
      totalInstallments: 3,
    });

    expect(findFirstInstallmentTransactionId(db, 'tx-2')).toBe('tx-1');
    expect(findFirstInstallmentTransactionId(db, 'tx-1')).toBe('tx-1');
  });

  it('matches installment plans using merchant text resolved from raw_json', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    db.prepare(
      `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
       VALUES ('item-1', 'pluggy', 'Bank', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, subtype, name, balance_cents, currency, raw_json, synced_at)
       VALUES ('acc-1', 'item-1', 'CREDIT', 'CREDIT_CARD', 'Card', 0, 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    const insert = db.prepare(
      `INSERT INTO transactions (
         id, account_id, occurred_at, amount_cents, currency, description, merchant_name,
         payment_type, status, raw_json, synced_at
       ) VALUES (?, 'acc-1', '2026-06-01T12:00:00.000Z', -1000, 'BRL', NULL, NULL, 'CREDIT_CARD', 'POSTED', ?, '2026-06-10T00:00:00.000Z')`,
    );
    insert.run(
      'tx-1',
      JSON.stringify({
        description: 'Store Purchase 01/03',
        creditCardMetadata: { installmentNumber: 1, totalInstallments: 3 },
      }),
    );
    insert.run(
      'tx-2',
      JSON.stringify({
        description: 'Store Purchase 02/03',
        creditCardMetadata: { installmentNumber: 2, totalInstallments: 3 },
      }),
    );

    expect(findFirstInstallmentTransactionId(db, 'tx-2')).toBe('tx-1');
  });

  it('does not merge same-merchant installment plans with different amounts', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedInstallmentTransaction(db, {
      id: 'purchase-a-1',
      accountId: 'acc-1',
      merchantName: 'Store Purchase 01/03',
      installmentNumber: 1,
      totalInstallments: 3,
      amountCents: -1000,
    });
    seedInstallmentTransaction(db, {
      id: 'purchase-a-2',
      accountId: 'acc-1',
      merchantName: 'Store Purchase 02/03',
      installmentNumber: 2,
      totalInstallments: 3,
      amountCents: -1000,
    });
    seedInstallmentTransaction(db, {
      id: 'purchase-b-1',
      accountId: 'acc-1',
      merchantName: 'Store Purchase 01/03',
      installmentNumber: 1,
      totalInstallments: 3,
      amountCents: -2500,
    });
    seedInstallmentTransaction(db, {
      id: 'purchase-b-2',
      accountId: 'acc-1',
      merchantName: 'Store Purchase 02/03',
      installmentNumber: 2,
      totalInstallments: 3,
      amountCents: -2500,
    });

    expect(listInstallmentSiblingTransactionIds(db, 'purchase-a-2')).toEqual(['purchase-a-1']);
    expect(listInstallmentSiblingTransactionIds(db, 'purchase-b-2')).toEqual(['purchase-b-1']);
    expect(findFirstInstallmentTransactionId(db, 'purchase-a-2')).toBe('purchase-a-1');
    expect(findFirstInstallmentTransactionId(db, 'purchase-b-2')).toBe('purchase-b-1');
  });

  it('allows one-cent rounding differences between installment amounts', () => {
    expect(installmentAmountsMatch(-1000, -1001)).toBe(true);
    expect(installmentAmountsMatch(-1000, -1002)).toBe(false);

    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedInstallmentTransaction(db, {
      id: 'tx-1',
      accountId: 'acc-1',
      merchantName: 'Store Purchase 01/02',
      installmentNumber: 1,
      totalInstallments: 2,
      amountCents: -1000,
    });
    seedInstallmentTransaction(db, {
      id: 'tx-2',
      accountId: 'acc-1',
      merchantName: 'Store Purchase 02/02',
      installmentNumber: 2,
      totalInstallments: 2,
      amountCents: -1001,
    });

    expect(listInstallmentSiblingTransactionIds(db, 'tx-2')).toEqual(['tx-1']);
  });
});
