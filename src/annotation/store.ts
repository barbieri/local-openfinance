import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { VISIBLE_ACCOUNT_TRANSACTIONS_WHERE } from '../db/account-links.js';
import { resolveStoredCategorySelectId } from '../db/category-select-id.js';
import { getSql, runSql } from '../db/sqlite-query.js';
import { estimateEmbeddingCostMicrousd } from '../intelligence/usage.js';
import { classifyEntryCategory, embedScoringText } from '../scoring/providers.js';
import { blobToVector, cosineSimilarity, vectorToBlob } from '../scoring/vector.js';
import type { ScoringModelConfig } from '../types.js';
import {
  type AnnotatableEntry,
  buildAnnotationFeatureText,
  loadInvestmentTransactionEntry,
  loadTransactionEntry,
} from './feature-text.js';
import {
  loadAnnotationLabelIds,
  loadAnnotationLabelPaths,
  resolveAnnotationLabelReference,
  resolveAnnotationLabelReferences,
} from './label-resolve.js';

export type AnnotationCategory = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
};

export type AnnotationLabel = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly icon: string | null;
  readonly color: string | null;
};

export type SaveAnnotationInput = {
  readonly entryType: 'transaction' | 'investment_transaction';
  readonly entryId: string;
  readonly categoryId?: string | null | undefined;
  readonly subCategoryId?: string | undefined;
  readonly labelIds?: readonly string[] | undefined;
  readonly notes?: string | undefined;
  readonly source: 'manual' | 'suggested' | 'imported';
  readonly embedding?: ScoringModelConfig | undefined;
};

export type SimilarAnnotation = {
  readonly annotationId: string;
  readonly entryType: string;
  readonly entryId: string;
  readonly categoryId: string | null;
  readonly similarity: number;
};

export function slugifyCategoryId(name: string): string {
  return slugifyNameSegment(name);
}

export function slugifyNameSegment(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '.')
    .replace(/^\.+|\.+$/gu, '');
}

import { insertAnnotationLabelRecord } from './annotation-label-insert.js';
import { buildNestedAnnotationId } from './nested-annotation-id.js';

function findAnnotationCategoryByParentAndName(
  db: DatabaseSync,
  name: string,
  parentId: string | null,
): AnnotationCategory | null {
  const row = db
    .prepare(
      `SELECT id, name, parent_id
       FROM annotation_categories
       WHERE name = ? AND COALESCE(parent_id, '') = ?`,
    )
    .get(name, parentId ?? '') as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  return {
    id: String(row['id']),
    name: String(row['name']),
    parentId: typeof row['parent_id'] === 'string' ? row['parent_id'] : null,
  };
}

