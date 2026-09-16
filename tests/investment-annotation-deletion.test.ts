import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  embedWrittenEntryAnnotation,
  ensureAnnotationEmbedding,
  ensureAnnotationLabel,
  loadAnnotatableEntry,
  saveEntryAnnotation,
} from '../src/annotation/store.js';
import { softDeleteInvestment, softDeleteTransactions } from '../src/db/entry-deletion.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { embedScoringText } from '../src/scoring/providers.js';
import type { ScoringModelConfig } from '../src/types.js';

vi.mock('../src/scoring/providers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/scoring/providers.js')>();
  return {
    ...actual,
    embedScoringText: vi.fn(async () => ({
      vector: [1, 0, 0],
      dimensions: 3,
      model: 'test:mock',
      inputTokens: 25,
    })),
  };
});

const scoringConfig: ScoringModelConfig = { provider: 'test', model: 'mock' };

type EmbeddingResult = Awaited<ReturnType<typeof embedScoringText>>;

function createDeferredEmbedding(): {
  readonly promise: Promise<EmbeddingResult>;
  readonly resolve: (result: EmbeddingResult) => void;
} {
  let resolve!: (result: EmbeddingResult) => void;
  const promise = new Promise<EmbeddingResult>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function embeddingResult(): EmbeddingResult {
  return { vector: [1, 0, 0], dimensions: 3, model: 'test:mock', inputTokens: 25 };
}

function seedTransaction(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
    VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z');
    INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
    VALUES ('account-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z');
    INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
    ) VALUES (
      'transaction-1', 'account-1', '2026-06-10T12:00:00.000Z', -10000, 'BRL', 'Coffee', '{}',
      '2026-06-10T00:00:00.000Z'
    );
  `);
}

function seedInvestmentMovement(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
    VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z');
    INSERT INTO investments (
      id, connection_item_id, type, name, currency, raw_json, synced_at
    ) VALUES (
      'investment-1', 'item-1', 'FIXED_INCOME', 'CDB', 'BRL', '{}', '2026-06-10T00:00:00.000Z'
    );
    INSERT INTO investment_transactions (
      id, investment_id, occurred_at, type, amount_cents, currency, raw_json, synced_at
    ) VALUES (
      'movement-1', 'investment-1', '2026-06-10T12:00:00.000Z', 'BUY', 10000, 'BRL', '{}',
      '2026-06-10T00:00:00.000Z'
    );
  `);
}

function deleteParentInvestment(db: DatabaseSync): void {
  softDeleteInvestment(db, {
    investmentId: 'investment-1',
    deletedAt: '2026-09-16T12:00:00.000Z',
  });
}

function expectAnnotationEmbeddingMissing(db: DatabaseSync): void {
  expect(db.prepare('SELECT * FROM annotation_embeddings').all()).toEqual([]);
}

async function expectActiveAnnotationEmbedding(
  db: DatabaseSync,
  entryType: 'transaction' | 'investment_transaction',
  entryId: string,
): Promise<void> {
  const annotationId = await saveEntryAnnotation(db, { entryType, entryId, source: 'manual' });
  const entry = loadAnnotatableEntry(db, entryType, entryId);
  if (!entry) {
    throw new Error(`Expected active ${entryType}`);
  }
  await ensureAnnotationEmbedding(db, annotationId, entry, scoringConfig);
  expect(
    db
      .prepare('SELECT annotation_id FROM annotation_embeddings WHERE annotation_id = ?')
      .get(annotationId),
  ).toEqual({ annotation_id: annotationId });
}

describe('annotation persistence after deletion', () => {
  it('persists annotation embeddings for active transactions and investment movements', async () => {
    const transactionDb = new DatabaseSync(':memory:');
    migrateDatabase(transactionDb);
    seedTransaction(transactionDb);
    await expectActiveAnnotationEmbedding(transactionDb, 'transaction', 'transaction-1');

    const movementDb = new DatabaseSync(':memory:');
    migrateDatabase(movementDb);
    seedInvestmentMovement(movementDb);
    await expectActiveAnnotationEmbedding(movementDb, 'investment_transaction', 'movement-1');
  });

  it('rejects a stale annotation save without leaving annotation or embedding rows', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedInvestmentMovement(db);
    const label = ensureAnnotationLabel(db, 'Stale label');
    deleteParentInvestment(db);

    await expect(
      saveEntryAnnotation(db, {
        entryType: 'investment_transaction',
        entryId: 'movement-1',
        labelIds: [label.id],
        notes: 'Cached before the delete',
        source: 'manual',
        embedding: scoringConfig,
      }),
    ).rejects.toThrow('Entry not found');

    expect(db.prepare('SELECT * FROM entry_annotations').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM entry_annotation_labels').all()).toEqual([]);
    expectAnnotationEmbeddingMissing(db);
  });

  it('ignores a stale embedding completion and preserves the existing forensic annotation', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedInvestmentMovement(db);
    const annotationId = await saveEntryAnnotation(db, {
      entryType: 'investment_transaction',
      entryId: 'movement-1',
      notes: 'Saved before the delete',
      source: 'manual',
    });
    deleteParentInvestment(db);

    await expect(
      embedWrittenEntryAnnotation(db, {
        annotationId,
        entryType: 'investment_transaction',
        entryId: 'movement-1',
        embedding: { config: scoringConfig, featureText: 'Cached movement text' },
      }),
    ).resolves.toBeUndefined();

    expect(db.prepare('SELECT id FROM entry_annotations').all()).toEqual([{ id: annotationId }]);
    expectAnnotationEmbeddingMissing(db);
  });

  it('ignores an annotation embedding that completes after its transaction is deleted', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db);
    const annotationId = await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'transaction-1',
      source: 'manual',
    });
    const entry = loadAnnotatableEntry(db, 'transaction', 'transaction-1');
    if (!entry) {
      throw new Error('Expected active transaction');
    }
    const deferred = createDeferredEmbedding();
    vi.mocked(embedScoringText).mockImplementationOnce(async () => deferred.promise);

    const completion = ensureAnnotationEmbedding(db, annotationId, entry, scoringConfig);
    softDeleteTransactions(db, { transactionId: 'transaction-1' });
    deferred.resolve(embeddingResult());
    await completion;

    expectAnnotationEmbeddingMissing(db);
  });

  it('ignores an annotation embedding that completes after its parent investment is deleted', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedInvestmentMovement(db);
    const annotationId = await saveEntryAnnotation(db, {
      entryType: 'investment_transaction',
      entryId: 'movement-1',
      source: 'manual',
    });
    const entry = loadAnnotatableEntry(db, 'investment_transaction', 'movement-1');
    if (!entry) {
      throw new Error('Expected active investment movement');
    }
    const deferred = createDeferredEmbedding();
    vi.mocked(embedScoringText).mockImplementationOnce(async () => deferred.promise);

    const completion = ensureAnnotationEmbedding(db, annotationId, entry, scoringConfig);
    deleteParentInvestment(db);
    deferred.resolve(embeddingResult());
    await completion;

    expectAnnotationEmbeddingMissing(db);
  });
});
