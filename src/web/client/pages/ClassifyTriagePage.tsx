import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { resolveStoredCategorySelectId } from '../../../db/category-select-id.js';
import { PrecomputeProgressView } from '../components/classify-triage/PrecomputeProgressView.js';
import type { LabelRecord } from '../components/labels/LabelEditDialog.js';
import { TransactionEditPanel } from '../components/transactions/TransactionEditPanel.js';
import type { ClassificationProposal } from '../components/transactions/transaction-classification-form-state.js';
import type { TransactionDetailRow } from '../components/transactions/transaction-detail-types.js';
import { usePrecomputeBackgroundJob } from '../hooks/use-background-job.js';
import { apiJson } from '../lib/api.js';
import { withLocaleQuery } from '../lib/api-locale.js';

type TriageItem = {
  readonly entryId: string;
  readonly proposal: ClassificationProposal | null;
  readonly confidence: number | null;
  readonly usedClassifier: boolean;
};

type TriageResponse = {
  readonly items: readonly TriageItem[];
  readonly pending: number;
};

function TriagePrecomputeControls({
  clearPending,
  running,
  canAbort,
  onClearPendingChange,
  onStart,
  onAbort,
}: {
  readonly clearPending: boolean;
  readonly running: boolean;
  readonly canAbort: boolean;
  readonly onClearPendingChange: (checked: boolean) => void;
  readonly onStart: () => void;
  readonly onAbort: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={clearPending}
          disabled={running}
          onChange={(event) => onClearPendingChange(event.target.checked)}
        />
        <span>{t('triage.clearPending')}</span>
      </label>
      <button
        type="button"
        disabled={running}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        onClick={onStart}
      >
        {running ? t('triage.precomputeRunning') : t('triage.precompute')}
      </button>
      {canAbort && (
        <button
          type="button"
          className="rounded border border-destructive px-4 py-2 text-sm text-destructive"
          onClick={onAbort}
        >
          {t('jobs.abort')}
        </button>
      )}
    </div>
  );
}

function useClassifyTriageQueries(precomputeRunning: boolean) {
  const { data: stats, error: statsError } = useQuery({
    queryKey: ['classify-triage-stats'],
    queryFn: () => apiJson<{ pending: number }>('/api/classify/triage/stats'),
    refetchInterval: precomputeRunning ? 2000 : false,
  });

  const {
    data: queue,
    isLoading,
    error: queueError,
  } = useQuery({
    queryKey: ['classify-triage'],
    queryFn: () => apiJson<TriageResponse>('/api/classify/triage?limit=1&offset=0'),
    refetchInterval: precomputeRunning ? 2000 : false,
  });

  return {
    stats,
    queue,
    isLoading,
    loadError: statsError ?? queueError,
    item: queue?.items[0] ?? null,
  };
}

