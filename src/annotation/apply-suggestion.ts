import type { DatabaseSync } from 'node:sqlite';
import { resolveStoredCategorySelectId } from '../db/category-select-id.js';
import { upsertTransactionCategoryOverride } from '../db/transaction-category-overrides.js';
import type { AnnotationAssistProposal } from '../scoring/providers.js';
import type { ResolvedAppConfig } from '../types.js';
import { sanitizeAssistNotes } from './assist-proposal.js';
import { loadAssistSuggestion, markAssistSuggestionReviewed } from './assist-suggestions.js';
import { resolveAssistProposalLabelIds } from './label-resolve.js';
import { saveEntryAnnotation } from './store.js';

export async function applyAssistSuggestion(
  db: DatabaseSync,
  entryId: string,
  config: ResolvedAppConfig,
  proposalOverride?: AnnotationAssistProposal | null,
): Promise<void> {
  const stored = loadAssistSuggestion(db, entryId);
  const proposal = proposalOverride ?? stored?.proposal;
  if (!proposal) {
    throw new Error(`No assist suggestion for transaction ${entryId}`);
  }

  const transaction = db
    .prepare('SELECT category_id, description, merchant_name FROM transactions WHERE id = ?')
    .get(entryId) as
    | {
        readonly category_id: string | null;
        readonly description: string | null;
        readonly merchant_name: string | null;
      }
    | undefined;

  const notesContext = {
    description: transaction?.description ?? null,
    merchantName: transaction?.merchant_name ?? null,
  };
  const notes = sanitizeAssistNotes(proposal.notes, notesContext) ?? undefined;

  const syncedCategoryId = transaction?.category_id ?? null;

  const categoryOverrideId = resolveStoredCategorySelectId(proposal.categoryOverrideId);
  if (categoryOverrideId && categoryOverrideId !== syncedCategoryId) {
    upsertTransactionCategoryOverride(db, entryId, categoryOverrideId);
  }

  const labelIds = resolveAssistProposalLabelIds(db, proposal);
  const annotationCategoryId = resolveStoredCategorySelectId(proposal.categoryId);
  const shouldSaveAnnotation =
    labelIds.length > 0 ||
    Boolean(notes) ||
    Boolean(annotationCategoryId) ||
    Boolean(proposal.subCategoryId);

  if (shouldSaveAnnotation) {
    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId,
      categoryId: annotationCategoryId,
      subCategoryId: proposal.subCategoryId ?? undefined,
      labelIds,
      notes,
      source: 'suggested',
      embedding: config.annotation.embedding,
    });
  }

  markAssistSuggestionReviewed(db, entryId, 'applied');
}

export function dismissAssistSuggestion(db: DatabaseSync, entryId: string): void {
  markAssistSuggestionReviewed(db, entryId, 'dismissed');
}
