import { useTranslation } from 'react-i18next';

export function TransactionsSelectionToolbar({
  rowCount,
  selectedCount,
  unclassifiedCount,
  onSelectAll,
  onSelectNone,
  onSelectUnclassified,
  onEditSelected,
}: {
  readonly rowCount: number;
  readonly selectedCount: number;
  readonly unclassifiedCount: number;
  readonly onSelectAll: () => void;
  readonly onSelectNone: () => void;
  readonly onSelectUnclassified: () => void;
  readonly onEditSelected: () => void;
}) {
  const { t } = useTranslation();

  if (rowCount === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50"
        disabled={rowCount === 0}
        onClick={onSelectAll}
      >
        {t('selection.selectAll', { count: rowCount })}
      </button>
      <button
        type="button"
        className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50"
        disabled={selectedCount === 0}
        onClick={onSelectNone}
      >
        {t('selection.selectNone')}
      </button>
      <button
        type="button"
        className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50"
        disabled={unclassifiedCount === 0}
        onClick={onSelectUnclassified}
      >
        {t('selection.selectUnclassified', { count: unclassifiedCount })}
      </button>
      <button
        type="button"
        className="rounded border border-border px-3 py-1 text-sm disabled:opacity-50"
        disabled={selectedCount === 0}
        onClick={onEditSelected}
      >
        {t('actions.editSelected')}
      </button>
      {selectedCount > 0 && (
        <span className="text-sm text-muted-foreground">
          {t('selection.selectedCount', { count: selectedCount })}
        </span>
      )}
    </div>
  );
}