export function ensureAnnotationCategory(
  db: DatabaseSync,
  name: string,
  parentId?: string | undefined,
): AnnotationCategory {
  const trimmed = name.trim();
  const resolvedParentId = parentId ?? null;
  const existing = findAnnotationCategoryByParentAndName(db, trimmed, resolvedParentId);
  if (existing) {
    return existing;
  }

  const id = buildNestedAnnotationId(trimmed, resolvedParentId);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO annotation_categories (id, name, parent_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       parent_id = excluded.parent_id`,
  ).run(id, trimmed, resolvedParentId, now);

  return { id, name: trimmed, parentId: resolvedParentId };
}

export function ensureAnnotationLabel(
  db: DatabaseSync,
  name: string,
  parentId?: string | null,
): AnnotationLabel {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Label name is required');
  }

  const resolved = tryResolveExistingAnnotationLabel(db, trimmed, parentId);
  if (resolved) {
    return resolved;
  }

  return insertAnnotationLabel(db, trimmed, parentId ?? null);
}

function tryResolveExistingAnnotationLabel(
  db: DatabaseSync,
  name: string,
  parentId?: string | null,
): AnnotationLabel | null {
  if (parentId === undefined || name.includes('>')) {
    const resolvedId = resolveAnnotationLabelReference(db, name, { createMissing: false });
    if (resolvedId) {
      return readAnnotationLabel(db, resolvedId);
    }
  }

  const resolvedParentId = parentId ?? null;
  const row = db
    .prepare(
      `SELECT id, name, parent_id, icon, color
       FROM annotation_labels
       WHERE name = ? AND COALESCE(parent_id, '') = ?`,
    )
    .get(name, resolvedParentId ?? '') as Record<string, unknown> | undefined;
  if (row) {
    return readAnnotationLabel(db, String(row['id']));
  }

  if (resolvedParentId === null) {
    const nestedMatch = resolveAnnotationLabelReference(db, name, { createMissing: false });
    if (nestedMatch) {
      return readAnnotationLabel(db, nestedMatch);
    }
  }

  return null;
}

function insertAnnotationLabel(
  db: DatabaseSync,
  name: string,
  parentId: string | null,
): AnnotationLabel {
  const id = insertAnnotationLabelRecord(db, name, parentId);

  return {
    id,
    name,
    parentId,
    icon: 'MdLabel',
    color: '#64748b',
  };
}

function readAnnotationLabel(db: DatabaseSync, labelId: string): AnnotationLabel {
  const row = db
    .prepare(
      `SELECT id, name, parent_id, icon, color
       FROM annotation_labels
       WHERE id = ?`,
    )
    .get(labelId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error(`Annotation label not found: ${labelId}`);
  }
  return {
    id: String(row['id']),
    name: String(row['name']),
    parentId: typeof row['parent_id'] === 'string' ? row['parent_id'] : null,
    icon: typeof row['icon'] === 'string' ? row['icon'] : null,
    color: typeof row['color'] === 'string' ? row['color'] : null,
  };
}

export { loadAnnotationLabelIds, loadAnnotationLabelPaths, resolveAnnotationLabelReferences };

export function listAnnotationLabels(db: DatabaseSync): AnnotationLabel[] {
  return db
    .prepare(
      `SELECT id, name, parent_id, icon, color
       FROM annotation_labels
       ORDER BY COALESCE(sort_order, 999999), name ASC`,
    )
    .all()
    .map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: String(record['id']),
        name: String(record['name']),
        parentId: typeof record['parent_id'] === 'string' ? record['parent_id'] : null,
        icon: typeof record['icon'] === 'string' ? record['icon'] : null,
        color: typeof record['color'] === 'string' ? record['color'] : null,
      };
    });
}

export function listAnnotationCategories(db: DatabaseSync): AnnotationCategory[] {
  return db
    .prepare(
      `SELECT id, name, parent_id
       FROM annotation_categories
       ORDER BY COALESCE(sort_order, 999999), name ASC`,
    )
    .all()
    .map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: String(record['id']),
        name: String(record['name']),
        parentId: typeof record['parent_id'] === 'string' ? record['parent_id'] : null,
      };
    });
}

export function loadAnnotatableEntry(
  db: DatabaseSync,
  entryType: 'transaction' | 'investment_transaction',
  entryId: string,
): AnnotatableEntry | null {
  return entryType === 'transaction'
    ? loadTransactionEntry(db, entryId)
    : loadInvestmentTransactionEntry(db, entryId);
}

export function listUnannotatedEntries(
  db: DatabaseSync,
  options: {
    readonly entryTypes: readonly ('transaction' | 'investment_transaction')[];
    readonly limit: number;
  },
): AnnotatableEntry[] {
  const entries: AnnotatableEntry[] = [];

  if (options.entryTypes.includes('transaction')) {
    const rows = db
      .prepare(
        `SELECT t.id
         FROM transactions t
         LEFT JOIN entry_annotations ea
           ON ea.entry_type = 'transaction' AND ea.entry_id = t.id
         WHERE ea.id IS NULL
           AND ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}
         ORDER BY t.occurred_at DESC
         LIMIT ?`,
      )
      .all(options.limit) as Record<string, unknown>[];

    for (const row of rows) {
      const entry = loadTransactionEntry(db, String(row['id']));
      if (entry) {
        entries.push(entry);
      }
    }
  }

  if (options.entryTypes.includes('investment_transaction')) {
    const rows = db
      .prepare(
        `SELECT it.id
         FROM investment_transactions it
         LEFT JOIN entry_annotations ea
           ON ea.entry_type = 'investment_transaction' AND ea.entry_id = it.id
         WHERE ea.id IS NULL
         ORDER BY it.occurred_at DESC
         LIMIT ?`,
      )
      .all(options.limit) as Record<string, unknown>[];

    for (const row of rows) {
      const entry = loadInvestmentTransactionEntry(db, String(row['id']));
      if (entry) {
        entries.push(entry);
      }
    }
  }

  return entries
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, options.limit);
}

export async function saveEntryAnnotation(
  db: DatabaseSync,
  input: SaveAnnotationInput,
): Promise<string> {
  const now = new Date().toISOString();
  const annotationId = randomUUID();
  const categoryId = resolveStoredCategorySelectId(input.categoryId ?? null);

  runSql(
    db,
    `INSERT INTO entry_annotations (
      id, entry_type, entry_id, category_id, sub_category_id, notes, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_type, entry_id) DO UPDATE SET
      category_id = excluded.category_id,
      sub_category_id = excluded.sub_category_id,
      notes = excluded.notes,
      source = excluded.source,
      updated_at = excluded.updated_at`,
    annotationId,
    input.entryType,
    input.entryId,
    categoryId,
    input.subCategoryId ?? null,
    input.notes ?? null,
    input.source,
    now,
    now,
  );

  const annotationRow = getSql<{ readonly id: string }>(
    db,
    'SELECT id FROM entry_annotations WHERE entry_type = ? AND entry_id = ?',
    input.entryType,
    input.entryId,
  );
  if (!annotationRow) {
    throw new Error(`Annotation row missing after save for ${input.entryId}`);
  }

  runSql(db, 'DELETE FROM entry_annotation_labels WHERE annotation_id = ?', annotationRow.id);

  for (const labelId of input.labelIds ?? []) {
    runSql(
      db,
      `INSERT INTO entry_annotation_labels (annotation_id, label_id, created_at) VALUES (?, ?, ?)`,
      annotationRow.id,
      labelId,
      now,
    );
  }

  if (input.embedding) {
    const entry = loadAnnotatableEntry(db, input.entryType, input.entryId);
    if (entry) {
      const featureText = buildAnnotationFeatureText(entry);
      const embedded = await embedScoringText(input.embedding, featureText);
      runSql(
        db,
        `INSERT INTO annotation_embeddings (
           annotation_id, model, dimensions, vector, created_at,
           input_tokens, pricing_snapshot_json, estimated_cost_microusd
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(annotation_id) DO UPDATE SET
           model = excluded.model,
           dimensions = excluded.dimensions,
           vector = excluded.vector,
           created_at = excluded.created_at,
           input_tokens = excluded.input_tokens,
           pricing_snapshot_json = excluded.pricing_snapshot_json,
           estimated_cost_microusd = excluded.estimated_cost_microusd`,
        annotationRow.id,
        embedded.model,
        embedded.dimensions,
        vectorToBlob(embedded.vector),
        now,
        embedded.inputTokens ?? null,
        input.embedding.pricing ? JSON.stringify(input.embedding.pricing) : null,
        estimateEmbeddingCostMicrousd(embedded.inputTokens ?? null, input.embedding.pricing),
      );
    }
  }

  return annotationRow.id;
}

export async function ensureAnnotationEmbedding(
  db: DatabaseSync,
  annotationId: string,
  entry: AnnotatableEntry,
  embedding: ScoringModelConfig,
): Promise<void> {
  const featureText = buildAnnotationFeatureText(entry);
  const embedded = await embedScoringText(embedding, featureText);
  db.prepare(
    `INSERT INTO annotation_embeddings (
       annotation_id, model, dimensions, vector, created_at,
       input_tokens, pricing_snapshot_json, estimated_cost_microusd
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(annotation_id) DO UPDATE SET
       model = excluded.model,
       dimensions = excluded.dimensions,
       vector = excluded.vector,
       created_at = excluded.created_at,
       input_tokens = excluded.input_tokens,
       pricing_snapshot_json = excluded.pricing_snapshot_json,
       estimated_cost_microusd = excluded.estimated_cost_microusd`,
  ).run(
    annotationId,
    embedded.model,
    embedded.dimensions,
    vectorToBlob(embedded.vector),
    new Date().toISOString(),
    embedded.inputTokens ?? null,
    embedding.pricing ? JSON.stringify(embedding.pricing) : null,
    estimateEmbeddingCostMicrousd(embedded.inputTokens ?? null, embedding.pricing),
  );
}

export function findSimilarAnnotations(
  db: DatabaseSync,
  queryVector: readonly number[],
  modelPrefix: string,
  threshold: number,
  limit = 5,
): SimilarAnnotation[] {
  const rows = db
    .prepare(
      `SELECT ae.annotation_id, ae.model, ae.dimensions, ae.vector,
              ea.entry_type, ea.entry_id, ea.category_id
       FROM annotation_embeddings ae
       JOIN entry_annotations ea ON ea.id = ae.annotation_id
       WHERE ae.model LIKE ?`,
    )
    .all(`${modelPrefix}%`) as Record<string, unknown>[];

  const matches: SimilarAnnotation[] = [];

  for (const row of rows) {
    const dimensions = Number(row['dimensions']);
    const blob = row['vector'];
    if (!(blob instanceof Buffer)) {
      continue;
    }

    const vector = blobToVector(blob, dimensions);
    const similarity = cosineSimilarity(queryVector, vector);
    if (similarity < threshold) {
      continue;
    }

    matches.push({
      annotationId: String(row['annotation_id']),
      entryType: String(row['entry_type']),
      entryId: String(row['entry_id']),
      categoryId: typeof row['category_id'] === 'string' ? row['category_id'] : null,
      similarity,
    });
  }

  return matches.sort((left, right) => right.similarity - left.similarity).slice(0, limit);
}

export async function suggestCategoriesForEntry(
  db: DatabaseSync,
  entry: AnnotatableEntry,
  options: {
    readonly embedding?: ScoringModelConfig | undefined;
    readonly classifier?: ScoringModelConfig | undefined;
    readonly similarityThreshold: number;
  },
): Promise<{
  readonly embeddingMatches: SimilarAnnotation[];
  readonly classifierCategoryId: string | null;
}> {
  const categories = listAnnotationCategories(db);
  let embeddingMatches: SimilarAnnotation[] = [];
  let classifierCategoryId: string | null = null;

  if (options.embedding) {
    const featureText = buildAnnotationFeatureText(entry);
    const embedded = await embedScoringText(options.embedding, featureText);
    embeddingMatches = findSimilarAnnotations(
      db,
      embedded.vector,
      options.embedding.provider,
      options.similarityThreshold,
    );
  }

  if (options.classifier && categories.length > 0) {
    classifierCategoryId = await classifyEntryCategory(
      options.classifier,
      buildAnnotationFeatureText(entry),
      categories,
    );
  }

  return { embeddingMatches, classifierCategoryId };
}
