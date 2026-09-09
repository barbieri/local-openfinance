import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildEmbeddingFeatureText, loadTransactionEntry } from '../src/annotation/feature-text.js';
import { migrateDatabase } from '../src/db/migrate.js';
import {
  getTransactionCategoryOverride,
  upsertTransactionCategoryOverride,
} from '../src/db/transaction-category-overrides.js';

function seedTransaction(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO categories (id, name, parent_id, parent_name, raw_json, synced_at)
     VALUES ('05000000', 'Food', NULL, NULL, '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO categories (id, name, parent_id, parent_name, raw_json, synced_at)
     VALUES ('05080000', 'Restaurants', '05000000', 'Food', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, subtype, name, currency, raw_json, synced_at)
     VALUES ('acct-1', 'item-1', 'BANK', 'CHECKING', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, category_id, raw_json, synced_at
    ) VALUES (
      'tx-1', 'acct-1', '2026-06-10T15:30:00.000Z', -5000, 'BRL', 'Coffee shop', '05080000',
      '{"description":"Coffee shop","merchant":{"name":"Cafe Local"},"paymentData":{"receiver":"Cafe Local"}}',
      '2026-06-10T00:00:00.000Z'
    )`,
  ).run();
}

describe('embedding feature text', () => {
  it('includes semantic fields without raw json dump', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db);

    const entry = loadTransactionEntry(db, 'tx-1');
    if (!entry) {
      throw new Error('expected seeded transaction');
    }
    const featureText = buildEmbeddingFeatureText(entry);
    expect(featureText).toContain('category_id=05080000');
    expect(featureText).toContain('parent_category=Food');
    expect(featureText).toContain('month=2026-06');
    expect(featureText).toContain('account_type=BANK');
    expect(featureText).not.toContain('raw.merchant=');
    expect(featureText).not.toContain('raw.id=');
    expect(featureText).toContain('payment_receiver_name=Cafe Local');
    expect(featureText).toContain('amount_sign=debit');
  });

  it('includes normalized peer documents and mcc name from raw detail', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db);
    db.prepare(
      `UPDATE transactions
       SET raw_json = ?
       WHERE id = 'tx-1'`,
    ).run(
      JSON.stringify({
        description: 'Card purchase',
        creditCardMetadata: { payeeMCC: 5941 },
        paymentData: {
          payer: { type: 'CPF', value: '390.533.447-05' },
          receiver: { type: 'CNPJ', value: '12.345.678/0001-99' },
        },
        merchant: { cnpj: '12345678000199' },
      }),
    );

    const entry = loadTransactionEntry(db, 'tx-1');
    if (!entry) {
      throw new Error('expected seeded transaction');
    }
    const featureText = buildEmbeddingFeatureText(entry);
    expect(featureText).toContain('payer_document=cpf:39053344705');
    expect(featureText).toContain('receiver_document=cnpj:12345678000199');
    expect(featureText).toContain('merchant_document=cnpj:12345678000199');
    expect(featureText).toContain('payee_mcc=5941');
    expect(featureText).toContain('payee_mcc_name=');
  });
});

describe('transaction category overrides', () => {
  it('stores manual upstream category corrections separately from synced category_id', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db);

    expect(getTransactionCategoryOverride(db, 'tx-1')).toBeNull();
    upsertTransactionCategoryOverride(db, 'tx-1', '05080000');
    expect(getTransactionCategoryOverride(db, 'tx-1')).toBe('05080000');
  });
});
