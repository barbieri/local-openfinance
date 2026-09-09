import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  canChangeCreditCardBillLink,
  loadCreditCardBillLink,
  setManualCreditCardBillLink,
  syncCreditCardBillLinksForAccount,
} from '../src/db/credit-card-bill-links.js';
import { migrateDatabase } from '../src/db/migrate.js';

function seedCreditCardFixture(db: DatabaseSync): {
  readonly accountId: string;
  readonly billId: string;
  readonly transactionId: string;
} {
  const accountId = 'card-1';
  const billId = 'bill-1';
  const transactionId = 'tx-1';

  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();

  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, number, currency, raw_json, synced_at)
     VALUES (?, 'item-1', 'CREDIT', 'Card', '****1234', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(accountId);

  db.prepare(
    `INSERT INTO credit_card_bills (
      id, account_id, due_date, total_amount_cents, minimum_payment_cents, payment_status, currency, raw_json, synced_at
    ) VALUES (?, ?, '2026-06-15', 10000, 500, 'OPEN', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(billId, accountId);

  return { accountId, billId, transactionId };
}

describe('credit card bill links', () => {
  it('links transactions from metadata billId on sync', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const { accountId, billId, transactionId } = seedCreditCardFixture(db);

    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, amount_in_account_currency_cents,
        currency, description, raw_json, synced_at
      ) VALUES (?, ?, '2026-05-20T10:00:00.000Z', -5000, -5000, 'BRL', 'Store', ?, '2026-06-10T00:00:00.000Z')`,
    ).run(transactionId, accountId, JSON.stringify({ creditCardMetadata: { billId } }));

    const result = syncCreditCardBillLinksForAccount(db, accountId, '2026-06-10T00:00:00.000Z');
    expect(result.metadata).toBe(1);

    const link = loadCreditCardBillLink(db, transactionId);
    expect(link?.bill_id).toBe(billId);
    expect(link?.source).toBe('transaction_metadata');
    expect(
      canChangeCreditCardBillLink(
        db,
        transactionId,
        JSON.stringify({ creditCardMetadata: { billId } }),
      ),
    ).toBe(false);
  });

  it('allows manual override only when metadata billId is absent', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    const { accountId, transactionId } = seedCreditCardFixture(db);

    db.prepare(
      `INSERT INTO credit_card_bills (
        id, account_id, due_date, total_amount_cents, minimum_payment_cents, payment_status, currency, raw_json, synced_at
      ) VALUES ('bill-2', ?, '2026-07-15', 20000, 500, 'OPEN', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run(accountId);

    const rawJson = JSON.stringify({ creditCardMetadata: {} });
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, amount_in_account_currency_cents,
        currency, description, raw_json, synced_at
      ) VALUES (?, ?, '2026-05-20T10:00:00.000Z', -5000, -5000, 'BRL', 'Store', ?, '2026-06-10T00:00:00.000Z')`,
    ).run(transactionId, accountId, rawJson);

    syncCreditCardBillLinksForAccount(db, accountId, '2026-06-10T00:00:00.000Z');
    expect(canChangeCreditCardBillLink(db, transactionId, rawJson)).toBe(true);

    setManualCreditCardBillLink(db, transactionId, 'bill-2', '2026-06-11T00:00:00.000Z');
    const link = loadCreditCardBillLink(db, transactionId);
    expect(link?.bill_id).toBe('bill-2');
    expect(link?.source).toBe('manual');
    expect(canChangeCreditCardBillLink(db, transactionId, rawJson)).toBe(false);
  });
});
