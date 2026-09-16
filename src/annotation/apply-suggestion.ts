import type { DatabaseSync } from 'node:sqlite';
import { withActiveTransactionWrite } from '../db/active-transaction-write.js';
import { resolveStoredCategorySelectId } from '../db/category-select-id.js';
import { upsertTransactionCategoryOverride } from '../db/transaction-category-overrides.js';
import type { AnnotationAssistProposal } from '../scoring/providers.js';
import type { ResolvedAppConfig } from '../types.js';
import { sanitizeAssistNotes } from './assist-proposal.js';
import { loadAssistSuggestion, markAssistSuggestionReviewed } from './assist-suggestions.js';
import { resolveAssistProposalLabelIds } from './label-resolve.js';
import {
  embedWrittenEntryAnnotation,
  type WrittenEntryAnnotation,
  writeEntryAnnotationUnchecked,
} from './store.js';

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

  const categoryOverrideId = resolveStoredCategorySelectId(proposal.categoryOverrideId);
  const labelIds = resolveAssistProposalLabelIds(db, proposal);
  const annotationCategoryId = resolveStoredCategorySelectId(proposal.categoryId);
  let written: WrittenEntryAnnotation | undefined;
  withActiveTransactionWrite(db, [entryId], () => {
    const transaction = db
      .prepare('SELECT category_id, description, merchant_name FROM transactions WHERE id = ?')
      .get(entryId) as {
      readonly category_id: string | null;
      readonly description: string | null;
      readonly merchant_name: string | null;
    };
    const notes =
      sanitizeAssistNotes(proposal.notes, {
        description: transaction.description,
        merchantName: transaction.merchant_name,
      }) ?? undefined;

    if (categoryOverrideId && categoryOverrideId !== transaction.category_id) {
      upsertTransactionCategoryOverride(db, entryId, categoryOverrideId);
    }

    const shouldSaveAnnotation =
      labelIds.length > 0 ||
      Boolean(notes) ||
      Boolean(annotationCategoryId) ||
      Boolean(proposal.subCategoryId);
    if (shouldSaveAnnotation) {
      written = writeEntryAnnotationUnchecked(db, {
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
    return undefined;
  });

  if (written) {
    await embedWrittenEntryAnnotation(db, written);
  }
  withActiveTransactionWrite(db, [entryId], () => {
    markAssistSuggestionReviewed(db, entryId, 'applied');
    return undefined;
  });
}

export function dismissAssistSuggestion(db: DatabaseSync, entryId: string): void {
  markAssistSuggestionReviewed(db, entryId, 'dismissed');
}