function useClassifyTriageMutations(
  item: TriageItem | null,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  const { t } = useTranslation();

  const applyMutation = useMutation({
    mutationFn: async (payload: {
      readonly applyToInstallmentSiblings: boolean;
      readonly categoryOverrideId: string;
      readonly annotationCategoryId: string;
      readonly annotationSubCategoryId: string;
      readonly selectedLabelIds: readonly string[];
      readonly notes: string;
      readonly reasoning: string | null;
      readonly totalInstallments: number | null;
    }) => {
      if (!item) {
        return;
      }
      await apiJson(`/api/classify/triage/${item.entryId}/apply`, {
        method: 'POST',
        body: JSON.stringify({
          applyToInstallmentSiblings: payload.applyToInstallmentSiblings,
          proposal: {
            categoryOverrideId: resolveStoredCategorySelectId(payload.categoryOverrideId),
            categoryId: resolveStoredCategorySelectId(payload.annotationCategoryId),
            subCategoryId: payload.annotationSubCategoryId || null,
            labelIds: [...payload.selectedLabelIds],
            notes: payload.notes.trim() || null,
            reasoning: payload.reasoning,
          },
        }),
      });
    },
    onSuccess: async (_result, payload) => {
      toast.success(
        payload.applyToInstallmentSiblings && (payload.totalInstallments ?? 0) > 1
          ? t('transactionDetail.savedInstallments', { count: payload.totalInstallments ?? 0 })
          : t('triage.accepted'),
        {
          action: {
            label: t('triage.openTransaction'),
            onClick: () => {
              if (item) {
                window.open(`#/transaction/${item.entryId}`, '_blank', 'noopener');
              }
            },
          },
        },
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['classify-triage'] }),
        queryClient.invalidateQueries({ queryKey: ['classify-triage-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      if (!item) {
        return;
      }
      await apiJson(`/api/classify/triage/${item.entryId}/dismiss`, { method: 'POST' });
    },
    onSuccess: async () => {
      toast.message(t('triage.skipped'));
      await queryClient.invalidateQueries({ queryKey: ['classify-triage'] });
      await queryClient.invalidateQueries({ queryKey: ['classify-triage-stats'] });
    },
    onError: (error: Error) => {
      toast.error(t('toast.error'), { description: error.message, duration: Infinity });
    },
  });

  return { applyMutation, dismissMutation };
}

export function ClassifyTriagePage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [clearPending, setClearPending] = useState(false);

  const {
    uiState: precomputeUi,
    startPrecompute,
    abort,
    canAbort,
  } = usePrecomputeBackgroundJob({
    onDone: () => {
      toast.success(t('triage.precomputeDone'));
      void queryClient.invalidateQueries({ queryKey: ['classify-triage'] });
      void queryClient.invalidateQueries({ queryKey: ['classify-triage-stats'] });
    },
    onError: (message) => {
      toast.error(t('triage.precomputeErrorTitle'), {
        description: message,
        duration: Infinity,
        classNames: { description: 'whitespace-pre-wrap break-words font-mono text-xs' },
      });
    },
    onAborted: () => {
      toast.message(t('jobs.aborted'));
    },
  });

  const { stats, queue, isLoading, loadError, item } = useClassifyTriageQueries(
    precomputeUi.running,
  );

  const { data: labelsData } = useQuery({
    queryKey: ['annotation-labels'],
    queryFn: () => apiJson<{ byId: Record<string, LabelRecord> }>('/api/annotation-labels'),
  });
  const labelById = labelsData?.byId ?? {};

  const { data: transactionData, isLoading: transactionLoading } = useQuery({
    queryKey: ['transaction-detail', item?.entryId, i18n.language],
    queryFn: () =>
      apiJson<{ transaction: TransactionDetailRow }>(
        withLocaleQuery(`/api/transactions/${item?.entryId}`, i18n.language),
      ),
    enabled: item !== null,
  });

  const transaction = transactionData?.transaction ?? null;

  const { applyMutation, dismissMutation } = useClassifyTriageMutations(item, queryClient);

  const pending = stats?.pending ?? queue?.pending ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('triage.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('triage.pendingCount', { count: pending })}
          </p>
        </div>
        <TriagePrecomputeControls
          clearPending={clearPending}
          running={precomputeUi.running}
          canAbort={canAbort}
          onClearPendingChange={setClearPending}
          onStart={() => void startPrecompute(clearPending)}
          onAbort={() => void abort()}
        />
      </div>

      {(precomputeUi.running ||
        precomputeUi.done ||
        precomputeUi.error ||
        precomputeUi.aborted) && (
        <PrecomputeProgressView
          running={precomputeUi.running}
          event={precomputeUi.event}
          done={precomputeUi.done}
          error={precomputeUi.error}
        />
      )}

      {loadError && (
        <p className="text-sm text-destructive">{loadError.message ?? t('toast.error')}</p>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">{t('triage.loading')}</p>}

      {!isLoading && !item && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">{t('triage.empty')}</p>
        </div>
      )}

      {item && transactionLoading && (
        <p className="text-sm text-muted-foreground">{t('triage.loading')}</p>
      )}

      {item && !transactionLoading && !transaction && (
        <p className="text-sm text-destructive">{t('toast.error')}</p>
      )}

      {item && !transactionLoading && transaction && (
        <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
          <TransactionEditPanel
            transaction={transaction}
            mode="triage"
            active
            labelById={labelById}
            initialProposal={item.proposal}
            titleMeta={{
              confidence: item.confidence,
              usedClassifier: item.usedClassifier,
            }}
            savePending={applyMutation.isPending}
            onDismiss={() => dismissMutation.mutate()}
            onSaved={async () => {}}
            onTriageSave={(payload) => applyMutation.mutate(payload)}
          />
        </div>
      )}
    </div>
  );
}
