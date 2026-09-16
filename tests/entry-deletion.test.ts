import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  appendDeletedVisibilityPredicate,
  normalizeDeleteReason,
  SoftDeleteTargetNotFoundError,
  softDeleteInvestment,
  softDeleteTransactions,
} from '../src/db/entry-deletion.js';
import { enrichInvestmentRow, loadInvestmentRowById } from '../src/db/investment-details.js';
import { serializeInvestmentForJson } from '../src/db/investments/present.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { enrichTransactionRow, loadTransactionRowById } from '../src/db/transaction-details.js';
import { serializeTransactionForJson } from '../src/db/transactions/present.js';
import type { OpenFinanceClient } from '../src/openfinance/client.js';
import { syncOpenFinanceData } from '../src/openfinance/sync/engine.js';

const FIRST_DELETE_AT = '2026-09-15T12:00:00.000Z';

describe('entry soft deletion', () => {
  it('applies migration 034 with deletion fields and indexes', () => {
    const db = createDatabase();

    expect(migrateDatabase(db)).toContain(34);
    expect(columnNames(db, 'transactions')).toEqual(
      expect.arrayContaining(['deleted_at', 'delete_reason']),
    );
    expect(columnNames(db, 'investments')).toEqual(
      expect.arrayContaining(['deleted_at', 'delete_reason']),
    );
    expect(indexNames(db, 'transactions')).toContain('idx_transactions_deleted_at');
    expect(indexNames(db, 'investments')).toContain('idx_investments_deleted_at');
  });

  it('builds explicit visibility predicates and normalizes optional reasons', () => {
    const hidden: string[] = [];
    appendDeletedVisibilityPredicate(hidden, 't.deleted_at', 'hide');
    const only: string[] = [];
    appendDeletedVisibilityPredicate(only, 'i.deleted_at', 'only');
    const all: string[] = [];
    appendDeletedVisibilityPredicate(all, 't.deleted_at', 'all');

    expect(hidden).toEqual(['t.deleted_at IS NULL']);
    expect(only).toEqual(['i.deleted_at IS NOT NULL']);
    expect(all).toEqual([]);
    expect(normalizeDeleteReason('  provider duplicate  ')).toBe('provider duplicate');
    expect(normalizeDeleteReason(' \n ')).toBeNull();
  });

  it('soft deletes explicit transactions without removing their data or relationships', () => {
    const db = seededDatabase();
    const transactionRaw = loadRawJson(db, 'transactions', 'transaction-1');
    const investmentRaw = loadRawJson(db, 'investments', 'investment-1');

    const result = softDeleteTransactions(db, {
      transactionId: 'transaction-1',
      additionalTransactionIds: ['transaction-2', 'transaction-1'],
      deleteReason: '  provider duplicate  ',
      deletedAt: FIRST_DELETE_AT,
    });

    expect(result).toEqual({
      requestedIds: ['transaction-1', 'transaction-2'],
      newlyDeletedIds: ['transaction-1', 'transaction-2'],
      alreadyDeletedIds: [],
    });
    expect(loadDeletionMetadata(db, 'transactions', 'transaction-1')).toEqual({
      deleted_at: FIRST_DELETE_AT,
      delete_reason: 'provider duplicate',
    });
    expect(loadRawJson(db, 'transactions', 'transaction-1')).toBe(transactionRaw);
    expect(loadRawJson(db, 'investments', 'investment-1')).toBe(investmentRaw);
    expect(countRows(db, 'entry_annotations', 'entry_id', 'transaction-1')).toBe(1);
    expect(countRows(db, 'transfer_group_members', 'entry_id', 'transaction-1')).toBe(1);
    expect(countRows(db, 'investment_transactions', 'investment_id', 'investment-1')).toBe(1);

    const transaction = loadTransactionRowById(db, 'transaction-1');
    const investment = loadInvestmentRowById(db, 'investment-1');
    if (!transaction || !investment) {
      throw new Error('Expected seeded entries to remain available by id');
    }
    expect(transaction.deleted_at).toBe(FIRST_DELETE_AT);
    expect(transaction.delete_reason).toBe('provider duplicate');
    expect(investment.deleted_at).toBeNull();
    expect(serializeTransactionForJson(enrichTransactionRow(db, transaction))['db']).toMatchObject({
      deleted_at: FIRST_DELETE_AT,
      delete_reason: 'provider duplicate',
    });
    expect(serializeInvestmentForJson(enrichInvestmentRow(db, investment))['db']).toMatchObject({
      deleted_at: null,
      delete_reason: null,
    });
  });

  it('keeps the initial timestamp and reason when a delete request is retried', () => {
    const db = seededDatabase();
    const investmentRaw = loadRawJson(db, 'investments', 'investment-1');
    softDeleteInvestment(db, {
      investmentId: 'investment-1',
      deleteReason: '  migrated account  ',
      deletedAt: FIRST_DELETE_AT,
    });

    const retry = softDeleteInvestment(db, {
      investmentId: 'investment-1',
      deleteReason: 'replacement reason',
      deletedAt: '2026-09-16T12:00:00.000Z',
    });

    expect(retry).toEqual({
      requestedIds: ['investment-1'],
      newlyDeletedIds: [],
      alreadyDeletedIds: ['investment-1'],
    });
    expect(loadDeletionMetadata(db, 'investments', 'investment-1')).toEqual({
      deleted_at: FIRST_DELETE_AT,
      delete_reason: 'migrated account',
    });
    expect(loadRawJson(db, 'investments', 'investment-1')).toBe(investmentRaw);
    expect(countRows(db, 'investment_transactions', 'investment_id', 'investment-1')).toBe(1);
    expect(loadInvestmentRowById(db, 'investment-1')).toMatchObject({
      deleted_at: FIRST_DELETE_AT,
      delete_reason: 'migrated account',
    });
  });

  it('does not partially delete selected transactions when the anchor is missing', () => {
    const db = seededDatabase();

    expect(() =>
      softDeleteTransactions(db, {
        transactionId: 'missing-transaction',
        additionalTransactionIds: ['transaction-1'],
        deletedAt: FIRST_DELETE_AT,
      }),
    ).toThrow(SoftDeleteTargetNotFoundError);
    expect(loadDeletionMetadata(db, 'transactions', 'transaction-1').deleted_at).toBeNull();
  });

  it('rejects blank required anchors without committing a deletion', () => {
    const db = seededDatabase();

    expect(() =>
      softDeleteTransactions(db, {
        transactionId: '  ',
        additionalTransactionIds: ['transaction-1'],
        deletedAt: FIRST_DELETE_AT,
      }),
    ).toThrow(SoftDeleteTargetNotFoundError);
    expect(() =>
      softDeleteInvestment(db, {
        investmentId: '\n',
        deletedAt: FIRST_DELETE_AT,
      }),
    ).toThrow(SoftDeleteTargetNotFoundError);
    expect(loadDeletionMetadata(db, 'transactions', 'transaction-1').deleted_at).toBeNull();
    expect(loadDeletionMetadata(db, 'investments', 'investment-1').deleted_at).toBeNull();
  });

  it('preserves deletion metadata when the sync engine refreshes source fields', async () => {
    const db = seededDatabase();
    softDeleteTransactions(db, {
      transactionId: 'transaction-1',
      deleteReason: 'provider duplicate',
      deletedAt: FIRST_DELETE_AT,
    });
    softDeleteInvestment(db, {
      investmentId: 'investment-1',
      deleteReason: 'migrated account',
      deletedAt: FIRST_DELETE_AT,
    });

    await syncOpenFinanceData(db, syncClient(), {
      forceBeforeFetch: false,
      forceUpsert: true,
      connections: [],
      lookbackDays: 7,
      pageSize: 100,
    });

    expect(loadDeletionMetadata(db, 'transactions', 'transaction-1')).toEqual({
      deleted_at: FIRST_DELETE_AT,
      delete_reason: 'provider duplicate',
    });
    expect(loadDeletionMetadata(db, 'investments', 'investment-1')).toEqual({
      deleted_at: FIRST_DELETE_AT,
      delete_reason: 'migrated account',
    });
    expect(loadRawJson(db, 'transactions', 'transaction-1')).toContain('refreshed transaction');
    expect(loadRawJson(db, 'investments', 'investment-1')).toContain('refreshed investment');
  });
});

