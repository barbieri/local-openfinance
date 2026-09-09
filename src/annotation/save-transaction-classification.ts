import type { DatabaseSync } from 'node:sqlite';
import { resolveStoredCategorySelectId } from '../db/category-select-id.js';
import { listInstallmentSiblingTransactionIds } from '../db/installment-siblings.js';
import {
  clearTransactionCategoryOverride,
  getTransactionCategoryOverride,
  upsertTransactionCategoryOverride,
} from '../db/transaction-category-overrides.js';
import type { ResolvedAppConfig } from '../types.js';
import { saveEntryAnnotation } from './store.js';

export type SaveTransactionClassificationInput = {
  readonly categoryOverrideId?: string | null | undefined;
  readonly categoryId?: string | null | undefined;
  readonly subCategoryId?: string | null | undefined;
  readonly labelIds?: readonly string[] | undefined;
  readonly notes?: string | null | undefined;
  readonly source?: 'manual' | 'suggested' | undefined;
  readonly applyToInstallmentSiblings?: boolean | undefined;
  readonly applyToTransactionIds?: readonly string[] | undefined;
};

function resolveExistingTransactionIds(
  db: DatabaseSync,
  transactionIds: readonly string[],
): readonly string[] {
  const uniqueIds = [...new Set(transactionIds.filter((id) => id.trim().length > 0))];
  if (uniqueIds.length === 0) {
    return [];
  }

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT id FROM transactions WHERE id IN (${placeholders})`)
    .all(...uniqueIds) as Array<{ readonly id: string }>;
  return rows.map((row) => row.id);
}

function applyCategoryOverrideToTransaction(
  db: DatabaseSync,
  transactionId: string,
  categoryOverrideSelectId: string | null,
): void {
  const row = db.prepare('SELECT category_id FROM transactions WHERE id = ?').get(transactionId) as
    | { readonly category_id: string | null }
    | undefined;
  if (!row) {
    return;
  }

  const syncedCategoryId = row.category_id ?? '';
  const resolvedOverrideId = categoryOverrideSelectId ?? '';

  if (resolvedOverrideId && resolvedOverrideId !== syncedCategoryId) {
    upsertTransactionCategoryOverride(db, transactionId, resolvedOverrideId);
    return;
  }

  if (getTransactionCategoryOverride(db, transactionId)) {
    clearTransactionCategoryOverride(db, transactionId);
  }
}

function hasTransactionAnnotation(db: DatabaseSync, transactionId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS present
       FROM entry_annotations
       WHERE entry_type = 'transaction' AND entry_id = ?
       LIMIT 1`,
    )
    .get(transactionId) as { readonly present: number } | undefined;
  return row?.present === 1;
}

function shouldSaveAnnotationForTarget(input: {
  readonly targetId: string;
  readonly transactionId: string;
  readonly applyToRelatedTargets: boolean;
  readonly hasAnnotationPayload: boolean;
  readonly primaryHasAnnotation: boolean;
}): boolean {
  const savePrimary = input.hasAnnotationPayload || input.primaryHasAnnotation;
  if (input.targetId === input.transactionId) {
    return savePrimary;
  }
  return input.applyToRelatedTargets && savePrimary;
}

export async function saveTransactionClassification(
  db: DatabaseSync,
  config: ResolvedAppConfig,
  transactionId: string,
  input: SaveTransactionClassificationInput,
): Promise<{ readonly updatedTransactionIds: readonly string[] }> {
  const siblingIds = input.applyToInstallmentSiblings
    ? listInstallmentSiblingTransactionIds(db, transactionId)
    : [];
  const selectedIds = resolveExistingTransactionIds(db, input.applyToTransactionIds ?? []).filter(
    (id) => id !== transactionId,
  );
  const targetIds = [...new Set([transactionId, ...siblingIds, ...selectedIds])];

  const categoryOverrideSelectId = resolveStoredCategorySelectId(input.categoryOverrideId) ?? '';
  const annotationCategoryId = resolveStoredCategorySelectId(input.categoryId);
  const labelIds = [...new Set(input.labelIds ?? [])];
  const notes = input.notes?.trim() || null;
  const subCategoryId = input.subCategoryId?.trim() || null;

  const hasAnnotationPayload =
    labelIds.length > 0 ||
    Boolean(notes) ||
    Boolean(annotationCategoryId) ||
    Boolean(subCategoryId);
  const primaryHasAnnotation = hasTransactionAnnotation(db, transactionId);
  const applyToRelatedTargets = input.applyToInstallmentSiblings === true || selectedIds.length > 0;

  for (const targetId of targetIds) {
    applyCategoryOverrideToTransaction(db, targetId, categoryOverrideSelectId || null);
  }

  const annotationTargets = targetIds.filter((targetId) =>
    shouldSaveAnnotationForTarget({
      targetId,
      transactionId,
      applyToRelatedTargets,
      hasAnnotationPayload,
      primaryHasAnnotation,
    }),
  );

  await Promise.all(
    annotationTargets.map((targetId) =>
      saveEntryAnnotation(db, {
        entryType: 'transaction',
        entryId: targetId,
        categoryId: annotationCategoryId,
        subCategoryId: subCategoryId ?? undefined,
        labelIds,
        notes: notes ?? undefined,
        source: input.source ?? 'manual',
        embedding: config.annotation.embedding,
      }),
    ),
  );

  return { updatedTransactionIds: targetIds };
}
