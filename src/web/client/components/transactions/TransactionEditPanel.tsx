import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { apiJson } from '../../lib/api.js';
import type { LabelRecord } from '../labels/LabelEditDialog.js';
import { TransactionEditFooter } from './TransactionEditFooter.js';
import {
  applyAssistProposal,
  type ClassificationProposal,
  resolveTransactionEditCategoryIds,
  useTransactionClassificationFormState,
} from './transaction-classification-form-state.js';
import {
  TransactionDetailContent,
  TransactionEditTitle,
  type TransactionEditTitleMeta,
} from './transaction-detail-content.js';
import type { TransactionDetailRow } from './transaction-detail-types.js';

const EMPTY_SELECTED_TRANSACTION_IDS: readonly string[] = [];

type AssistResponse = {
  readonly status:
    | 'ok'
    | 'missing_embedding_config'
    | 'missing_classifier_config'
    | 'no_candidates'
    | 'no_suggestion';
  readonly proposal: ClassificationProposal | null;
  readonly fromCache?: boolean;
};

function resolveAssistEmptyMessageKey(status: AssistResponse['status']): string {
  if (status === 'missing_embedding_config' || status === 'missing_classifier_config') {
    return 'transactionDetail.assistMissingConfig';
  }
  if (status === 'no_candidates') {
    return 'transactionDetail.assistNoCandidates';
  }
  return 'transactionDetail.assistEmpty';
}

type TransactionEditPanelProps = {
  readonly transaction: TransactionDetailRow;
  readonly mode: 'detail' | 'triage';
  readonly active?: boolean;
  readonly labelById: Record<string, LabelRecord>;
  readonly initialProposal?: ClassificationProposal | null;
  readonly titleMeta?: TransactionEditTitleMeta;
  readonly selectedTransactionIds?: readonly string[];
  readonly onOpenTransaction?: (transactionId: string) => void | Promise<void>;
  readonly onDismiss: () => void;
  readonly onSaved: () => void | Promise<void>;
  readonly savePending?: boolean;
  readonly showHeader?: boolean;
  readonly onTriageSave?: (payload: {
    readonly applyToInstallmentSiblings: boolean;
    readonly categoryOverrideId: string;
    readonly annotationCategoryId: string;
    readonly annotationSubCategoryId: string;
    readonly selectedLabelIds: readonly string[];
    readonly notes: string;
    readonly reasoning: string | null;
    readonly totalInstallments: number | null;
  }) => void;
};

function useTransactionEditExtraState(transactionId: string | undefined) {
  type ExtraState = {
    readonly applyToSelectedTransactions: boolean;
    readonly assistLoadedFromCache: boolean;
    readonly assistReasoning: string | null;
    readonly syncedTransactionId: string | null;
  };

  const [extra, setExtra] = useState<ExtraState>({
    applyToSelectedTransactions: false,
    assistLoadedFromCache: false,
    assistReasoning: null,
    syncedTransactionId: null,
  });

  if (transactionId && transactionId !== extra.syncedTransactionId) {
    setExtra({
      applyToSelectedTransactions: false,
      assistLoadedFromCache: false,
      assistReasoning: null,
      syncedTransactionId: transactionId,
    });
  }

  return {
    applyToSelectedTransactions: extra.applyToSelectedTransactions,
    setApplyToSelectedTransactions: (applyToSelectedTransactions: boolean) =>
      setExtra((prev) => ({ ...prev, applyToSelectedTransactions })),
    assistLoadedFromCache: extra.assistLoadedFromCache,
    setAssistLoadedFromCache: (assistLoadedFromCache: boolean) =>
      setExtra((prev) => ({ ...prev, assistLoadedFromCache })),
    assistReasoning: extra.assistReasoning,
    setAssistReasoning: (assistReasoning: string | null) =>
      setExtra((prev) => ({ ...prev, assistReasoning })),
  };
}