function createDatabase(): DatabaseSync {
  return new DatabaseSync(':memory:');
}

function seededDatabase(): DatabaseSync {
  const db = createDatabase();
  migrateDatabase(db);
  db.exec(`
    INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
    VALUES ('item-1', 'test', 'Test Bank', 'UPDATED', '{}', '2026-09-15T00:00:00.000Z');
    INSERT INTO accounts (
      id, connection_item_id, type, name, balance_cents, currency, raw_json, synced_at
    ) VALUES (
      'account-1', 'item-1', 'CHECKING', 'Checking', 10000, 'BRL', '{}', '2026-09-15T00:00:00.000Z'
    );
    INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
    ) VALUES
      ('transaction-1', 'account-1', '2026-09-15T10:00:00.000Z', -100, 'BRL', 'First', '{"source":"original transaction"}', '2026-09-15T00:00:00.000Z'),
      ('transaction-2', 'account-1', '2026-09-15T11:00:00.000Z', -200, 'BRL', 'Second', '{"source":"original transaction"}', '2026-09-15T00:00:00.000Z');
    INSERT INTO investments (
      id, connection_item_id, type, subtype, name, code, balance_cents, currency, raw_json, synced_at
    ) VALUES (
      'investment-1', 'item-1', 'FIXED_INCOME', 'CDB', 'Investment', 'CDB1', 10000, 'BRL', '{"source":"original investment"}', '2026-09-15T00:00:00.000Z'
    );
    INSERT INTO investment_transactions (
      id, investment_id, occurred_at, type, amount_cents, currency, raw_json, synced_at
    ) VALUES (
      'investment-transaction-1', 'investment-1', '2026-09-15T10:00:00.000Z', 'BUY', 10000, 'BRL', '{}', '2026-09-15T00:00:00.000Z'
    );
    INSERT INTO entry_annotations (
      id, entry_type, entry_id, source, created_at, updated_at
    ) VALUES (
      'annotation-1', 'transaction', 'transaction-1', 'manual', '2026-09-15T00:00:00.000Z', '2026-09-15T00:00:00.000Z'
    );
    INSERT INTO transfer_groups (id, kind, confidence, created_at)
    VALUES ('transfer-1', 'transfer', 1, '2026-09-15T00:00:00.000Z');
    INSERT INTO transfer_group_members (group_id, entry_type, entry_id)
    VALUES ('transfer-1', 'transaction', 'transaction-1');
  `);
  return db;
}

