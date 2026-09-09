import { useState } from 'react';
import { resolveStoredCategorySelectId } from '../../../../db/category-select-id.js';
import { resolveLabelIdsFromProposal } from '../../lib/resolve-label-ids.js';
import type { LabelRecord } from '../labels/LabelEditDialog.js';
import type { TransactionDetailRow } from './transaction-detail-types.js';

export type ClassificationProposal = {
  readonly categoryOverrideId: string | null;
  readonly categoryId: string | null;
  readonly subCategoryId: string | null;
  readonly labelIds?: readonly string[];
  readonly labelNames?: readonly string[];
  readonly notes: string | null;
  readonly reasoning?: string | null;
};

export type TransactionClassificationFormState = {
  readonly categoryOverrideId: string;
  readonly annotationCategoryId: string;
  readonly annotationSubCategoryId: string;
  readonly selectedLabelIds: readonly string[];
  readonly notes: string;
  readonly applyToInstallmentSiblings: boolean;
};

const EMPTY_CLASSIFICATION_FORM: TransactionClassificationFormState = {
  categoryOverrideId: '',
  annotationCategoryId: '',
  annotationSubCategoryId: '',
  selectedLabelIds: [],
  notes: '',
  applyToInstallmentSiblings: false,
};

type ClassificationFormHookState = {
  readonly form: TransactionClassificationFormState;
  readonly syncedKey: string | null;
};

export function resolveTransactionClassificationFormState(
  transaction: TransactionDetailRow,
): TransactionClassificationFormState {
  return {
    categoryOverrideId: transaction.category_override_id ?? transaction.category_id ?? '',
    annotationCategoryId: transaction.annotation?.categoryId ?? '',
    annotationSubCategoryId: transaction.annotation?.subCategoryId ?? '',
    selectedLabelIds: transaction.annotation?.labelIds ?? [],
    notes: transaction.annotation?.notes ?? '',
    applyToInstallmentSiblings:
      transaction.total_installments !== null && transaction.total_installments > 1,
  };
}

export function applyProposalToClassificationFormState(
  base: TransactionClassificationFormState,
  proposal: ClassificationProposal,
  labelById: Record<string, LabelRecord>,
): TransactionClassificationFormState {
  const matchedLabelIds = resolveLabelIdsFromProposal(labelById, {
    labelIds: proposal.labelIds,
    labelNames: proposal.labelNames,
  });

  return {
    categoryOverrideId: proposal.categoryOverrideId ?? base.categoryOverrideId,
    annotationCategoryId: proposal.categoryId ?? base.annotationCategoryId,
    annotationSubCategoryId: proposal.subCategoryId ?? base.annotationSubCategoryId,
    selectedLabelIds: matchedLabelIds.length > 0 ? matchedLabelIds : base.selectedLabelIds,
    notes: proposal.notes ?? base.notes,
    applyToInstallmentSiblings: base.applyToInstallmentSiblings,
  };
}

export function resolveTransactionEditCategoryIds(
  categoryOverrideId: string,
  annotationCategoryId: string,
): {
  readonly resolvedCategoryOverrideId: string;
  readonly resolvedAnnotationCategoryId: string;
} {
  return {
    resolvedCategoryOverrideId: resolveStoredCategorySelectId(categoryOverrideId) ?? '',
    resolvedAnnotationCategoryId: resolveStoredCategorySelectId(annotationCategoryId) ?? '',
  };
}

