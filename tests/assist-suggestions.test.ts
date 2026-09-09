import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  applyAssistSuggestion,
  dismissAssistSuggestion,
} from '../src/annotation/apply-suggestion.js';
import type { AnnotationAssistExample } from '../src/annotation/assist-contract.js';
import { runAssistPrecompute } from '../src/annotation/assist-precompute.js';
import { listTriageQueue, upsertAssistSuggestion } from '../src/annotation/assist-suggestions.js';
import {
  countPendingAssistSuggestions,
  listPendingAssistSuggestionDigestRows,
  listPendingAssistSuggestionEntryIds,
  listPendingAssistSuggestionRows,
} from '../src/annotation/pending-assist-suggestions.js';
import { ensureAnnotationLabel, saveEntryAnnotation } from '../src/annotation/store.js';
import { migrateDatabase } from '../src/db/migrate.js';

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

function seedTransaction(db: DatabaseSync, transactionId = 'tx-1'): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
     VALUES ('acct-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO categories (id, name, parent_id, parent_name, raw_json, synced_at)
     VALUES ('07000000', 'Income', NULL, NULL, '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
    ) VALUES (?, 'acct-1', '2026-06-10T12:00:00.000Z', -1000, 'BRL', 'Coffee shop', 'CAFE', '05000000', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(transactionId);
}

function seedPendingSuggestion(
  db: DatabaseSync,
  transactionId = 'tx-1',
  examples: readonly AnnotationAssistExample[] = [],
): void {
  upsertAssistSuggestion(db, {
    entryType: 'transaction',
    entryId: transactionId,
    status: 'ok',
    proposal: {
      categoryOverrideId: '07000000',
      categoryId: null,
      subCategoryId: null,
      labelIds: [],
      labelNames: [],
      notes: null,
      reasoning: null,
    },
    examples,
    confidence: 0.9,
    usedClassifier: false,
    embeddingModel: 'test:mock',
    classifierModel: null,
    algorithmVersion: 2,
    computedAt: '2026-06-10T00:00:00.000Z',
    reviewStatus: 'pending',
    reviewedAt: null,
  });
}

describe('assist triage queue', () => {
  it('maps validated examples without exposing their JSON representation', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db);
    const example: AnnotationAssistExample = {
      entryId: 'example-1',
      occurredAt: '2026-06-09T12:00:00.000Z',
      similarity: 0.91,
      merchantSimilarity: 0.88,
      matchKind: 'merchant',
      peerDocumentKey: null,
      sameAccount: true,
      featureText: 'CAFETERIA',
      categoryOverrideId: '07000000',
      effectiveCategoryId: '07000000',
      categoryId: '07000000',
      subCategoryId: null,
      categoryName: 'Income',
      subCategoryName: null,
      labelIds: [],
      labelNames: [],
      notes: null,
      merchantName: 'CAFE',
      description: 'Coffee shop',
    };
    seedPendingSuggestion(db, 'tx-1', [example]);

    const [row] = listPendingAssistSuggestionRows(db);
    expect(row).toBeDefined();
    if (!row) {
      throw new Error('Expected a pending assist suggestion');
    }
    expect(row.examples).toEqual([example]);
    expect(Object.isFrozen(row.examples[0])).toBe(true);
    expect(Object.isFrozen(row.examples[0]?.labelIds)).toBe(true);
    expect(Object.isFrozen(row.examples[0]?.labelNames)).toBe(true);
    expect('examplesJson' in row).toBe(false);
    expect(listTriageQueue(db, { limit: 10, offset: 0 })[0]?.examples).toEqual([example]);
  });

  it('rejects malformed examples at the database mapper boundary', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db);
    seedPendingSuggestion(db);
    db.prepare(
      `UPDATE annotation_assist_suggestions
       SET examples_json = 'not-json'
       WHERE entry_type = 'transaction' AND entry_id = 'tx-1'`,
    ).run();

    expect(() => listPendingAssistSuggestionRows(db)).toThrow(/malformed examples JSON/);
  });

  it('lists pending IDs without deserializing suggestion payloads', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db);
    seedPendingSuggestion(db);
    db.prepare(
      `UPDATE annotation_assist_suggestions
       SET proposal_json = 'not-json', examples_json = 'not-json'
       WHERE entry_type = 'transaction' AND entry_id = 'tx-1'`,
    ).run();

    expect(listPendingAssistSuggestionEntryIds(db)).toEqual(['tx-1']);
  });

  it('projects digest rows without deserializing examples or triage metadata', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db);
    seedPendingSuggestion(db);
    db.prepare(
      `UPDATE annotation_assist_suggestions
       SET examples_json = 'not-json'
       WHERE entry_type = 'transaction' AND entry_id = 'tx-1'`,
    ).run();

    const [row] = listPendingAssistSuggestionDigestRows(db);
    expect(row?.entryId).toBe('tx-1');
    expect(row?.proposal.kind).toBe('valid');
    expect('examples' in (row ?? {})).toBe(false);
  });

  it('does not re-queue dismissed transactions on precompute', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db);
    seedPendingSuggestion(db);

    dismissAssistSuggestion(db, 'tx-1');
    expect(countPendingAssistSuggestions(db)).toBe(0);

    await runAssistPrecompute(db, config);

    expect(countPendingAssistSuggestions(db)).toBe(0);
    expect(listTriageQueue(db, { limit: 10, offset: 0 })).toEqual([]);
  });

  it('does not re-queue category-only accepts on precompute', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db);
    seedPendingSuggestion(db);

    await applyAssistSuggestion(db, 'tx-1', config, {
      categoryOverrideId: '07000000',
      categoryId: null,
      subCategoryId: null,
      labelIds: [],
      labelNames: [],
      notes: null,
      reasoning: null,
    });

    expect(countPendingAssistSuggestions(db)).toBe(0);

    await runAssistPrecompute(db, config);

    expect(countPendingAssistSuggestions(db)).toBe(0);
    expect(listTriageQueue(db, { limit: 10, offset: 0 })).toEqual([]);
  });

  it('excludes annotated transactions from the pending queue', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db);
    seedPendingSuggestion(db);

    const label = ensureAnnotationLabel(db, 'Food');
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-1',
      labelIds: [label.id],
      source: 'manual',
      embedding: config.annotation.embedding,
    });

    expect(countPendingAssistSuggestions(db)).toBe(0);
    expect(listTriageQueue(db, { limit: 10, offset: 0 })).toEqual([]);
  });
});
