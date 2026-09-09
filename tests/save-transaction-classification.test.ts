import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { saveTransactionClassification } from '../src/annotation/save-transaction-classification.js';
import { migrateDatabase } from '../src/db/migrate.js';

const config = {
  annotation: {
    embedding: null,
  },
} as unknown as import('../src/types.js').ResolvedAppConfig;

function seedBase(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', 'pluggy', 'Bank', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, subtype, name, balance_cents, currency, raw_json, synced_at)
     VALUES ('acc-1', 'item-1', 'CREDIT', 'CREDIT_CARD', 'Card', 0, 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO categories (id, name, name_translated, parent_id, raw_json, synced_at)
     VALUES ('cat-a', 'Category A', 'Category A', NULL, '{}', '2026-06-10T00:00:00.000Z'),
            ('cat-b', 'Category B', 'Category B', NULL, '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO annotation_labels (id, name, created_at)
     VALUES ('travel', 'Travel', '2026-06-10T00:00:00.000Z')`,
  ).run();
}

function seedInstallment(
  db: DatabaseSync,
  id: string,
  installmentNumber: number,
  categoryId: string,
): void {
  const merchant = `Shop 0${installmentNumber}/02`;
  db.prepare(
    `INSERT INTO transactions (
       id, account_id, occurred_at, amount_cents, currency, description, category_id, merchant_name,
       payment_type, status, raw_json, synced_at
     ) VALUES (?, 'acc-1', '2026-06-01T12:00:00.000Z', -1000, 'BRL', ?, ?, ?, 'CREDIT_CARD', 'POSTED', ?, '2026-06-10T00:00:00.000Z')`,
  ).run(
    id,
    merchant,
    categoryId,
    merchant,
    JSON.stringify({
      creditCardMetadata: { installmentNumber, totalInstallments: 2 },
    }),
  );
}

function seedTransaction(
  db: DatabaseSync,
  id: string,
  categoryId: string,
  merchant = 'Coffee Shop',
): void {
  db.prepare(
    `INSERT INTO transactions (
       id, account_id, occurred_at, amount_cents, currency, description, category_id, merchant_name,
       payment_type, status, raw_json, synced_at
     ) VALUES (?, 'acc-1', '2026-06-01T12:00:00.000Z', -1000, 'BRL', ?, ?, ?, 'DEBIT', 'POSTED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(id, merchant, categoryId, merchant);
}

describe('saveTransactionClassification', () => {
  it('applies category override, labels, and notes to installment siblings', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedInstallment(db, 'tx-1', 1, 'cat-a');
    seedInstallment(db, 'tx-2', 2, 'cat-a');

    const result = await saveTransactionClassification(db, config, 'tx-1', {
      categoryOverrideId: 'cat-b',
      labelIds: ['travel'],
      notes: 'Vacation plan',
      applyToInstallmentSiblings: true,
    });

    expect([...result.updatedTransactionIds].sort()).toEqual(['tx-1', 'tx-2']);

    for (const id of ['tx-1', 'tx-2']) {
      const override = db
        .prepare('SELECT category_id FROM transaction_category_overrides WHERE transaction_id = ?')
        .get(id) as { readonly category_id: string };
      expect(override.category_id).toBe('cat-b');

      const annotation = db
        .prepare(
          `SELECT ea.notes
           FROM entry_annotations ea
           WHERE ea.entry_type = 'transaction' AND ea.entry_id = ?`,
        )
        .get(id) as { readonly notes: string };
      expect(annotation.notes).toBe('Vacation plan');

      const labels = db
        .prepare(
          `SELECT label_id FROM entry_annotation_labels eal
           JOIN entry_annotations ea ON ea.id = eal.annotation_id
           WHERE ea.entry_type = 'transaction' AND ea.entry_id = ?`,
        )
        .all(id) as Array<{ readonly label_id: string }>;
      expect(labels.map((row) => row.label_id)).toEqual(['travel']);
    }
  });

  it('applies category override, labels, and notes to explicitly selected transactions', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, 'tx-1', 'cat-a');
    seedTransaction(db, 'tx-2', 'cat-a');
    seedTransaction(db, 'tx-3', 'cat-a');

    const result = await saveTransactionClassification(db, config, 'tx-1', {
      categoryOverrideId: 'cat-b',
      labelIds: ['travel'],
      notes: 'Batch edit',
      applyToTransactionIds: ['tx-2', 'tx-3', 'missing-id'],
    });

    expect([...result.updatedTransactionIds].sort()).toEqual(['tx-1', 'tx-2', 'tx-3']);

    for (const id of ['tx-1', 'tx-2', 'tx-3']) {
      const override = db
        .prepare('SELECT category_id FROM transaction_category_overrides WHERE transaction_id = ?')
        .get(id) as { readonly category_id: string };
      expect(override.category_id).toBe('cat-b');

      const annotation = db
        .prepare(
          `SELECT ea.notes
           FROM entry_annotations ea
           WHERE ea.entry_type = 'transaction' AND ea.entry_id = ?`,
        )
        .get(id) as { readonly notes: string };
      expect(annotation.notes).toBe('Batch edit');
    }
  });
});
