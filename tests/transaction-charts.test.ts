import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ensureAnnotationLabel, saveEntryAnnotation } from '../src/annotation/store.js';
import { CHART_UNCATEGORIZED_CATEGORY_ID } from '../src/chart/transaction-aggregates.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { upsertTransactionCategoryOverride } from '../src/db/transaction-category-overrides.js';
import {
  loadTransactionChartDataset,
  loadTransactionChartSection,
} from '../src/db/transaction-charts.js';
import { createTransactionWebListFilters } from '../src/db/transaction-query.js';

function seedBase(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, balance_cents, currency, raw_json, synced_at)
     VALUES ('acc-1', 'item-1', 'BANK', 'Checking', -3500, 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO categories (id, name, name_translated, parent_id, parent_name, raw_json, synced_at)
     VALUES ('food', 'Food', 'Food', NULL, NULL, '{}', '2026-06-10T00:00:00.000Z'),
            ('groceries', 'Groceries', 'Groceries', 'food', 'Food', '{}', '2026-06-10T00:00:00.000Z'),
            ('travel', 'Travel', 'Travel', NULL, NULL, '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
}

function seedTransaction(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly occurredAt: string;
    readonly amountCents: number;
    readonly categoryId?: string | null;
    readonly merchantName?: string;
    readonly accountId?: string;
    readonly currency?: string;
  },
): void {
  db.prepare(
    `INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, 'Purchase', ?, ?, '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(
    input.id,
    input.accountId ?? 'acc-1',
    input.occurredAt,
    input.amountCents,
    input.currency ?? 'BRL',
    input.merchantName ?? 'Shop',
    input.categoryId ?? null,
  );
}

describe('loadTransactionChartDataset', () => {
  it('aggregates all filtered transactions across pages', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'tx-1',
      occurredAt: '2026-06-01T12:00:00.000Z',
      amountCents: -1000,
      categoryId: 'groceries',
    });
    seedTransaction(db, {
      id: 'tx-2',
      occurredAt: '2026-06-02T12:00:00.000Z',
      amountCents: -2000,
      categoryId: 'travel',
    });
    seedTransaction(db, {
      id: 'tx-3',
      occurredAt: '2026-06-03T12:00:00.000Z',
      amountCents: -500,
      categoryId: null,
    });

    const label = ensureAnnotationLabel(db, 'Trip');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-2',
      labelIds: [label.id],
      source: 'manual',
    });
    upsertTransactionCategoryOverride(db, 'tx-1', 'travel');

    const dataset = loadTransactionChartDataset(db, createTransactionWebListFilters(), 'UTC');

    expect(dataset.total).toBe(3);
    expect(dataset.dailyBalance).toHaveLength(10);
    expect(dataset.categoryTotals['travel']).toBe(3000);
    expect(dataset.categoryTotals['groceries']).toBeUndefined();
    expect(dataset.categoryTotals[CHART_UNCATEGORIZED_CATEGORY_ID]).toBe(500);
    expect(dataset.labelTotals[label.id]).toBe(2000);
  });

  it('loads chart sections independently', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'tx-1',
      occurredAt: '2026-06-01T12:00:00.000Z',
      amountCents: -1000,
      categoryId: 'groceries',
    });
    seedTransaction(db, {
      id: 'tx-2',
      occurredAt: '2026-06-02T12:00:00.000Z',
      amountCents: -2000,
      categoryId: 'travel',
    });

    const label = ensureAnnotationLabel(db, 'Trip');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-2',
      labelIds: [label.id],
      source: 'manual',
    });

    const filters = createTransactionWebListFilters();

    const balance = loadTransactionChartSection(db, filters, 'UTC', 'balance');
    const category = loadTransactionChartSection(db, filters, 'UTC', 'category');
    const labelSection = loadTransactionChartSection(db, filters, 'UTC', 'label');

    expect(balance.chart).toBe('balance');
    if (balance.chart !== 'balance') {
      throw new Error('expected balance chart section');
    }
    expect(balance.total).toBe(10);
    expect(balance.dailyBalance).toHaveLength(10);

    expect(category.chart).toBe('category');
    if (category.chart !== 'category') {
      throw new Error('expected category chart section');
    }
    expect(category.categoryTotals['groceries']).toBe(1000);
    expect(category.categoryTotals['travel']).toBe(2000);

    expect(labelSection.chart).toBe('label');
    if (labelSection.chart !== 'label') {
      throw new Error('expected label chart section');
    }
    expect(labelSection.labelTotals[label.id]).toBe(2000);
  });

  it('refuses to aggregate mixed currencies into one report dataset', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    db.prepare(
      `INSERT INTO accounts (
         id, connection_item_id, type, name, balance_cents, currency, raw_json, synced_at
       ) VALUES (
         'acc-usd', 'item-1', 'BANK', 'Dollar account', 10000, 'USD', '{}',
         '2026-06-10T00:00:00.000Z'
       )`,
    ).run();
    seedTransaction(db, {
      id: 'tx-brl',
      occurredAt: '2026-06-01T12:00:00.000Z',
      amountCents: -10_000,
    });
    seedTransaction(db, {
      id: 'tx-usd',
      accountId: 'acc-usd',
      currency: 'USD',
      occurredAt: '2026-06-01T13:00:00.000Z',
      amountCents: -10_000,
    });

    expect(() => loadTransactionChartDataset(db, createTransactionWebListFilters(), 'UTC')).toThrow(
      'cannot combine multiple currencies',
    );
  });
});