export function applyAssistProposal(
  proposal: ClassificationProposal,
  labelById: Record<string, LabelRecord>,
  patchForm: (update: Partial<TransactionClassificationFormState>) => void,
): void {
  const updates: {
    categoryOverrideId?: string;
    annotationCategoryId?: string;
    annotationSubCategoryId?: string;
    selectedLabelIds?: readonly string[];
    notes?: string;
    applyToInstallmentSiblings?: boolean;
  } = {};

  if (proposal.categoryOverrideId) {
    updates.categoryOverrideId = proposal.categoryOverrideId;
  }
  if (proposal.categoryId) {
    updates.annotationCategoryId = proposal.categoryId;
  }
  if (proposal.subCategoryId) {
    updates.annotationSubCategoryId = proposal.subCategoryId;
  }
  const matchedIds = resolveLabelIdsFromProposal(labelById, {
    labelIds: proposal.labelIds,
    labelNames: proposal.labelNames,
  });
  if (matchedIds.length > 0) {
    updates.selectedLabelIds = matchedIds;
  }
  if (proposal.notes) {
    updates.notes = proposal.notes;
  }

  if (Object.keys(updates).length > 0) {
    patchForm(updates);
  }
}

export function useTransactionClassificationFormState(
  transaction: TransactionDetailRow | null,
  proposal: ClassificationProposal | null | undefined,
  labelById: Record<string, LabelRecord>,
): {
  readonly categoryOverrideId: string;
  readonly setCategoryOverrideId: (value: string) => void;
  readonly annotationCategoryId: string;
  readonly setAnnotationCategoryId: (value: string) => void;
  readonly annotationSubCategoryId: string;
  readonly setAnnotationSubCategoryId: (value: string) => void;
  readonly selectedLabelIds: readonly string[];
  readonly setSelectedLabelIds: (value: readonly string[]) => void;
  readonly notes: string;
  readonly setNotes: (value: string) => void;
  readonly applyToInstallmentSiblings: boolean;
  readonly setApplyToInstallmentSiblings: (value: boolean) => void;
  readonly patchForm: (update: Partial<TransactionClassificationFormState>) => void;
} {
  const [state, setState] = useState<ClassificationFormHookState>({
    form: EMPTY_CLASSIFICATION_FORM,
    syncedKey: null,
  });

  const transactionId = transaction?.id;
  const proposalLabelIds = proposal?.labelIds ?? [];
  const proposalLabelNames = proposal?.labelNames ?? [];
  const proposalKey = proposal
    ? [
        proposal.categoryOverrideId,
        proposal.categoryId,
        proposal.subCategoryId,
        proposalLabelIds.join(','),
        proposalLabelNames.join(','),
        proposal.notes,
      ].join('|')
    : '';
  const needsLabelIndex =
    proposal !== null &&
    proposal !== undefined &&
    proposalLabelNames.length > 0 &&
    proposalLabelIds.length === 0;
  const labelIndexKey = needsLabelIndex ? Object.keys(labelById).join(',') : '';

  if (transaction && transactionId) {
    const nextKey = `${transactionId}:${proposalKey}:${labelIndexKey}`;
    if (nextKey !== state.syncedKey) {
      let formState = resolveTransactionClassificationFormState(transaction);
      if (proposal) {
        formState = applyProposalToClassificationFormState(formState, proposal, labelById);
      }
      setState({ form: formState, syncedKey: nextKey });
    }
  }

  const patchForm = (update: Partial<TransactionClassificationFormState>): void => {
    setState((prev) => ({ ...prev, form: { ...prev.form, ...update } }));
  };

  const { form } = state;

  return {
    categoryOverrideId: form.categoryOverrideId,
    setCategoryOverrideId: (categoryOverrideId) => patchForm({ categoryOverrideId }),
    annotationCategoryId: form.annotationCategoryId,
    setAnnotationCategoryId: (annotationCategoryId) => patchForm({ annotationCategoryId }),
    annotationSubCategoryId: form.annotationSubCategoryId,
    setAnnotationSubCategoryId: (annotationSubCategoryId) => patchForm({ annotationSubCategoryId }),
    selectedLabelIds: form.selectedLabelIds,
    setSelectedLabelIds: (selectedLabelIds) => patchForm({ selectedLabelIds }),
    notes: form.notes,
    setNotes: (notes) => patchForm({ notes }),
    applyToInstallmentSiblings: form.applyToInstallmentSiblings,
    setApplyToInstallmentSiblings: (applyToInstallmentSiblings) =>
      patchForm({ applyToInstallmentSiblings }),
    patchForm,
  };
}