function syncClient(): OpenFinanceClient {
  const responses: Record<string, Record<string, unknown>> = {
    '/connections/list': {
      connections: [
        { item_id: 'item-1', connector_id: 'test', connector_name: 'Test Bank', status: 'UPDATED' },
      ],
    },
    '/categories/list': { results: [] },
    '/accounts/list': {
      results: [
        {
          id: 'account-1',
          type: 'CHECKING',
          name: 'Checking',
          balance: '100.00',
          currencyCode: 'BRL',
        },
      ],
    },
    '/investments/list': {
      results: [
        {
          id: 'investment-1',
          type: 'FIXED_INCOME',
          subtype: 'CDB',
          name: 'Investment',
          code: 'CDB1',
          balance: '100.00',
          description: 'refreshed investment',
          currencyCode: 'BRL',
        },
      ],
      totalPages: 1,
    },
    '/loans/list': { results: [] },
    '/transactions/list': {
      results: [
        {
          id: 'transaction-1',
          date: '2026-09-15T10:00:00.000Z',
          amount: '-1.00',
          description: 'refreshed transaction',
          currencyCode: 'BRL',
        },
      ],
      totalPages: 1,
    },
    '/investments/transactions/list': { results: [], totalPages: 1 },
  };
  return {
    post: async <T>(endpoint: string): Promise<T> => responses[endpoint] as T,
  } as unknown as OpenFinanceClient;
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ readonly name: string }>).map(
    (row) => row.name,
  );
}

function indexNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ readonly name: string }>).map(
    (row) => row.name,
  );
}

function loadDeletionMetadata(
  db: DatabaseSync,
  table: 'transactions' | 'investments',
  id: string,
): { readonly deleted_at: string | null; readonly delete_reason: string | null } {
  return db.prepare(`SELECT deleted_at, delete_reason FROM ${table} WHERE id = ?`).get(id) as {
    readonly deleted_at: string | null;
    readonly delete_reason: string | null;
  };
}

function loadRawJson(db: DatabaseSync, table: 'transactions' | 'investments', id: string): string {
  return (
    db.prepare(`SELECT raw_json FROM ${table} WHERE id = ?`).get(id) as {
      readonly raw_json: string;
    }
  ).raw_json;
}

function countRows(db: DatabaseSync, table: string, column: string, value: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(value) as {
      readonly count: number;
    }
  ).count;
}
