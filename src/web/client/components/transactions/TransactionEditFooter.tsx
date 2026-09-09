import { useTranslation } from 'react-i18next';
import { InstallmentApplyCheckbox } from './InstallmentApplyCheckbox.js';
import { SelectedTransactionsApplyCheckbox } from './SelectedTransactionsApplyCheckbox.js';

export function TransactionEditFooter({
  mode,
  busy,
  totalInstallments,
  applyToInstallmentSiblings,
  onApplyToInstallmentSiblingsChange,
  otherSelectedTransactionCount,
  applyToSelectedTransactions,
  onApplyToSelectedTransactionsChange,
  assistPending,
  assistLoadedFromCache,
  savePending,
  onDismiss,
  onAssist,
  onRecreateAssist,
  onSave,
}: {
  readonly mode: 'detail' | 'triage';
  readonly busy: boolean;
  readonly totalInstallments: number;
  readonly applyToInstallmentSiblings: boolean;
  readonly onApplyToInstallmentSiblingsChange: (checked: boolean) => void;
  readonly otherSelectedTransactionCount: number;
  readonly applyToSelectedTransactions: boolean;
  readonly onApplyToSelectedTransactionsChange: (checked: boolean) => void;
  readonly assistPending: boolean;
  readonly assistLoadedFromCache: boolean;
  readonly savePending: boolean;
  readonly onDismiss: () => void;
  readonly onAssist: () => void;
  readonly onRecreateAssist: () => void;
  readonly onSave: () => void;
}) {
  const { t } = useTranslation();
  const isDetailMode = mode === 'detail';

  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex w-[calc(100%+2rem)] flex-col gap-3 border-t border-border bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-2">
        <InstallmentApplyCheckbox
          totalInstallments={totalInstallments}
          checked={applyToInstallmentSiblings}
          disabled={busy}
          onChange={onApplyToInstallmentSiblingsChange}
        />
        {isDetailMode ? (
          <SelectedTransactionsApplyCheckbox
            count={otherSelectedTransactionCount}
            checked={applyToSelectedTransactions}
            disabled={busy}
            onChange={onApplyToSelectedTransactionsChange}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={busy}
          onClick={onDismiss}
        >
          {isDetailMode ? t('classify.skip') : t('triage.skip')}
        </button>
        {isDetailMode ? (
          <>
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={onAssist}
            >
              {assistPending ? t('transactionDetail.assistRunning') : t('transactionDetail.assist')}
            </button>
            {assistLoadedFromCache && (
              <button
                type="button"
                className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={busy}
                onClick={onRecreateAssist}
              >
                {t('transactionDetail.assistRecreate')}
              </button>
            )}
          </>
        ) : null}
        <button
          type="button"
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={busy}
          onClick={onSave}
        >
          {isDetailMode
            ? t('classify.save')
            : savePending
              ? t('triage.accepting')
              : t('triage.accept')}
        </button>
      </div>
    </div>
  );
}
