import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { runAssistPrecompute } from '../src/annotation/assist-precompute.js';
import { countPendingAssistSuggestions } from '../src/annotation/pending-assist-suggestions.js';
import { ensureAnnotationLabel, saveEntryAnnotation } from '../src/annotation/store.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { upsertTransactionCategoryOverride } from '../src/db/transaction-category-overrides.js';

vi.mock('../src/scoring/providers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/scoring/providers.js')>();
  return {
    ...actual,
    embedScoringText: vi.fn(async () => ({
      vector: [1, 0, 0],
      dimensions: 3,
      model: 'test:mock',
    })),
    proposeAnnotationFromExamples: vi.fn(async () => null),
  };
});

const config = {
  annotation: {
    similarityThreshold: 0.8,
    embedding: { provider: 'test', model: 'mock' },
    classifier: { provider: 'test', model: 'mock' },
  },
} as import('../src/types.js').ResolvedAppConfig;

function seedAccount(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
     VALUES ('acct-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
}

describe('runAssistPrecompute', () => {
  it('stores merchant-match suggestions for unannotated transactions', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);

    db.prepare(
      `INSERT INTO categories (id, name, parent_id, parent_name, raw_json, synced_at)
       VALUES ('07000000', 'Services', NULL, NULL, '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (
        'tx-prev', 'acct-1', '2026-03-10T12:00:00.000Z', -4990, 'BRL', 'Streaming', 'NETFLIX.COM', '05000000',
        '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();
    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
      ) VALUES (
        'tx-target', 'acct-1', '2026-06-10T12:00:00.000Z', -4990, 'BRL', 'Streaming', 'NETFLIX COM', '05000000',
        '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();

    const label = ensureAnnotationLabel(db, 'Streaming');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-prev',
      labelIds: [label.id],
      source: 'manual',
      embedding: config.annotation.embedding,
    });
    await upsertTransactionCategoryOverride(db, 'tx-prev', '07000000');

    const summary = await runAssistPrecompute(db, config);
    expect(summary.ok).toBe(1);
    expect(countPendingAssistSuggestions(db)).toBe(1);
  });

  it('clears and recomputes existing suggestions when clearPending is enabled', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);

    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, raw_json, synced_at
      ) VALUES (
        'tx-1', 'acct-1', '2026-06-10T12:00:00.000Z', -1000, 'BRL', 'Coffee', 'CAFE', '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();

    db.prepare(
      `INSERT INTO annotation_assist_suggestions (
        entry_type, entry_id, status, proposal_json, examples_json, confidence,
        used_classifier, embedding_model, classifier_model, computed_at, review_status, algorithm_version
      ) VALUES (
        'transaction', 'tx-1', 'ok', '{"labelNames":["Old"]}', '[]', 0.9, 0, 'm', 'm', '2020-01-01', 'pending', 2
      )`,
    ).run();

    const summary = await runAssistPrecompute(db, config, { clearPending: true });
    expect(summary.cleared).toBe(1);
    expect(summary.total).toBe(1);
  });

  it('skips transactions that already have pending suggestions by default', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedAccount(db);

    db.prepare(
      `INSERT INTO transactions (
        id, account_id, occurred_at, amount_cents, currency, description, merchant_name, raw_json, synced_at
      ) VALUES (
        'tx-1', 'acct-1', '2026-06-10T12:00:00.000Z', -1000, 'BRL', 'Coffee', 'CAFE', '{}', '2026-06-10T00:00:00.000Z'
      )`,
    ).run();

    db.prepare(
      `INSERT INTO annotation_assist_suggestions (
        entry_type, entry_id, status, proposal_json, examples_json, confidence,
        used_classifier, embedding_model, classifier_model, computed_at, review_status, algorithm_version
      ) VALUES (
        'transaction', 'tx-1', 'ok', '{"labelNames":["Old"]}', '[]', 0.9, 0, 'm', 'm', '2020-01-01', 'pending', 2
      )`,
    ).run();

    const summary = await runAssistPrecompute(db, config);
    expect(summary.cleared).toBe(0);
    expect(summary.skippedExisting).toBe(1);
    expect(summary.total).toBe(1);
  });
});
