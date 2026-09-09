import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load-config.js';
import { linkAccounts } from '../src/db/account-links.js';
import { saveIntelligenceTaxonomyPolicy } from '../src/db/intelligence.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { resolveReportQueryScope } from '../src/intelligence/report-scope.js';
import { executeIntelligenceTool, IntelligenceToolError } from '../src/intelligence/tools.js';
import type { ResolvedConfig } from '../src/types.js';
import { BackgroundJobManager } from '../src/web/server/background-jobs.js';
import { createWebApp } from '../src/web/server/server.js';

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-08-16T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (
       id, connection_item_id, type, name, currency, raw_json, synced_at, balance_cents
     ) VALUES (
       'acct-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}',
       '2026-08-16T00:00:00.000Z', 100000
     )`,
  ).run();
  saveIntelligenceTaxonomyPolicy(db, {
    reportId: 'weekly',
    taxonomyHash: 'empty-test-policy',
    policyJson: '{"decisions":[]}',
  });
  return db;
}

function insertTransaction(
  db: DatabaseSync,
  id: string,
  occurredAt: string,
  amountCents: number,
): void {
  db.prepare(
    `INSERT INTO transactions (
       id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
     ) VALUES (?, 'acct-1', ?, ?, 'BRL', ?, '{}', '2026-08-16T00:00:00.000Z')`,
  ).run(id, occurredAt, amountCents, id);
}

async function scopedConfig(
  overrides: {
    readonly includeUnannotated?: boolean | undefined;
    readonly accountIds?: readonly string[] | undefined;
  } = {},
): Promise<ResolvedConfig> {
  const resolved = await loadConfig('examples/expenses-config.json');
  const weekly = resolved.config.reports[0];
  if (!weekly) {
    throw new Error('Weekly report fixture missing');
  }
  return {
    ...resolved,
    config: {
      ...resolved.config,
      reports: [
        {
          ...weekly,
          includeUnannotated: overrides.includeUnannotated ?? weekly.includeUnannotated,
          accountIds: overrides.accountIds ?? weekly.accountIds,
        },
      ],
    },
  };
}

describe('intelligence tools', () => {
  it('fails closed before a report taxonomy policy is initialized', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    insertTransaction(db, 'unreviewed-taxonomy', '2026-08-12T12:00:00.000Z', -50_000);
    db.prepare("DELETE FROM intelligence_taxonomy_policies WHERE report_id = 'weekly'").run();

    expect(() =>
      executeIntelligenceTool(
        {
          db,
          resolved,
          now: new Date('2026-08-21T12:00:00.000Z'),
          timeZone: 'UTC',
        },
        'weekly',
        'list_transactions',
        {},
      ),
    ).toThrow('Report taxonomy policy is not initialized');
  });

  it('resolves a stable named-report scope', async () => {
    const resolved = await scopedConfig();
    expect(
      resolveReportQueryScope(resolved, 'weekly', {
        now: new Date('2026-08-21T12:00:00.000Z'),
        timeZone: 'UTC',
      }),
    ).toMatchObject({
      report: { id: 'weekly' },
      period: { start: '2026-08-10', end: '2026-08-16' },
      timeZone: 'UTC',
    });
  });

  it('enforces the report period, amount floor, caps, and classification source', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    insertTransaction(db, 'large', '2026-08-12T12:00:00.000Z', -50_000);
    insertTransaction(db, 'small', '2026-08-12T13:00:00.000Z', -5_000);
    insertTransaction(db, 'outside', '2026-08-20T12:00:00.000Z', -70_000);
    db.prepare(
      `INSERT INTO annotation_assist_suggestions (
         entry_type, entry_id, status, proposal_json, examples_json, confidence,
         used_classifier, computed_at, review_status
       ) VALUES (
         'transaction', 'large', 'ok', '{"labelIds":["food"]}', '[]', 0.9,
         0, '2026-08-12T00:00:00.000Z', 'pending'
       )`,
    ).run();
    const ctx = {
      db,
      resolved,
      now: new Date('2026-08-21T12:00:00.000Z'),
      timeZone: 'UTC',
    };

    const response = executeIntelligenceTool(ctx, 'weekly', 'list_transactions', {
      limit: 50,
    }) as {
      readonly period: { readonly start: string; readonly end: string };
      readonly result: {
        readonly rows: readonly Record<string, unknown>[];
        readonly total: number;
        readonly cap: number;
      };
    };
    expect(response.period).toEqual({ start: '2026-08-10', end: '2026-08-16' });
    expect(response.result.total).toBe(1);
    expect(response.result.cap).toBe(50);
    expect(response.result.rows).toEqual([
      expect.objectContaining({
        id: 'large',
        classificationSource: 'suggestion',
        permalink: '#/transaction/large',
      }),
    ]);
    expect(JSON.stringify(response)).not.toContain('raw_json');

    expect(() =>
      executeIntelligenceTool(ctx, 'weekly', 'get_transaction', { id: 'small' }),
    ).toThrow(IntelligenceToolError);
    expect(() =>
      executeIntelligenceTool(ctx, 'weekly', 'list_transactions', { limit: 51 }),
    ).toThrow(/limit must be an integer/);
    expect(() =>
      executeIntelligenceTool(ctx, 'weekly', 'list_transactions', { surprise: true }),
    ).toThrow(/Unexpected tool argument/);
  });

  it('applies account and confirmed-annotation filters without crossing reports', async () => {
    const db = openDb();
    const resolved = await scopedConfig({ includeUnannotated: false, accountIds: ['acct-1'] });
    insertTransaction(db, 'confirmed', '2026-08-12T12:00:00.000Z', -50_000);
    insertTransaction(db, 'unannotated', '2026-08-12T13:00:00.000Z', -60_000);
    db.prepare(
      `INSERT INTO annotation_categories (id, name, created_at)
       VALUES ('food', 'Food', '2026-08-12T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO entry_annotations (
         id, entry_type, entry_id, category_id, source, created_at, updated_at
       ) VALUES (
         'annotation-1', 'transaction', 'confirmed', 'food', 'manual',
         '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
       )`,
    ).run();
    const ctx = {
      db,
      resolved,
      now: new Date('2026-08-21T12:00:00.000Z'),
      timeZone: 'UTC',
    };

    const response = executeIntelligenceTool(ctx, 'weekly', 'list_transactions', {}) as {
      readonly result: { readonly rows: readonly Record<string, unknown>[] };
    };
    expect(response.result.rows).toEqual([
      expect.objectContaining({ id: 'confirmed', classificationSource: 'confirmed' }),
    ]);
    expect(() => executeIntelligenceTool(ctx, 'unknown', 'memory', {})).toThrow(/Report not found/);
  });

  it('builds exact category period links without accepting unknown taxonomy ids', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    db.prepare(
      `INSERT INTO annotation_categories (id, name, created_at)
       VALUES ('food', 'Food', '2026-08-12T00:00:00.000Z')`,
    ).run();
    const ctx = {
      db,
      resolved,
      now: new Date('2026-08-21T12:00:00.000Z'),
      timeZone: 'UTC',
    };

    const response = executeIntelligenceTool(ctx, 'weekly', 'report_link', {
      kind: 'category',
      id: 'food',
    }) as { readonly result: { readonly href: string } };
    expect(response.result.href).toMatch(/^#\/transactions\/s=/u);
    expect(() =>
      executeIntelligenceTool(ctx, 'weekly', 'report_link', {
        kind: 'category',
        id: 'missing',
      }),
    ).toThrow('category not found');
  });

  it('rejects suggestion-only anchors from all transaction history tools', async () => {
    const db = openDb();
    const resolved = await scopedConfig({ includeUnannotated: false });
    insertTransaction(db, 'suggestion-anchor', '2026-08-12T12:00:00.000Z', -50_000);
    db.prepare(
      `INSERT INTO annotation_assist_suggestions (
         entry_type, entry_id, status, proposal_json, examples_json, confidence,
         used_classifier, computed_at, review_status
       ) VALUES (
         'transaction', 'suggestion-anchor', 'ok', '{"labelIds":["food"]}', '[]', 0.9,
         0, '2026-08-12T00:00:00.000Z', 'pending'
       )`,
    ).run();
    const ctx = {
      db,
      resolved,
      now: new Date('2026-08-21T12:00:00.000Z'),
      timeZone: 'UTC',
    };

    expect(() =>
      executeIntelligenceTool(ctx, 'weekly', 'get_transaction', { id: 'suggestion-anchor' }),
    ).toThrow(IntelligenceToolError);
    expect(() =>
      executeIntelligenceTool(ctx, 'weekly', 'investigate_transaction_history', {
        transactionId: 'suggestion-anchor',
      }),
    ).toThrow(IntelligenceToolError);
    expect(() =>
      executeIntelligenceTool(ctx, 'weekly', 'aggregate_classification_history', {
        transactionId: 'suggestion-anchor',
        dimension: 'label',
      }),
    ).toThrow(IntelligenceToolError);
  });

  it('aggregates anchor labels across history without accepting caller ids', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    insertTransaction(db, 'anchor-label', '2026-08-12T12:00:00.000Z', -50_000);
    insertTransaction(db, 'historical-label', '2026-07-12T12:00:00.000Z', -70_000);
    db.prepare(
      `INSERT INTO annotation_labels (id, name, created_at)
       VALUES ('recurring', 'Recurring', '2026-07-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO annotation_labels (id, name, created_at)
       VALUES ('incidental', 'Incidental', '2026-07-01T00:00:00.000Z')`,
    ).run();
    for (const id of ['anchor-label', 'historical-label']) {
      db.prepare(
        `INSERT INTO entry_annotations (
           id, entry_type, entry_id, source, created_at, updated_at
         ) VALUES (?, 'transaction', ?, 'manual', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`,
      ).run(`annotation-${id}`, id);
      db.prepare(
        `INSERT INTO entry_annotation_labels (annotation_id, label_id, created_at)
         VALUES (?, 'recurring', '2026-07-01T00:00:00.000Z')`,
      ).run(`annotation-${id}`);
    }
    db.prepare(
      `INSERT INTO entry_annotation_labels (annotation_id, label_id, created_at)
       VALUES ('annotation-historical-label', 'incidental', '2026-07-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (
         id, connection_item_id, type, name, currency, raw_json, synced_at, balance_cents
       ) VALUES (
         'acct-usd', 'item-1', 'BANK', 'USD account', 'USD', '{}',
         '2026-08-16T00:00:00.000Z', 100000
       )`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
         id, account_id, occurred_at, amount_cents, amount_in_account_currency_cents,
         currency, description, raw_json, synced_at
       ) VALUES (
         'historical-foreign', 'acct-usd', '2026-07-13T12:00:00.000Z', -10000, -12000,
         'EUR', 'Foreign historical', '{}', '2026-08-16T00:00:00.000Z'
       )`,
    ).run();
    db.prepare(
      `INSERT INTO entry_annotations (
         id, entry_type, entry_id, source, created_at, updated_at
       ) VALUES (
         'annotation-historical-foreign', 'transaction', 'historical-foreign', 'manual',
         '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
       )`,
    ).run();
    db.prepare(
      `INSERT INTO entry_annotation_labels (annotation_id, label_id, created_at)
       VALUES ('annotation-historical-foreign', 'recurring', '2026-07-01T00:00:00.000Z')`,
    ).run();
    const ctx = {
      db,
      resolved,
      now: new Date('2026-08-21T12:00:00.000Z'),
      timeZone: 'UTC',
    };

    const response = executeIntelligenceTool(ctx, 'weekly', 'aggregate_classification_history', {
      transactionId: 'anchor-label',
      dimension: 'label',
    }) as {
      readonly result: {
        readonly rows: readonly Record<string, unknown>[];
        readonly keys: readonly string[];
      };
    };
    expect(response.result.keys).toEqual(['recurring']);
    expect(response.result.rows).toEqual([
      expect.objectContaining({
        key: 'recurring',
        transactionCount: 2,
        totalCents: 120_000,
        currency: 'BRL',
      }),
      expect.objectContaining({
        key: 'recurring',
        transactionCount: 1,
        totalCents: 12_000,
        currency: 'USD',
      }),
    ]);
    expect(() =>
      executeIntelligenceTool(ctx, 'weekly', 'aggregate_classification_history', {
        transactionId: 'anchor-label',
        dimension: 'label',
        labelId: 'recurring',
      }),
    ).toThrow(/Unexpected tool argument/);
  });

  it('caps aggregate dimension keys and grouped rows with an explicit truncation flag', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    insertTransaction(db, 'many-label-anchor', '2026-08-12T12:00:00.000Z', -50_000);
    db.prepare(
      `INSERT INTO entry_annotations (
         id, entry_type, entry_id, source, created_at, updated_at
       ) VALUES (
         'many-label-annotation', 'transaction', 'many-label-anchor', 'manual',
         '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
       )`,
    ).run();
    for (let index = 0; index < 51; index += 1) {
      const labelId = `many-label-${index}`;
      db.prepare(
        `INSERT INTO annotation_labels (id, name, created_at)
         VALUES (?, ?, '2026-08-12T00:00:00.000Z')`,
      ).run(labelId, labelId);
      db.prepare(
        `INSERT INTO entry_annotation_labels (annotation_id, label_id, created_at)
         VALUES ('many-label-annotation', ?, '2026-08-12T00:00:00.000Z')`,
      ).run(labelId);
    }

    const response = executeIntelligenceTool(
      {
        db,
        resolved,
        now: new Date('2026-08-21T12:00:00.000Z'),
        timeZone: 'UTC',
      },
      'weekly',
      'aggregate_classification_history',
      { transactionId: 'many-label-anchor', dimension: 'label' },
    ) as {
      readonly result: {
        readonly keys: readonly string[];
        readonly rows: readonly Record<string, unknown>[];
        readonly cap: number;
        readonly truncated: boolean;
      };
    };
    expect(response.result.cap).toBe(50);
    expect(response.result.keys).toHaveLength(50);
    expect(response.result.rows).toHaveLength(50);
    expect(response.result.truncated).toBe(true);
  });

  it('uses credit-card purchase dates for historical aggregate bounds', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    insertTransaction(db, 'purchase-date-anchor', '2026-08-12T12:00:00.000Z', -50_000);
    db.prepare(
      `UPDATE transactions SET category_id = 'food' WHERE id = 'purchase-date-anchor'`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
         id, account_id, occurred_at, amount_cents, currency, description, category_id,
         raw_json, synced_at
       ) VALUES (
         'purchase-date-history', 'acct-1', '2026-07-20T12:00:00.000Z', -60_000, 'BRL',
         'Purchase date history', 'food',
         '{"creditCardMetadata":{"purchaseDate":"2026-06-01"}}',
         '2026-08-16T00:00:00.000Z'
       )`,
    ).run();

    const response = executeIntelligenceTool(
      {
        db,
        resolved,
        now: new Date('2026-08-21T12:00:00.000Z'),
        timeZone: 'UTC',
      },
      'weekly',
      'aggregate_classification_history',
      { transactionId: 'purchase-date-anchor', dimension: 'category' },
    ) as {
      readonly result: { readonly rows: readonly Record<string, unknown>[] };
    };
    expect(response.result.rows).toEqual([
      expect.objectContaining({
        key: 'food',
        firstDate: '2026-06-01',
        lastDate: '2026-08-12T12:00:00.000Z',
      }),
    ]);
  });

  it('uses local annotation subcategory before Open Finance category for history', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    insertTransaction(db, 'local-category-anchor', '2026-08-12T12:00:00.000Z', -50_000);
    insertTransaction(db, 'local-category-history', '2026-07-12T12:00:00.000Z', -60_000);
    db.prepare(
      `UPDATE transactions SET category_id = 'open-finance-food'
       WHERE id IN ('local-category-anchor', 'local-category-history')`,
    ).run();
    db.prepare(
      `INSERT INTO annotation_categories (id, name, parent_id, created_at)
       VALUES
         ('local-food', 'Local food', NULL, '2026-08-12T00:00:00.000Z'),
         ('local-groceries', 'Local groceries', 'local-food', '2026-08-12T00:00:00.000Z')`,
    ).run();
    for (const id of ['local-category-anchor', 'local-category-history']) {
      db.prepare(
        `INSERT INTO entry_annotations (
           id, entry_type, entry_id, category_id, sub_category_id, source, created_at, updated_at
         ) VALUES (?, 'transaction', ?, 'local-food', 'local-groceries', 'manual',
                   '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z')`,
      ).run(`annotation-${id}`, id);
    }
    const response = executeIntelligenceTool(
      {
        db,
        resolved,
        now: new Date('2026-08-21T12:00:00.000Z'),
        timeZone: 'UTC',
      },
      'weekly',
      'aggregate_classification_history',
      { transactionId: 'local-category-anchor', dimension: 'category' },
    ) as {
      readonly result: {
        readonly keys: readonly string[];
        readonly rows: readonly Record<string, unknown>[];
      };
    };
    expect(response.result.keys).toEqual(['local-groceries']);
    expect(response.result.rows).toEqual([
      expect.objectContaining({ key: 'local-groceries', transactionCount: 2 }),
    ]);
  });

  it('separates same-account recurrence from shared-counterparty recurrence', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    insertTransaction(db, 'history-anchor', '2026-08-12T12:00:00.000Z', -50_000);
    insertTransaction(db, 'history-peer', '2026-07-12T12:00:00.000Z', -60_000);
    insertTransaction(db, 'future-peer', '2026-08-22T12:00:00.000Z', -70_000);
    db.prepare(
      `UPDATE transactions
       SET receiver_document_key = 'cnpj:11222333000181'
       WHERE id IN ('history-anchor', 'history-peer', 'future-peer')`,
    ).run();
    const response = executeIntelligenceTool(
      {
        db,
        resolved,
        now: new Date('2026-08-21T12:00:00.000Z'),
        timeZone: 'UTC',
      },
      'weekly',
      'investigate_transaction_history',
      { transactionId: 'history-anchor' },
    ) as {
      readonly result: { readonly rows: readonly Record<string, unknown>[] };
    };
    expect(response.result.rows).toEqual([
      expect.objectContaining({
        id: 'history-peer',
        sameAccount: true,
        sharedCounterparty: true,
      }),
    ]);
  });

  it('filters every structurally linked internal transfer and paginates peers', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    db.prepare(
      `INSERT INTO accounts (
         id, connection_item_id, type, name, currency, raw_json, synced_at, balance_cents
       ) VALUES (
         'acct-2', 'item-1', 'BANK', 'Second checking', 'BRL', '{}',
         '2026-08-16T00:00:00.000Z', 100000
       )`,
    ).run();
    insertTransaction(db, 'history-anchor', '2026-08-12T12:00:00.000Z', -50_000);
    insertTransaction(db, 'same-account-transfer', '2026-07-10T12:00:00.000Z', -20_000);
    db.prepare(
      `INSERT INTO transactions (
         id, account_id, occurred_at, amount_cents, currency, description,
         receiver_document_key, merchant_document_key, raw_json, synced_at
       ) VALUES
         ('cross-peer-later', 'acct-2', '2026-07-15T12:00:00.000Z', -60_000, 'BRL',
          'Cross peer later', 'cnpj:11222333000181', NULL, '{}', '2026-08-16T00:00:00.000Z'),
         ('cross-peer-earlier', 'acct-2', '2026-07-14T12:00:00.000Z', -60_000, 'BRL',
          'Cross peer earlier', 'cnpj:11222333000181', NULL, '{}', '2026-08-16T00:00:00.000Z'),
         ('cross-merchant', 'acct-2', '2026-07-13T12:00:00.000Z', -70_000, 'BRL',
          'Cross merchant', NULL, 'cnpj:60980129000181', '{}', '2026-08-16T00:00:00.000Z'),
         ('cross-self-transfer', 'acct-2', '2026-07-12T12:00:00.000Z', -80_000, 'BRL',
          'Cross self transfer', 'cnpj:11222333000181', NULL, '{}', '2026-08-16T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `UPDATE transactions
       SET receiver_document_key = 'cnpj:11222333000181',
           merchant_document_key = 'cnpj:60980129000181'
       WHERE id = 'history-anchor'`,
    ).run();
    db.prepare(
      `INSERT INTO transfer_groups (id, kind, confidence, created_at)
       VALUES ('self-transfer-group', 'internal_transfer', 1, '2026-08-16T00:00:00.000Z')`,
    ).run();
    for (const id of ['same-account-transfer', 'cross-self-transfer']) {
      db.prepare(
        `INSERT INTO transfer_group_members (group_id, entry_type, entry_id, role)
         VALUES ('self-transfer-group', 'transaction', ?, NULL)`,
      ).run(id);
    }

    const context = {
      db,
      resolved,
      now: new Date('2026-08-21T12:00:00.000Z'),
      timeZone: 'UTC',
    };
    const fullResponse = executeIntelligenceTool(
      context,
      'weekly',
      'investigate_transaction_history',
      { transactionId: 'history-anchor', limit: 50 },
    ) as {
      readonly result: {
        readonly rows: readonly Record<string, unknown>[];
        readonly total: number;
      };
    };
    expect(fullResponse.result.total).toBe(3);
    expect(fullResponse.result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cross-peer-later',
          sameAccount: false,
          sharedCounterparty: true,
        }),
        expect.objectContaining({
          id: 'cross-merchant',
          sameAccount: false,
          sharedCounterparty: true,
        }),
      ]),
    );
    expect(fullResponse.result.rows.some((row) => row['id'] === 'same-account-transfer')).toBe(
      false,
    );
    expect(fullResponse.result.rows.some((row) => row['id'] === 'cross-self-transfer')).toBe(false);

    const pagedResponse = executeIntelligenceTool(
      context,
      'weekly',
      'investigate_transaction_history',
      { transactionId: 'history-anchor', limit: 1, offset: 1 },
    ) as {
      readonly result: {
        readonly rows: readonly Record<string, unknown>[];
        readonly total: number;
      };
    };
    expect(pagedResponse.result.total).toBe(3);
    expect(pagedResponse.result.rows).toEqual([
      expect.objectContaining({ id: 'cross-peer-earlier' }),
    ]);

    expect(() =>
      executeIntelligenceTool(context, 'weekly', 'get_transaction', {
        id: 'same-account-transfer',
      }),
    ).toThrow(IntelligenceToolError);
  });

  it('excludes semantically internal transactions from direct and aggregate tools', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    db.prepare(
      `INSERT INTO annotation_categories (id, name, parent_id, created_at)
       VALUES ('purchases', 'Compras', NULL, '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO annotation_labels (id, name, parent_id, created_at)
       VALUES ('own-transfer', 'Transferência entre contas', NULL, '2026-01-01T00:00:00.000Z')`,
    ).run();
    for (const [id, date, amount] of [
      ['reportable-anchor', '2026-08-12T12:00:00.000Z', -50_000],
      ['reportable-history', '2026-07-12T12:00:00.000Z', -40_000],
      ['semantic-internal', '2026-07-13T12:00:00.000Z', -900_000],
    ] as const) {
      insertTransaction(db, id, date, amount);
      db.prepare(
        `INSERT INTO entry_annotations (
           id, entry_type, entry_id, category_id, source, created_at, updated_at
         ) VALUES (?, 'transaction', ?, 'purchases', 'manual', '2026-08-16T00:00:00.000Z',
                   '2026-08-16T00:00:00.000Z')`,
      ).run(`annotation-${id}`, id);
    }
    db.prepare(
      `INSERT INTO entry_annotation_labels (annotation_id, label_id, created_at)
       VALUES ('annotation-semantic-internal', 'own-transfer', '2026-08-16T00:00:00.000Z')`,
    ).run();
    saveIntelligenceTaxonomyPolicy(db, {
      reportId: 'weekly',
      taxonomyHash: 'test-policy',
      policyJson: JSON.stringify({
        decisions: [
          {
            kind: 'label',
            id: 'own-transfer',
            path: 'Transferência entre contas',
            treatment: 'internal-own-account',
            confidence: 1,
            reason: 'Descriptive own-account label.',
          },
        ],
      }),
    });
    const context = {
      db,
      resolved,
      now: new Date('2026-08-21T12:00:00.000Z'),
      timeZone: 'UTC',
    };

    expect(() =>
      executeIntelligenceTool(context, 'weekly', 'get_transaction', {
        id: 'semantic-internal',
      }),
    ).toThrow(IntelligenceToolError);
    const aggregate = executeIntelligenceTool(
      context,
      'weekly',
      'aggregate_classification_history',
      { transactionId: 'reportable-anchor', dimension: 'category' },
    ) as {
      readonly result: {
        readonly rows: ReadonlyArray<{
          readonly transactionCount: number;
          readonly totalCents: number;
        }>;
      };
    };
    expect(aggregate.result.rows).toEqual([
      expect.objectContaining({ transactionCount: 2, totalCents: 90_000 }),
    ]);
  });

  it('rejects direct lookup of transactions on merged account aliases', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    db.prepare(
      `INSERT INTO accounts (
         id, connection_item_id, type, name, currency, raw_json, synced_at, balance_cents
       ) VALUES (
         'acct-alias', 'item-1', 'BANK', 'Merged alias', 'BRL', '{}',
         '2026-08-16T00:00:00.000Z', 100000
       )`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
         id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
       ) VALUES (
         'hidden-alias-transaction', 'acct-alias', '2026-08-12T12:00:00.000Z', -50000,
         'BRL', 'Hidden alias transaction', '{}', '2026-08-16T00:00:00.000Z'
       )`,
    ).run();
    linkAccounts(db, 'acct-1', ['acct-alias']);
    const ctx = {
      db,
      resolved,
      now: new Date('2026-08-21T12:00:00.000Z'),
      timeZone: 'UTC',
    };

    const listed = executeIntelligenceTool(ctx, 'weekly', 'list_transactions', {}) as {
      readonly result: { readonly rows: readonly Record<string, unknown>[] };
    };
    expect(listed.result.rows).toEqual([]);
    expect(() =>
      executeIntelligenceTool(ctx, 'weekly', 'get_transaction', {
        id: 'hidden-alias-transaction',
      }),
    ).toThrow(IntelligenceToolError);
  });

  it('does not widen an account allow-list to connection-only holdings', async () => {
    const db = openDb();
    const resolved = await scopedConfig({ accountIds: ['acct-1'] });
    db.prepare(
      `INSERT INTO investments (
         id, connection_item_id, name, balance_cents, currency, raw_json, synced_at
       ) VALUES (
         'connection-investment', 'item-1', 'Connection holding', 50000, 'BRL', '{}',
         '2026-08-16T00:00:00.000Z'
       )`,
    ).run();
    db.prepare(
      `INSERT INTO loans (
         id, connection_item_id, type, outstanding_balance_cents, currency, raw_json, synced_at
       ) VALUES (
         'connection-loan', 'item-1', 'PERSONAL', 30000, 'BRL', '{}',
         '2026-08-16T00:00:00.000Z'
       )`,
    ).run();
    const ctx = {
      db,
      resolved,
      now: new Date('2026-08-21T12:00:00.000Z'),
      timeZone: 'UTC',
    };

    for (const toolName of ['list_investments', 'list_loans'] as const) {
      const response = executeIntelligenceTool(ctx, 'weekly', toolName, {}) as {
        readonly result: { readonly rows: readonly Record<string, unknown>[] };
      };
      expect(response.result.rows, toolName).toEqual([]);
    }
  });

  it('exposes the authenticated HTTP tool route and rejects unknown tools', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] = 'test-token';
    const app = createWebApp({ db, resolved, jobs: new BackgroundJobManager() });
    const headers = {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    };

    const response = await app.request('/api/intelligence/tools/list_accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ reportId: 'weekly', args: {} }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reportId: 'weekly',
      result: { rows: [{ id: 'acct-1' }], cap: 50 },
    });

    const unknown = await app.request('/api/intelligence/tools/nope', {
      method: 'POST',
      headers,
      body: JSON.stringify({ reportId: 'weekly', args: {} }),
    });
    expect(unknown.status).toBe(404);
  });

  it('limits credit-card bills to non-null due dates in the report window', async () => {
    const db = openDb();
    const resolved = await scopedConfig();
    db.prepare(
      `INSERT INTO accounts (
         id, connection_item_id, type, name, currency, raw_json, synced_at, balance_cents
       ) VALUES (
         'card-1', 'item-1', 'CREDIT', 'Card', 'BRL', '{}',
         '2026-08-16T00:00:00.000Z', 0
       )`,
    ).run();
    const insertBill = db.prepare(
      `INSERT INTO credit_card_bills (
         id, account_id, due_date, total_amount_cents, currency, raw_json, synced_at
       ) VALUES (?, 'card-1', ?, 50000, 'BRL', '{}', '2026-08-16T00:00:00.000Z')`,
    );
    insertBill.run('inside', '2026-08-12');
    insertBill.run('outside', '2026-08-20');
    insertBill.run('undated', null);

    const response = executeIntelligenceTool(
      {
        db,
        resolved,
        now: new Date('2026-08-21T12:00:00.000Z'),
        timeZone: 'UTC',
      },
      'weekly',
      'list_credit_card_bills',
      {},
    ) as { readonly result: { readonly rows: readonly Record<string, unknown>[] } };
    expect(response.result.rows).toEqual([expect.objectContaining({ id: 'inside' })]);
  });
});
