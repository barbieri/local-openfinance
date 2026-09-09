import type { DatabaseSync } from 'node:sqlite';
import { VISIBLE_ACCOUNT_TRANSACTIONS_WHERE } from '../db/account-links.js';
import { estimateEmbeddingCostMicrousd } from '../intelligence/usage.js';
import { embedScoringText } from '../scoring/providers.js';
import { blobToVector, vectorToBlob } from '../scoring/vector.js';
import type { ScoringModelConfig } from '../types.js';
import { mapInParallel } from '../utils/map-in-parallel.js';
import { ASSISTABLE_CLASSIFICATION_WHERE } from './assist-criteria.js';
import { hashFeatureText } from './feature-hash.js';
import { type AnnotatableEntry, buildEmbeddingFeatureText } from './feature-text.js';
import { ensureAnnotationEmbedding, loadAnnotatableEntry } from './store.js';

type EntryEmbeddingRow = {
  readonly feature_hash: string;
  readonly model: string;
};

export async function ensureEntryEmbedding(
  db: DatabaseSync,
  entry: AnnotatableEntry,
  embedding: ScoringModelConfig,
): Promise<readonly number[]> {
  const featureText = buildEmbeddingFeatureText(entry);
  const featureHash = hashFeatureText(featureText);
  const existing = db
    .prepare(
      `SELECT feature_hash, model
       FROM entry_embeddings
       WHERE entry_type = ? AND entry_id = ?`,
    )
    .get(entry.entryType, entry.entryId) as EntryEmbeddingRow | undefined;

  if (
    existing &&
    existing.feature_hash === featureHash &&
    existing.model.startsWith(`${embedding.provider}:`)
  ) {
    const row = db
      .prepare(
        `SELECT dimensions, vector
         FROM entry_embeddings
         WHERE entry_type = ? AND entry_id = ?`,
      )
      .get(entry.entryType, entry.entryId) as
      | { readonly dimensions: number; readonly vector: Buffer }
      | undefined;
    if (row?.vector instanceof Buffer) {
      return [...blobToVector(row.vector, row.dimensions)];
    }
  }

  const embedded = await embedScoringText(embedding, featureText);
  db.prepare(
    `INSERT INTO entry_embeddings (
      entry_type, entry_id, model, dimensions, vector, feature_hash, created_at,
      input_tokens, pricing_snapshot_json, estimated_cost_microusd
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_type, entry_id) DO UPDATE SET
      model = excluded.model,
      dimensions = excluded.dimensions,
      vector = excluded.vector,
      feature_hash = excluded.feature_hash,
      created_at = excluded.created_at,
      input_tokens = excluded.input_tokens,
      pricing_snapshot_json = excluded.pricing_snapshot_json,
      estimated_cost_microusd = excluded.estimated_cost_microusd`,
  ).run(
    entry.entryType,
    entry.entryId,
    embedded.model,
    embedded.dimensions,
    vectorToBlob(embedded.vector),
    featureHash,
    new Date().toISOString(),
    embedded.inputTokens ?? null,
    embedding.pricing ? JSON.stringify(embedding.pricing) : null,
    estimateEmbeddingCostMicrousd(embedded.inputTokens ?? null, embedding.pricing),
  );

  return [...embedded.vector];
}

export async function backfillAssistableAnnotationEmbeddings(
  db: DatabaseSync,
  embedding: ScoringModelConfig,
): Promise<number> {
  const rows = db
    .prepare(
      `SELECT ea.id AS annotation_id, t.id AS entry_id
       FROM transactions t
       JOIN entry_annotations ea ON ea.entry_type = 'transaction' AND ea.entry_id = t.id
       LEFT JOIN transaction_category_overrides tco ON tco.transaction_id = t.id
       LEFT JOIN annotation_embeddings ae ON ae.annotation_id = ea.id
       WHERE ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}
         AND ${ASSISTABLE_CLASSIFICATION_WHERE}
         AND (ae.annotation_id IS NULL OR ae.model NOT LIKE ?)
       ORDER BY t.occurred_at DESC`,
    )
    .all(`${embedding.provider}:%`) as {
    readonly annotation_id: string;
    readonly entry_id: string;
  }[];

  const outcomes = await mapInParallel(
    rows,
    async (row) => {
      const entry = loadAnnotatableEntry(db, 'transaction', row.entry_id);
      if (!entry) {
        return 0;
      }
      await ensureAnnotationEmbedding(db, row.annotation_id, entry, embedding);
      return 1;
    },
    8,
  );

  return outcomes.reduce<number>((sum, count) => sum + count, 0);
}
