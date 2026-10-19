import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { ensureAnnotationLabel, saveEntryAnnotation } from '../src/annotation/store.js';
import { migrateDatabase } from '../src/db/migrate.js';
import * as transactionDates from '../src/db/transaction-date-basis.js';
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

  it('includes start-day credit purchases while retaining occurred-at fallback bounds', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'purchase-on-start',
      occurredAt: '2026-07-10T12:00:00.000Z',
      merchantName: 'Card purchase',
      description: 'Purchase date matches the lower bound',
      amountCents: -1000,
      rawJson: { creditCardMetadata: { purchaseDate: '2026-06-01' } },
    });
    seedTransaction(db, {
      id: 'fallback-on-start',
      occurredAt: '2026-06-01T03:00:00.000Z',
      merchantName: 'Fallback match',
      description: 'Occurred at matches the lower bound',
      amountCents: -2000,
    });
    seedTransaction(db, {
      id: 'fallback-before-start',
      occurredAt: '2026-06-01T02:59:59.999Z',
      merchantName: 'Fallback before',
      description: 'Occurred at precedes the lower bound',
      amountCents: -3000,
    });

    const ids = listFilteredTransactionIds(
      db,
      createTransactionWebListFilters({
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        useCreditPurchaseDate: true,
      }),
      'America/Sao_Paulo',
    );

    expect(ids).toEqual(['fallback-on-start', 'purchase-on-start']);
  });

  it('hides deleted transactions by default and can include or isolate them', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    seedTransaction(db, {
      id: 'tx-live',
      occurredAt: '2026-06-01T12:00:00.000Z',
      merchantName: 'Live',
      description: 'Visible',
      amountCents: -1000,
    });
    seedTransaction(db, {
      id: 'tx-deleted',
      occurredAt: '2026-06-02T12:00:00.000Z',
      merchantName: 'Deleted',
      description: 'Hidden',
      amountCents: -2000,
    });
    db.prepare(
      "UPDATE transactions SET deleted_at = '2026-09-15T12:00:00.000Z' WHERE id = 'tx-deleted'",
    ).run();

    const ids = (deletedVisibility: 'all' | 'hide' | 'only') =>
      listFilteredTransactionIds(db, createTransactionWebListFilters({ deletedVisibility }));
    expect(ids('hide')).toEqual(['tx-live']);
    expect(ids('all')).toEqual(['tx-live', 'tx-deleted']);
    expect(ids('only')).toEqual(['tx-deleted']);
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

describe('date-packed pages and accounting summaries', () => {
  it('packs complete local days into distinct numbered pages with an oversized purchase-date day', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    for (let index = 0; index < 205; index += 1) {
      seedTransaction(db, {
        id: `large-${index.toString().padStart(3, '0')}`,
        occurredAt: '2026-06-10T12:00:00.000Z',
        merchantName: 'Shop',
        description: 'Purchase',
        amountCents: index,
        rawJson: { creditCardMetadata: { purchaseDate: '2026-06-03' } },
      });
    }
    for (const [id, occurredAt] of [
      ['local-2', '2026-06-03T01:00:00.000Z'],
      ['local-1', '2026-06-02T01:00:00.000Z'],
    ]) {
      if (!id || !occurredAt) throw new Error('Missing test fixture');
      seedTransaction(db, {
        id,
        occurredAt,
        merchantName: 'Shop',
        description: 'Purchase',
        amountCents: -5,
      });
    }
    const filters = createTransactionWebListFilters({ useCreditPurchaseDate: true });
    const page = (number: number) =>
      listEnrichedTransactionsPage(db, filters, {
        limit: 100,
        offset: (number - 1) * 100,
        groupByDate: true,
        sort: { column: 'amount', descending: false },
        timeZone: 'America/Sao_Paulo',
      });
    const first = page(1);
    const second = page(2);
    expect(first.pageCount).toBe(2);
    expect(first.rows).toHaveLength(205);
    expect(first.rows.map((row) => row.local_date)).toEqual(Array(205).fill('2026-06-03'));
    expect(first.rows[0]?.amount_cents).toBe(0);
    expect(first.rows.at(-1)?.amount_cents).toBe(204);
    expect(second.offset).toBe(205);
    expect(second.rows.map((row) => row.id)).toEqual(['local-2', 'local-1']);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(207);
    expect(page(3).rows).toEqual([]);
    const ascending = listEnrichedTransactionsPage(db, filters, {
      limit: 1,
      offset: 0,
      groupByDate: true,
      sort: { column: 'date', descending: false },
      timeZone: 'America/Sao_Paulo',
    });
    expect(ascending.rows.map((row) => row.id)).toEqual(['local-1']);
    expect(ascending.pageCount).toBe(3);
    db.close();
  });

  it('normalizes the full scope once and only normalizes selected rows for page ordering', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    for (let day = 1; day <= 10; day += 1) {
      for (let index = 0; index < 100; index += 1) {
        seedTransaction(db, {
          id: `${day}-${index}`,
          occurredAt: `2026-06-${String(day).padStart(2, '0')}T12:00:00.000Z`,
          merchantName: 'Shop',
          description: 'Purchase',
          amountCents: -100,
        });
      }
    }
    const normalize = vi.spyOn(transactionDates, 'resolveTransactionLocalDate');
    try {
      const result = listEnrichedTransactionsPage(db, createTransactionWebListFilters(), {
        limit: 100,
        offset: 100,
        groupByDate: true,
        sort: { column: 'date', descending: true },
        timeZone: 'America/Sao_Paulo',
      });
      expect(result.rows).toHaveLength(100);
      expect(result.rows.every((row) => row.local_date === '2026-06-09')).toBe(true);
      expect(result.offset).toBe(100);
      expect(result.pageCount).toBe(10);
      expect(normalize.mock.calls.length).toBeGreaterThanOrEqual(1000);
      expect(normalize.mock.calls.length).toBeLessThan(1500);
    } finally {
      normalize.mockRestore();
      db.close();
    }
  });

  it('uses canonical purchase-date bounds across a daylight-saving transition and existing filters', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    const fixtures = [
      ['before', '2026-03-08T04:59:59.999Z', 'Included'],
      ['start', '2026-03-08T05:00:00.000Z', 'Included'],
      ['calendar', '2026-03-08', 'Included'],
      ['offset', '2026-03-08T22:00:00-04:00', 'Included'],
      ['end', '2026-03-09T03:59:59.999Z', 'Included'],
      ['next', '2026-03-09T04:00:00.000Z', 'Included'],
      ['excluded', '2026-03-08', 'Excluded'],
    ];
    for (const [id, purchaseDate, description] of fixtures) {
      if (!id || !purchaseDate || !description) throw new Error('Missing test fixture');
      seedTransaction(db, {
        id,
        occurredAt: '2026-06-01T12:00:00.000Z',
        merchantName: 'Shop',
        description,
        amountCents: -100,
        rawJson: { creditCardMetadata: { purchaseDate } },
      });
    }
    const page = (offset: number) =>
      listEnrichedTransactionsPage(
        db,
        createTransactionWebListFilters({
          useCreditPurchaseDate: true,
          descriptionQuery: 'Included',
          startDate: '2026-03-08',
          endDate: '2026-03-09',
        }),
        {
          limit: 1,
          offset,
          groupByDate: true,
          sort: { column: 'date', descending: false },
          timeZone: 'America/New_York',
        },
      );
    expect(
      page(0)
        .rows.map((row) => row.id)
        .toSorted(),
    ).toEqual(['calendar', 'end', 'offset', 'start']);
    expect(page(0).pageCount).toBe(2);
    expect(page(1).rows.map((row) => row.id)).toEqual(['next']);
    expect(page(1).offset).toBe(4);
    db.close();
  });

  it('summarizes every filtered match by account currency with card refunds and zero amounts', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedBase(db);
    db.prepare(`INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
      VALUES ('card', 'item-1', 'CREDIT', 'Card', 'BRL', '{}', '2026-06-10'),
             ('usd', 'item-1', 'BANK', 'USD', 'USD', '{}', '2026-06-10')`).run();
    const insert = db.prepare(`INSERT INTO transactions (id, account_id, occurred_at, amount_cents,
      amount_in_account_currency_cents, currency, description, raw_json, synced_at)
      VALUES (?, ?, '2026-06-01T12:00:00.000Z', ?, ?, ?, ?, '{}', '2026-06-10')`);
    insert.run('purchase', 'card', 100, 500, 'USD', 'Included');
    insert.run('refund', 'card', -50, -250, 'USD', 'Included');
    insert.run('bank-debit', 'acc-1', -100, -100, 'BRL', 'Included');
    insert.run('bank-credit', 'acc-1', 200, 200, 'BRL', 'Included');
    insert.run('zero', 'acc-1', 0, 0, 'BRL', 'Included');
    insert.run('dollars', 'usd', 1000, 1000, 'USD', 'Included');
    insert.run('excluded', 'card', 99999, 99999, 'BRL', 'Excluded');
    const result = listEnrichedTransactionsPage(
      db,
      createTransactionWebListFilters({ descriptionQuery: 'Included' }),
      { limit: 1, offset: 0, sort: { column: 'date', descending: true }, timeZone: 'UTC' },
    );
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(6);
    expect(result.summary).toEqual([
      {
        currency: 'BRL',
        total: 5,
        debitCount: 2,
        creditCount: 2,
        debitCents: -600,
        creditCents: 450,
        balanceCents: -150,
      },
      {
        currency: 'USD',
        total: 1,
        debitCount: 0,
        creditCount: 1,
        debitCents: 0,
        creditCents: 1000,
        balanceCents: 1000,
      },
    ]);
    const card = listEnrichedTransactionsPage(
      db,
      createTransactionWebListFilters({ accountIds: ['card'], transactionIds: ['purchase'] }),
      { limit: 1, offset: 0, sort: { column: 'date', descending: true } },
    ).rows[0];
    expect(card?.amount_cents).toBe(100);
    expect(card?.amount_in_account_currency_cents).toBe(500);
    expect(card?.account_type).toBe('CREDIT');
    db.close();
  });
});
