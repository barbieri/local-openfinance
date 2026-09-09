import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/db/migrate.js';
import { enrichTransactionRow, loadTransactionRowById } from '../src/db/transaction-details.js';
import {
  computeForeignExchangeRate,
  normalizeTransactionAmountInAccountCurrencyCents,
  readTransactionAmountInAccountCurrencyCents,
  resolveSyncedTransactionAmountInAccountCurrencyCents,
  resolveTransactionForeignAmountFields,
} from '../src/db/transaction-foreign-amount.js';

function seedForeignTransaction(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, subtype, name, currency, raw_json, synced_at)
     VALUES ('acct-1', 'item-1', 'CREDIT', 'CREDIT_CARD', 'Visa', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, amount_in_account_currency_cents, currency,
      description, raw_json, synced_at
    ) VALUES (
      'tx-foreign', 'acct-1', '2026-06-10T15:30:00.000Z', -1234, -345, 'ARS',
      'Foreign purchase',
      '{"amount":-12.34,"currencyCode":"ARS","amountInAccountCurrency":-3.45}',
      '2026-06-10T00:00:00.000Z'
    )`,
  ).run();
}

describe('transaction foreign amount', () => {
  it('reads amountInAccountCurrency from upstream payloads', () => {
    expect(
      readTransactionAmountInAccountCurrencyCents({
        amountInAccountCurrency: -3.45,
      }),
    ).toBe(-345);
  });

  it('falls back to amount when upstream omits amountInAccountCurrency', () => {
    expect(resolveSyncedTransactionAmountInAccountCurrencyCents({ amount: -12.34 }, -1234)).toBe(
      -1234,
    );
  });

  it('always exposes account-currency amount fields on enriched rows', () => {
    expect(
      resolveTransactionForeignAmountFields({
        currency: 'ARS',
        accountCurrency: 'BRL',
        amountInAccountCurrencyCents: -345,
      }),
    ).toEqual({
      account_currency: 'BRL',
      amount_in_account_currency_cents: -345,
    });

    expect(
      resolveTransactionForeignAmountFields({
        currency: 'BRL',
        accountCurrency: 'BRL',
        amountInAccountCurrencyCents: -5000,
      }),
    ).toEqual({
      account_currency: 'BRL',
      amount_in_account_currency_cents: -5000,
    });
  });

  it('normalizes missing stored account amounts to amount_cents', () => {
    expect(normalizeTransactionAmountInAccountCurrencyCents(null, -5000)).toBe(-5000);
  });

  it('enriches listings with account-currency amount metadata', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedForeignTransaction(db);

    const row = loadTransactionRowById(db, 'tx-foreign');
    if (!row) {
      throw new Error('expected seeded transaction');
    }

    const enriched = enrichTransactionRow(db, row);
    expect(enriched.account_currency).toBe('BRL');
    expect(enriched.amount_in_account_currency_cents).toBe(-345);
    expect(enriched.currency).toBe('ARS');
    expect(enriched.amount_cents).toBe(-1234);
  });

  it('computes exchange rate from stored amounts', () => {
    expect(computeForeignExchangeRate(-1234, -345)).toBeCloseTo(345 / 1234, 4);
  });
});
