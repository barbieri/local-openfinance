import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { applyAssistSuggestion } from '../src/annotation/apply-suggestion.js';
import { resolveStoredCategorySelectId } from '../src/db/category-select-id.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { formatSqliteUserMessage, runSql, SqliteQueryError } from '../src/db/sqlite-query.js';
import { upsertTransactionCategoryOverride } from '../src/db/transaction-category-overrides.js';

describe('resolveStoredCategorySelectId', () => {
  it('strips only-category filter prefix before persistence', () => {
    expect(resolveStoredCategorySelectId('only:renda')).toBe('renda');
    expect(resolveStoredCategorySelectId('renda')).toBe('renda');
    expect(resolveStoredCategorySelectId('')).toBeNull();
    expect(resolveStoredCategorySelectId(null)).toBeNull();
  });
});

describe('sqlite-query', () => {
  it('logs and wraps sqlite failures with sql and params', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE items (id TEXT PRIMARY KEY)');

    expect(() => runSql(db, 'INSERT INTO items VALUES (?)', 'a')).not.toThrow();
    expect(() => runSql(db, 'INSERT INTO items VALUES (?)', 'a')).toThrow(SqliteQueryError);

    try {
      runSql(db, 'INSERT INTO items VALUES (?)', 'a');
    } catch (error) {
      expect(error).toBeInstanceOf(SqliteQueryError);
      const sqliteError = error as SqliteQueryError;
      expect(sqliteError.sql).toContain('INSERT INTO items');
      expect(sqliteError.params).toEqual(['a']);
      expect(formatSqliteUserMessage(sqliteError)).toContain('duplicate value');
    }
  });
});

describe('applyAssistSuggestion category override', () => {
  it('accepts only-category select values from the web UI', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    db.prepare(
      `INSERT INTO categories (id, name, name_translated, parent_id, parent_name, raw_json, synced_at)
       VALUES ('renda', 'Renda', 'Renda', NULL, NULL, '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
       VALUES ('item-1', '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
       VALUES ('acct-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
         id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
       ) VALUES ('tx-1', 'acct-1', '2026-06-01T12:00:00.000Z', -1000, 'BRL', 'Test', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO annotation_labels (id, name, icon, color, created_at)
       VALUES ('agricola', 'Agrícola', 'MdLabel', '#64748b', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO annotation_assist_suggestions (
         entry_type, entry_id, status, proposal_json, examples_json, confidence,
         used_classifier, computed_at, review_status
       ) VALUES ('transaction', ?, 'ok', '{}', '[]', 0.9, 0, '2026-06-10T00:00:00.000Z', 'pending')`,
    ).run('tx-1');

    await applyAssistSuggestion(
      db,
      'tx-1',
      {
        annotation: {},
      } as never,
      {
        categoryOverrideId: 'only:renda',
        categoryId: null,
        subCategoryId: null,
        labelIds: ['agricola'],
        labelNames: [],
        notes: null,
        reasoning: null,
      },
    );

    const override = db
      .prepare('SELECT category_id FROM transaction_category_overrides WHERE transaction_id = ?')
      .get('tx-1') as { readonly category_id: string };
    expect(override.category_id).toBe('renda');

    const labelCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM entry_annotation_labels eal
         JOIN entry_annotations ea ON ea.id = eal.annotation_id
         WHERE ea.entry_id = ?`,
      )
      .get('tx-1') as { readonly count: number };
    expect(labelCount.count).toBe(1);
  });

  it('rejects invalid category ids with a descriptive sqlite message', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    db.prepare(
      `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
       VALUES ('item-1', '601', 'Itaú', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
       VALUES ('acct-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
         id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
       ) VALUES ('tx-1', 'acct-1', '2026-06-01T12:00:00.000Z', -1000, 'BRL', 'Test', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    expect(() => upsertTransactionCategoryOverride(db, 'tx-1', 'only:missing-category')).toThrow(
      SqliteQueryError,
    );

    try {
      upsertTransactionCategoryOverride(db, 'tx-1', 'only:missing-category');
    } catch (error) {
      expect(formatSqliteUserMessage(error)).toContain('referenced record does not exist');
    }
  });
});
