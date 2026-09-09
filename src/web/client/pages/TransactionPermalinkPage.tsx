import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { LabelRecord } from '../components/labels/LabelEditDialog.js';
import { TransactionEditPanel } from '../components/transactions/TransactionEditPanel.js';
import type { TransactionDetailRow } from '../components/transactions/transaction-detail-types.js';
import { apiJson } from '../lib/api.js';
import { withLocaleQuery } from '../lib/api-locale.js';
import { useAppNavigation } from '../lib/navigation.js';

export function TransactionPermalinkPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { transactionId, closeTransactionPermalink, openTransactionPermalink } = useAppNavigation();

  const { data: labelsData } = useQuery({
    queryKey: ['annotation-labels'],
    queryFn: () => apiJson<{ byId: Record<string, LabelRecord> }>('/api/annotation-labels'),
    enabled: transactionId !== null,
  });
  const labelById = labelsData?.byId ?? {};

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['transaction-detail', transactionId, i18n.language],
    queryFn: () =>
      apiJson<{ transaction: TransactionDetailRow }>(
        withLocaleQuery(`/api/transactions/${transactionId}`, i18n.language),
      ),
    enabled: transactionId !== null,
  });

  const transaction = data?.transaction ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm"
          onClick={closeTransactionPermalink}
        >
          {t('transactionPermalink.back')}
        </button>
      </div>

      {transactionId === null || isLoading ? (
        <p className="text-sm text-muted-foreground">{t('triage.loading')}</p>
      ) : null}

      {isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : t('transactionPermalink.notFound')}
        </p>
      ) : null}

      {!isLoading && !isError && !transaction ? (
        <p className="text-sm text-destructive">{t('transactionPermalink.notFound')}</p>
      ) : null}

      {transaction ? (
        <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
          <TransactionEditPanel
            transaction={transaction}
            mode="detail"
            active
            labelById={labelById}
            onDismiss={closeTransactionPermalink}
            onSaved={async () => {
              await queryClient.invalidateQueries({
                queryKey: ['transaction-detail', transaction.id],
              });
              await queryClient.invalidateQueries({ queryKey: ['transactions'] });
            }}
            onOpenTransaction={openTransactionPermalink}
          />
        </div>
      ) : null}
    </div>
  );
}
