import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/db/migrate.js';
import { upsertTransactionCategoryOverride } from '../src/db/transaction-category-overrides.js';
import {
  listEnrichedTransactions,
  parseTransactionGroupBy,
} from '../src/db/transaction-details.js';
import {
  renderTransactionsTree,
  serializeTransactionForJson,
} from '../src/db/transactions/present.js';
import { toLocalDateKey } from '../src/utils/local-date.js';

function seedCategory(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly name: string;
    readonly nameTranslated?: string | undefined;
  },
): void {
  db.prepare(
    `INSERT INTO categories (id, name, name_translated, parent_id, parent_name, raw_json, synced_at)
     VALUES (?, ?, ?, NULL, NULL, '{}', '2026-06-10T00:00:00.000Z')
     ON CONFLICT(id) DO NOTHING`,
  ).run(input.id, input.name, input.nameTranslated ?? null);
}

function seedTransaction(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly accountId: string;
    readonly itemId: string;
    readonly occurredAt: string;
    readonly amountCents: number;
    readonly merchantName?: string | undefined;
    readonly categoryId?: string | undefined;
    readonly categoryOriginalName?: string | undefined;
    readonly categoryTranslatedName?: string | undefined;
    readonly paymentType?: string | undefined;
    readonly status?: string | undefined;
    readonly rawJson?: Record<string, unknown> | undefined;
    readonly description?: string | undefined;
  },
): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES (?, '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')
     ON CONFLICT(item_id) DO NOTHING`,
  ).run(input.itemId);

  db.prepare(
    `INSERT INTO accounts (
      id, connection_item_id, type, subtype, name, number, owner, balance_cents, currency, raw_json, synced_at
    ) VALUES (?, ?, 'BANK', 'CHECKING', 'Main Checking', '1234-5', NULL, 0, 'BRL', '{}', '2026-06-10T00:00:00.000Z')
     ON CONFLICT(id) DO NOTHING`,
  ).run(input.accountId, input.itemId);

  if (input.categoryId && input.categoryOriginalName) {
    seedCategory(db, {
      id: input.categoryId,
      name: input.categoryOriginalName,
      nameTranslated: input.categoryTranslatedName,
    });
  }

  db.prepare(
    `INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, category_id,
      merchant_name, payment_type, status, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, 'BRL', ?, ?, ?, ?, ?, ?, '2026-06-10T00:00:00.000Z')`,
  ).run(
    input.id,
    input.accountId,
    input.occurredAt,
    input.amountCents,
    input.description ?? input.merchantName ?? null,
    input.categoryId ?? null,
    input.merchantName ?? null,
    input.paymentType ?? null,
    input.status ?? 'POSTED',
    JSON.stringify(
      input.rawJson ?? {
        creditCardMetadata: { installmentNumber: 2, totalInstallments: 6 },
      },
    ),
  );
}

describe('transaction list', () => {
  it('defaults group-by to account and date', () => {
    expect(parseTransactionGroupBy(undefined)).toEqual(['account', 'date']);
  });

  it('renders transactions oldest-first with category, annotation, transfer, and installment info', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedTransaction(db, {
      id: 'tx-old',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-01T15:00:00.000Z',
      amountCents: -3990,
      merchantName: 'Disney Plus',
      categoryId: 'streaming',
      categoryOriginalName: 'Streaming services',
      categoryTranslatedName: 'Streaming',
      paymentType: 'CREDIT_CARD',
    });
    seedTransaction(db, {
      id: 'tx-new',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-02T15:00:00.000Z',
      amountCents: -12000,
      merchantName: 'Supermarket',
      categoryId: 'groceries',
      categoryOriginalName: 'Groceries',
      paymentType: 'DEBIT_CARD',
      rawJson: {},
    });

    db.prepare(
      `INSERT INTO annotation_categories (id, name, created_at) VALUES ('food', 'Food', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO annotation_labels (id, name, created_at) VALUES ('recurring', 'recurring', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO entry_annotations (
        id, entry_type, entry_id, category_id, sub_category_id, notes, source, created_at, updated_at
      ) VALUES ('ann-1', 'transaction', 'tx-old', 'food', NULL, NULL, 'manual', '2026-06-10T00:00:00.000Z', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO entry_annotation_labels (annotation_id, label_id, created_at)
       VALUES ('ann-1', 'recurring', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO transfer_groups (id, kind, confidence, notes, created_at)
       VALUES ('tg-1', 'internal_transfer', 0.9, NULL, '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO transfer_group_members (group_id, entry_type, entry_id, role)
       VALUES ('tg-1', 'transaction', 'tx-old', 'source')`,
    ).run();

    const transactions = listEnrichedTransactions(
      db,
      {
        status: 'all',
        accountIds: 'all',
        categoryIds: 'all',
        merchantPattern: null,
        paymentTypes: 'all',
        startDate: null,
        endDate: null,
      },
      'UTC',
    );
    const output = renderTransactionsTree(transactions, parseTransactionGroupBy(undefined));

    expect(transactions.map((row) => row.id)).toEqual(['tx-old', 'tx-new']);
    expect(output.indexOf('2026-06-01')).toBeLessThan(output.indexOf('2026-06-02'));
    expect(output).toContain('Main Checking');
    expect(output).toContain('Disney Plus');
    expect(output).toContain('Streaming');
    expect(output).not.toContain('Streaming services');
    expect(output).toContain('→ Food [recurring]');
    expect(output).toContain('⇄');
    expect(output).not.toContain('⇄ internal_transfer');
    expect(output).toContain('2/6');
  });

  it('filters by category id, merchant regexp, payment type, and date range', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedTransaction(db, {
      id: 'tx-1',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-01T15:00:00.000Z',
      amountCents: -1000,
      merchantName: 'Uber Trip',
      categoryId: 'transport',
      categoryOriginalName: 'Transport',
      paymentType: 'PIX',
      rawJson: {},
    });
    seedTransaction(db, {
      id: 'tx-2',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-03T15:00:00.000Z',
      amountCents: -2000,
      merchantName: 'Market',
      categoryId: 'food',
      categoryOriginalName: 'Groceries',
      paymentType: 'DEBIT_CARD',
      rawJson: {},
    });

    const filtered = listEnrichedTransactions(
      db,
      {
        status: 'all',
        accountIds: 'all',
        categoryIds: ['transport'],
        merchantPattern: /uber/i,
        paymentTypes: ['PIX'],
        startDate: '2026-06-01',
        endDate: '2026-06-02',
      },
      'UTC',
    );

    expect(filtered.map((row) => row.id)).toEqual(['tx-1']);
  });

  it('filters by corrected category override instead of synced category_id', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedCategory(db, { id: 'food', name: 'Food' });
    seedCategory(db, { id: 'transport', name: 'Transport' });

    seedTransaction(db, {
      id: 'tx-1',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-01T15:00:00.000Z',
      amountCents: -1000,
      merchantName: 'Uber Trip',
      categoryId: 'food',
      categoryOriginalName: 'Food',
      rawJson: {},
    });

    upsertTransactionCategoryOverride(db, 'tx-1', 'transport');

    const transportMatches = listEnrichedTransactions(
      db,
      {
        status: 'all',
        accountIds: 'all',
        categoryIds: ['transport'],
        merchantPattern: null,
        paymentTypes: 'all',
        startDate: null,
        endDate: null,
      },
      'UTC',
    );
    const foodMatches = listEnrichedTransactions(
      db,
      {
        status: 'all',
        accountIds: 'all',
        categoryIds: ['food'],
        merchantPattern: null,
        paymentTypes: 'all',
        startDate: null,
        endDate: null,
      },
      'UTC',
    );

    expect(transportMatches.map((row) => row.id)).toEqual(['tx-1']);
    expect(foodMatches).toEqual([]);
  });

  it('filters by datetime bounds when start/end include time', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedTransaction(db, {
      id: 'tx-early',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-01T08:00:00.000Z',
      amountCents: -1000,
      merchantName: 'Morning',
      rawJson: {},
    });
    seedTransaction(db, {
      id: 'tx-late',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-01T20:00:00.000Z',
      amountCents: -2000,
      merchantName: 'Evening',
      rawJson: {},
    });

    const filtered = listEnrichedTransactions(
      db,
      {
        status: 'all',
        accountIds: 'all',
        categoryIds: 'all',
        merchantPattern: null,
        paymentTypes: 'all',
        startDate: '2026-06-01T12:00:00.000Z',
        endDate: '2026-06-01T23:59:00.000Z',
      },
      'UTC',
    );

    expect(filtered.map((row) => row.id)).toEqual(['tx-late']);
  });

  it('filters by account id csv', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedTransaction(db, {
      id: 'tx-1',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-01T15:00:00.000Z',
      amountCents: -1000,
      merchantName: 'Uber Trip',
      rawJson: {},
    });
    seedTransaction(db, {
      id: 'tx-2',
      accountId: 'acc-2',
      itemId: 'item-2',
      occurredAt: '2026-06-01T15:00:00.000Z',
      amountCents: -2000,
      merchantName: 'Market',
      rawJson: {},
    });

    const filtered = listEnrichedTransactions(
      db,
      {
        status: 'all',
        accountIds: ['acc-2'],
        categoryIds: 'all',
        merchantPattern: null,
        paymentTypes: 'all',
        startDate: null,
        endDate: null,
      },
      'UTC',
    );

    expect(filtered.map((row) => row.id)).toEqual(['tx-2']);
  });

  it('adds account suffix when group-by excludes account', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedTransaction(db, {
      id: 'tx-1',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-01T15:00:00.000Z',
      amountCents: -1000,
      merchantName: 'Uber Trip',
      rawJson: {},
    });

    const transactions = listEnrichedTransactions(
      db,
      {
        status: 'all',
        accountIds: 'all',
        categoryIds: 'all',
        merchantPattern: null,
        paymentTypes: 'all',
        startDate: null,
        endDate: null,
      },
      'UTC',
    );
    const output = renderTransactionsTree(transactions, ['date']);

    expect(output).toContain('Uber Trip');
    expect(output).toContain('Main Checking');
  });

  it('shows credit, debit, and balance totals on group headers', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedTransaction(db, {
      id: 'tx-1',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-01T15:00:00.000Z',
      amountCents: -1000,
      merchantName: 'Expense',
      rawJson: {},
    });
    seedTransaction(db, {
      id: 'tx-2',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-01T16:00:00.000Z',
      amountCents: 5000,
      merchantName: 'Income',
      rawJson: {},
    });

    const transactions = listEnrichedTransactions(
      db,
      {
        status: 'all',
        accountIds: 'all',
        categoryIds: 'all',
        merchantPattern: null,
        paymentTypes: 'all',
        startDate: null,
        endDate: null,
      },
      'UTC',
    );
    const output = renderTransactionsTree(transactions, ['date']);

    expect(output).toContain('2026-06-01');
    expect(output).toMatch(/\+R\$\u00a050,00/);
    expect(output).toMatch(/-R\$\u00a010,00/);
    expect(output).toMatch(/R\$\u00a040,00/);
  });

  it('serializes db, parsed, and raw_json sections for debugging', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedTransaction(db, {
      id: 'tx-1',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-01T15:00:00.000Z',
      amountCents: -1000,
      merchantName: 'Uber Trip',
      categoryId: 'transport',
      categoryOriginalName: 'Transport',
      paymentType: 'PIX',
    });

    const [transaction] = listEnrichedTransactions(
      db,
      {
        status: 'all',
        accountIds: 'all',
        categoryIds: 'all',
        merchantPattern: null,
        paymentTypes: 'all',
        startDate: null,
        endDate: null,
      },
      'UTC',
    );
    if (!transaction) {
      throw new Error('expected seeded transaction');
    }

    const json = serializeTransactionForJson(transaction);
    expect(json['parsed']).toMatchObject({
      display_name: 'Uber Trip',
      category_original_name: 'Transport',
      category_display_name: 'Transport',
      installment_number: 2,
      total_installments: 6,
    });
  });

  it('shows original category names when translation is disabled', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedTransaction(db, {
      id: 'tx-1',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-01T15:00:00.000Z',
      amountCents: -1000,
      merchantName: 'Uber Trip',
      categoryId: 'transport',
      categoryOriginalName: 'Transport',
      categoryTranslatedName: 'Transporte',
      paymentType: 'PIX',
    });

    const transactions = listEnrichedTransactions(
      db,
      {
        status: 'all',
        accountIds: 'all',
        categoryIds: 'all',
        merchantPattern: null,
        paymentTypes: 'all',
        startDate: null,
        endDate: null,
      },
      'UTC',
    );

    const translated = renderTransactionsTree(transactions, ['date'], { translateCategory: true });
    const original = renderTransactionsTree(transactions, ['date'], { translateCategory: false });

    expect(translated).toContain('Transporte');
    expect(original).toContain('Transport');
    expect(original).not.toContain('Transporte');
  });

  it('uses classify annotation notes as display_description', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    seedTransaction(db, {
      id: 'tx-1',
      accountId: 'acc-1',
      itemId: 'item-1',
      occurredAt: '2026-06-01T15:00:00.000Z',
      amountCents: -1000,
      merchantName: 'Shop',
      description: 'Original bank text',
    });

    const { saveEntryAnnotation } = await import('../src/annotation/store.js');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-1',
      notes: 'Annotated summary',
      source: 'manual',
    });

    const [transaction] = listEnrichedTransactions(
      db,
      {
        status: 'all',
        accountIds: 'all',
        categoryIds: 'all',
        merchantPattern: null,
        paymentTypes: 'all',
        startDate: null,
        endDate: null,
      },
      'UTC',
    );

    expect(transaction?.description).toBe('Original bank text');
    expect(transaction?.display_description).toBe('Annotated summary');
  });

  it('derives local date keys from occurred_at using the configured timezone', () => {
    expect(toLocalDateKey('2026-06-01T02:30:00.000Z', 'America/Sao_Paulo')).toBe('2026-05-31');
  });
});
