import { useTranslation } from 'react-i18next';
import { InstallmentApplyCheckbox } from './InstallmentApplyCheckbox.js';
import { SelectedTransactionsApplyCheckbox } from './SelectedTransactionsApplyCheckbox.js';

type TransactionEditFooterProps = {
  readonly mode: 'detail' | 'triage';
  readonly editable: boolean;
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
  readonly onDelete?: () => void;
  readonly onRestore?: () => void;
};

function TransactionEditOptions({
  mode,
  editable,
  busy,
  totalInstallments,
  applyToInstallmentSiblings,
  onApplyToInstallmentSiblingsChange,
  otherSelectedTransactionCount,
  applyToSelectedTransactions,
  onApplyToSelectedTransactionsChange,
}: TransactionEditFooterProps) {
  if (!editable) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <InstallmentApplyCheckbox
        totalInstallments={totalInstallments}
        checked={applyToInstallmentSiblings}
        disabled={busy}
        onChange={onApplyToInstallmentSiblingsChange}
      />
      {mode === 'detail' ? (
        <SelectedTransactionsApplyCheckbox
          count={otherSelectedTransactionCount}
          checked={applyToSelectedTransactions}
          disabled={busy}
          onChange={onApplyToSelectedTransactionsChange}
        />
      ) : null}
    </div>
  );
}

function TransactionEditActions({
  mode,
  editable,
  busy,
  assistPending,
  assistLoadedFromCache,
  savePending,
  onDismiss,
  onAssist,
  onRecreateAssist,
  onSave,
  onDelete,
  onRestore,
}: TransactionEditFooterProps) {
  const { t } = useTranslation();
  const isDetailMode = mode === 'detail';
  const deletionAction = resolveDeletionAction(isDetailMode, editable, onDelete, onRestore);

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <TransactionVisibilityAction editable={editable} busy={busy} onClick={deletionAction} />
      <button
        type="button"
        className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
        disabled={busy}
        onClick={onDismiss}
      >
        {isDetailMode ? t('classify.skip') : t('triage.skip')}
      </button>
      {isDetailMode && editable ? (
        <>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={busy}
            onClick={onAssist}
          >
            {assistPending ? t('transactionDetail.assistRunning') : t('transactionDetail.assist')}
          </button>
          {assistLoadedFromCache ? (
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={onRecreateAssist}
            >
              {t('transactionDetail.assistRecreate')}
            </button>
          ) : null}
        </>
      ) : null}
      {editable ? (
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
      ) : null}
    </div>
  );
}

function TransactionVisibilityAction({
  editable,
  busy,
  onClick,
}: {
  readonly editable: boolean;
  readonly busy: boolean;
  readonly onClick: (() => void) | undefined;
}) {
  const { t } = useTranslation();

  if (!onClick) {
    return null;
  }

  return (
    <button
      type="button"
      className={
        editable
          ? 'mr-3 rounded border border-destructive px-3 py-1.5 text-sm text-destructive disabled:opacity-50'
          : 'mr-3 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50'
      }
      disabled={busy}
      onClick={onClick}
    >
      {editable ? t('softDelete.delete') : t('softDelete.restore')}
    </button>
  );
}

function resolveDeletionAction(
  detail: boolean,
  editable: boolean,
  onDelete: (() => void) | undefined,
  onRestore: (() => void) | undefined,
): (() => void) | undefined {
  if (!detail) {
    return undefined;
  }
  return editable ? onDelete : onRestore;
}

export function TransactionEditFooter(props: TransactionEditFooterProps) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex w-[calc(100%+2rem)] flex-col gap-3 border-t border-border bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <TransactionEditOptions {...props} />
      <TransactionEditActions {...props} />
    </div>
  );
}