export function TransactionEditPanel({
  transaction,
  mode,
  active = true,
  labelById,
  initialProposal = null,
  titleMeta,
  selectedTransactionIds = EMPTY_SELECTED_TRANSACTION_IDS,
  onOpenTransaction,
  onDismiss,
  onSaved,
  savePending = false,
  showHeader = true,
  onTriageSave,
}: TransactionEditPanelProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isDetailMode = mode === 'detail';
  const {
    applyToSelectedTransactions,
    setApplyToSelectedTransactions,
    assistLoadedFromCache,
    setAssistLoadedFromCache,
    assistReasoning: detailAssistReasoning,
    setAssistReasoning,
  } = useTransactionEditExtraState(isDetailMode ? transaction.id : undefined);

  const formProposal = isDetailMode ? null : initialProposal;
  const assistReasoning = isDetailMode
    ? detailAssistReasoning
    : (initialProposal?.reasoning ?? null);

  const {
    categoryOverrideId,
    setCategoryOverrideId,
    annotationCategoryId,
    setAnnotationCategoryId,
    annotationSubCategoryId,
    setAnnotationSubCategoryId,
    selectedLabelIds,
    setSelectedLabelIds,
    notes,
    setNotes,
    applyToInstallmentSiblings,
    setApplyToInstallmentSiblings,
    patchForm,
  } = useTransactionClassificationFormState(transaction, formProposal, labelById);

  const otherSelectedTransactionIds = useMemo(
    () => selectedTransactionIds.filter((id) => id !== transaction.id),
    [selectedTransactionIds, transaction.id],
  );

  const { resolvedCategoryOverrideId, resolvedAnnotationCategoryId } =
    resolveTransactionEditCategoryIds(categoryOverrideId, annotationCategoryId);

  const currentState = useMemo(
    () => ({
      categoryOverrideId: categoryOverrideId || null,
      categoryId: resolvedAnnotationCategoryId || null,
      subCategoryId: annotationSubCategoryId || null,
      labelIds: [...selectedLabelIds],
      notes: notes || null,
    }),
    [
      annotationSubCategoryId,
      categoryOverrideId,
      notes,
      resolvedAnnotationCategoryId,
      selectedLabelIds,
    ],
  );

  const assistMutation = useMutation({
    mutationFn: (force: boolean) =>
      apiJson<AssistResponse>('/api/classify/assist', {
        method: 'POST',
        body: JSON.stringify({
          entryType: 'transaction',
          entryId: transaction.id,
          windowDays: 90,
          topK: 10,
          currentState,
          force,
        }),
      }),
    onSuccess: (result, force) => {
      if (!result.proposal) {
        toast.message(t(resolveAssistEmptyMessageKey(result.status)));
        setAssistLoadedFromCache(false);
        setAssistReasoning(null);
        return;
      }
      applyAssistProposal(result.proposal, labelById, patchForm);
      setAssistLoadedFromCache(result.fromCache === true);
      setAssistReasoning(result.proposal.reasoning ?? null);
      toast.success(
        result.fromCache === true
          ? t('transactionDetail.assistFromCache')
          : t('transactionDetail.assistApplied'),
        {
          description: result.proposal.reasoning ?? undefined,
        },
      );
      if (force) {
        void queryClient.invalidateQueries({ queryKey: ['classify-triage-stats'] });
      }
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiJson<{ updatedTransactionIds: readonly string[] }>(
        `/api/transactions/${transaction.id}/classification`,
        {
          method: 'POST',
          body: JSON.stringify({
            categoryOverrideId: categoryOverrideId || null,
            categoryId: resolvedAnnotationCategoryId || null,
            subCategoryId: annotationSubCategoryId || null,
            labelIds: [...selectedLabelIds],
            notes: notes || null,
            applyToInstallmentSiblings,
            applyToTransactionIds: applyToSelectedTransactions
              ? [...otherSelectedTransactionIds]
              : undefined,
          }),
        },
      );
    },
    onSuccess: async (result) => {
      const count = result.updatedTransactionIds.length;
      if (count > 1) {
        toast.success(t('transactionDetail.savedMultiple', { count }));
      } else {
        toast.success(t('toast.success'));
      }
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await onSaved();
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (groupId: string) =>
      apiJson(`/api/transfers/link/${groupId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(t('transactionDetail.unlinked'));
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  const busy = savePending || saveMutation.isPending || assistMutation.isPending;

  const handleTriageSave = (): void => {
    onTriageSave?.({
      applyToInstallmentSiblings,
      categoryOverrideId: resolvedCategoryOverrideId,
      annotationCategoryId: resolvedAnnotationCategoryId,
      annotationSubCategoryId,
      selectedLabelIds,
      notes,
      reasoning: assistReasoning,
      totalInstallments: transaction.total_installments,
    });
  };

  return (
    <article className="flex min-w-0 flex-col gap-4">
      {showHeader ? (
        <header className="border-b border-border pb-3">
          <TransactionEditTitle transaction={transaction} meta={titleMeta} />
        </header>
      ) : null}

      <TransactionDetailContent
        transaction={transaction}
        active={active}
        locale={i18n.language}
        assistReasoning={assistReasoning}
        categoryOverrideId={categoryOverrideId}
        onCategoryOverrideIdChange={setCategoryOverrideId}
        annotationCategoryId={annotationCategoryId}
        onAnnotationCategoryIdChange={setAnnotationCategoryId}
        annotationSubCategoryId={annotationSubCategoryId}
        onAnnotationSubCategoryIdChange={setAnnotationSubCategoryId}
        selectedLabelIds={selectedLabelIds}
        onSelectedLabelIdsChange={setSelectedLabelIds}
        notes={notes}
        onNotesChange={setNotes}
        onBillLinkSaved={onSaved}
        onOpenTransaction={onOpenTransaction}
        onUnlinkTransfer={(groupId) => unlinkMutation.mutate(groupId)}
        unlinkPending={unlinkMutation.isPending}
      />

      <TransactionEditFooter
        mode={mode}
        busy={busy}
        totalInstallments={transaction.total_installments ?? 0}
        applyToInstallmentSiblings={applyToInstallmentSiblings}
        onApplyToInstallmentSiblingsChange={setApplyToInstallmentSiblings}
        otherSelectedTransactionCount={otherSelectedTransactionIds.length}
        applyToSelectedTransactions={applyToSelectedTransactions}
        onApplyToSelectedTransactionsChange={setApplyToSelectedTransactions}
        assistPending={assistMutation.isPending}
        assistLoadedFromCache={assistLoadedFromCache}
        savePending={savePending || saveMutation.isPending}
        onDismiss={onDismiss}
        onAssist={() => assistMutation.mutate(false)}
        onRecreateAssist={() => assistMutation.mutate(true)}
        onSave={isDetailMode ? () => saveMutation.mutate() : handleTriageSave}
      />
    </article>
  );
}
