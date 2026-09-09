import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ensureAnnotationLabel, saveEntryAnnotation } from '../src/annotation/store.js';
import { migrateDatabase } from '../src/db/migrate.js';
import {
  buildTransactionCommonWhere,
  createTransactionWebListFilters,
  listEnrichedTransactionsPage,
  listFilteredTransactionIds,
} from '../src/db/transaction-query.js';

function seedBase(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
     VALUES ('acc-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO categories (id, name, name_translated, parent_id, parent_name, raw_json, synced_at)
     VALUES ('food', 'Food', 'Food', NULL, NULL, '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
}

function seedTransaction(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly occurredAt: string;
    readonly merchantName: string;
    readonly description: string;
    readonly amountCents: number;
    readonly rawJson?: Record<string, unknown>;
  },
): void {
  db.prepare(
    `INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, merchant_name, raw_json, synced_at
    ) VALUES (?, 'acc-1', ?, ?, 'BRL', ?, ?, ?, '2026-06-10T00:00:00.000Z')`,
  ).run(
    input.id,
    input.occurredAt,
    input.amountCents,
    input.description,
    input.merchantName,
    JSON.stringify(input.rawJson ?? {}),
  );
}

describe('listEnrichedTransactionsPage', () => {
  it('builds the shared date, account, classification, transfer, and amount scope', () => {
    const where = buildTransactionCommonWhere(
      createTransactionWebListFilters({
        accountIds: ['acc-1'],
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        classification: 'classified',
        transfers: 'hide',
        minAbsoluteAmountCents: 1_000,
      }),
      'UTC',
    );

    expect(where.sql).toContain('t.account_id IN (?)');
    expect(where.sql).toContain('NOT EXISTS');
    expect(where.sql).toContain('ABS(');
    expect(where.params).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-06-30T23:59:59.999Z',
      'acc-1',
      1_000,
    ]);
  });

  it('paginates and sorts newest-first in SQL', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'tx-old',
      occurredAt: '2026-01-01T12:00:00.000Z',
      merchantName: 'Old Shop',
      description: 'Old purchase',
      amountCents: -1000,
    });
    seedTransaction(db, {
      id: 'tx-new',
      occurredAt: '2026-06-01T12:00:00.000Z',
      merchantName: 'New Shop',
      description: 'New purchase',
      amountCents: -2000,
    });

    const page = listEnrichedTransactionsPage(db, createTransactionWebListFilters(), {
      limit: 1,
      offset: 0,
      sort: { column: 'date', descending: true },
      timeZone: 'UTC',
    });

    expect(page.total).toBe(2);
    expect(page.rows.map((row) => row.id)).toEqual(['tx-new']);

    const secondPage = listEnrichedTransactionsPage(db, createTransactionWebListFilters(), {
      limit: 1,
      offset: 1,
      sort: { column: 'date', descending: true },
      timeZone: 'UTC',
    });
    expect(secondPage.rows.map((row) => row.id)).toEqual(['tx-old']);
  });

  it('lists every filtered transaction id without pagination', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'tx-may',
      occurredAt: '2026-05-31T12:00:00.000Z',
      merchantName: 'May Shop',
      description: 'Outside scope',
      amountCents: -1000,
    });
    seedTransaction(db, {
      id: 'tx-june-1',
      occurredAt: '2026-06-01T12:00:00.000Z',
      merchantName: 'June Shop',
      description: 'First matching transaction',
      amountCents: -1000,
    });
    seedTransaction(db, {
      id: 'tx-june-2',
      occurredAt: '2026-06-02T12:00:00.000Z',
      merchantName: 'June Shop',
      description: 'Second matching transaction',
      amountCents: -1000,
    });

    expect(
      listFilteredTransactionIds(
        db,
        createTransactionWebListFilters({
          startDate: '2026-06-01',
          endDate: '2026-06-30',
        }),
      ),
    ).toEqual(['tx-june-1', 'tx-june-2']);
  });

  it('sorts oldest-first when date ascending is requested', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'tx-old',
      occurredAt: '2026-01-01T12:00:00.000Z',
      merchantName: 'Old Shop',
      description: 'Old purchase',
      amountCents: -1000,
    });
    seedTransaction(db, {
      id: 'tx-new',
      occurredAt: '2026-06-01T12:00:00.000Z',
      merchantName: 'New Shop',
      description: 'New purchase',
      amountCents: -2000,
    });

    const page = listEnrichedTransactionsPage(db, createTransactionWebListFilters(), {
      limit: 10,
      offset: 0,
      sort: { column: 'date', descending: false },
      timeZone: 'UTC',
    });

    expect(page.rows.map((row) => row.id)).toEqual(['tx-old', 'tx-new']);
  });

  it('filters merchant and description with fts', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'tx-1',
      occurredAt: '2026-06-01T12:00:00.000Z',
      merchantName: 'NETFLIX.COM',
      description: 'Streaming charge',
      amountCents: -4990,
    });
    seedTransaction(db, {
      id: 'tx-2',
      occurredAt: '2026-06-02T12:00:00.000Z',
      merchantName: 'Market',
      description: 'Groceries',
      amountCents: -12000,
    });

    const result = listEnrichedTransactionsPage(
      db,
      createTransactionWebListFilters({
        merchantQuery: 'netflix',
        descriptionQuery: 'stream',
      }),
      {
        limit: 50,
        offset: 0,
        sort: { column: 'date', descending: true },
        timeZone: 'UTC',
      },
    );

    expect(result.total).toBe(1);
    expect(result.rows[0]?.id).toBe('tx-1');
  });

  it('finds transactions by classify annotation notes in description and q filters', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'tx-1',
      occurredAt: '2026-06-01T12:00:00.000Z',
      merchantName: 'Shop',
      description: 'Generic purchase',
      amountCents: -1000,
    });
    seedTransaction(db, {
      id: 'tx-2',
      occurredAt: '2026-06-02T12:00:00.000Z',
      merchantName: 'Shop',
      description: 'Generic purchase',
      amountCents: -2000,
    });

    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-2',
      notes: 'Summer vacation hotel',
      source: 'manual',
    });

    const byDescription = listEnrichedTransactionsPage(
      db,
      createTransactionWebListFilters({ descriptionQuery: 'vacation' }),
      {
        limit: 50,
        offset: 0,
        sort: { column: 'date', descending: true },
        timeZone: 'UTC',
      },
    );

    expect(byDescription.total).toBe(1);
    expect(byDescription.rows[0]?.id).toBe('tx-2');
    expect(byDescription.rows[0]?.display_description).toBe('Summer vacation hotel');

    const bySearch = listEnrichedTransactionsPage(
      db,
      createTransactionWebListFilters({ searchQuery: 'vacation' }),
      {
        limit: 50,
        offset: 0,
        sort: { column: 'date', descending: true },
        timeZone: 'UTC',
      },
    );

    expect(bySearch.total).toBe(1);
    expect(bySearch.rows[0]?.id).toBe('tx-2');
  });

  it('filters by label ids', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'tx-1',
      occurredAt: '2026-06-01T12:00:00.000Z',
      merchantName: 'Shop',
      description: 'Purchase',
      amountCents: -1000,
    });
    seedTransaction(db, {
      id: 'tx-2',
      occurredAt: '2026-06-02T12:00:00.000Z',
      merchantName: 'Shop',
      description: 'Purchase',
      amountCents: -2000,
    });

    const label = ensureAnnotationLabel(db, 'Travel');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-2',
      labelIds: [label.id],
      source: 'manual',
    });

    const result = listEnrichedTransactionsPage(
      db,
      createTransactionWebListFilters({ labelIds: [label.id] }),
      {
        limit: 50,
        offset: 0,
        sort: { column: 'date', descending: true },
        timeZone: 'UTC',
      },
    );

    expect(result.total).toBe(1);
    expect(result.rows[0]?.id).toBe('tx-2');
  });

  it('filters classified transactions only', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'tx-1',
      occurredAt: '2026-06-01T12:00:00.000Z',
      merchantName: 'Shop',
      description: 'Purchase',
      amountCents: -1000,
    });
    seedTransaction(db, {
      id: 'tx-2',
      occurredAt: '2026-06-02T12:00:00.000Z',
      merchantName: 'Shop',
      description: 'Purchase',
      amountCents: -2000,
    });

    db.prepare(
      `INSERT INTO annotation_categories (id, name, created_at)
       VALUES ('food', 'Food', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO entry_annotations (
         id, entry_type, entry_id, category_id, source, created_at, updated_at
       ) VALUES ('ea-1', 'transaction', 'tx-2', 'food', 'manual', '2026-06-10T00:00:00.000Z', '2026-06-10T00:00:00.000Z')`,
    ).run();

    const result = listEnrichedTransactionsPage(
      db,
      createTransactionWebListFilters({ classification: 'classified' }),
      {
        limit: 50,
        offset: 0,
        sort: { column: 'date', descending: true },
        timeZone: 'UTC',
      },
    );

    expect(result.total).toBe(1);
    expect(result.rows[0]?.id).toBe('tx-2');
  });

  it('treats labels-only annotations as classified', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'tx-1',
      occurredAt: '2026-06-01T12:00:00.000Z',
      merchantName: 'Shop',
      description: 'Purchase',
      amountCents: -1000,
    });
    seedTransaction(db, {
      id: 'tx-2',
      occurredAt: '2026-06-02T12:00:00.000Z',
      merchantName: 'Shop',
      description: 'Purchase',
      amountCents: -2000,
    });

    db.prepare(
      `INSERT INTO annotation_labels (id, name, icon, color, created_at)
       VALUES ('travel', 'Travel', 'MdLabel', '#64748b', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO entry_annotations (
         id, entry_type, entry_id, category_id, source, created_at, updated_at
       ) VALUES ('ea-1', 'transaction', 'tx-2', NULL, 'manual', '2026-06-10T00:00:00.000Z', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO entry_annotation_labels (annotation_id, label_id, created_at)
       VALUES ('ea-1', 'travel', '2026-06-10T00:00:00.000Z')`,
    ).run();

    const classified = listEnrichedTransactionsPage(
      db,
      createTransactionWebListFilters({ classification: 'classified' }),
      {
        limit: 50,
        offset: 0,
        sort: { column: 'date', descending: true },
        timeZone: 'UTC',
      },
    );
    const unclassified = listEnrichedTransactionsPage(
      db,
      createTransactionWebListFilters({ classification: 'unclassified' }),
      {
        limit: 50,
        offset: 0,
        sort: { column: 'date', descending: true },
        timeZone: 'UTC',
      },
    );

    expect(classified.total).toBe(1);
    expect(classified.rows[0]?.id).toBe('tx-2');
    expect(unclassified.total).toBe(1);
    expect(unclassified.rows[0]?.id).toBe('tx-1');
  });

  it('filters by credit card installments', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'tx-lump',
      occurredAt: '2026-06-01T12:00:00.000Z',
      merchantName: 'Shop',
      description: 'One-time purchase',
      amountCents: -1000,
    });
    seedTransaction(db, {
      id: 'tx-installment',
      occurredAt: '2026-06-02T12:00:00.000Z',
      merchantName: 'Shop 01/03',
      description: 'Installment purchase',
      amountCents: -500,
      rawJson: {
        creditCardMetadata: { installmentNumber: 1, totalInstallments: 3 },
      },
    });

    const onlyInstallments = listEnrichedTransactionsPage(
      db,
      createTransactionWebListFilters({ installments: 'only' }),
      {
        limit: 50,
        offset: 0,
        sort: { column: 'date', descending: true },
        timeZone: 'UTC',
      },
    );
    const hideInstallments = listEnrichedTransactionsPage(
      db,
      createTransactionWebListFilters({ installments: 'hide' }),
      {
        limit: 50,
        offset: 0,
        sort: { column: 'date', descending: true },
        timeZone: 'UTC',
      },
    );

    expect(onlyInstallments.total).toBe(1);
    expect(onlyInstallments.rows[0]?.id).toBe('tx-installment');
    expect(hideInstallments.total).toBe(1);
    expect(hideInstallments.rows[0]?.id).toBe('tx-lump');
  });
});
