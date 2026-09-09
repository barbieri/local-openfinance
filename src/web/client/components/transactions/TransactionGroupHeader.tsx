import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CategoryBadge } from '../categories/CategoryBadge.js';
import type { DataTableRowGroup } from '../data-table/data-table-row-group.js';
import { FormattedCurrency } from '../format/FormattedCurrency.js';
import { LabelBadgeList } from '../labels/LabelBadge.js';
import type { TransactionRow } from './transactions-page-types.js';

type TransactionGroupHeaderProps = {
  readonly group: DataTableRowGroup;
  readonly rows: readonly TransactionRow[];
  readonly selectedIds: readonly string[];
  readonly onSelectRows: (rowIds: readonly string[], checked: boolean) => void;
};

export function TransactionGroupHeader({
  group,
  rows,
  selectedIds,
  onSelectRows,
}: TransactionGroupHeaderProps) {
  const { t } = useTranslation();
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rowIds = useMemo(
    () =>
      group.allRowIndexes
        .map((index) => rows[index]?.id)
        .filter((id): id is string => typeof id === 'string'),
    [group.allRowIndexes, rows],
  );
  const selectedCount = rowIds.filter((id) => selectedIdSet.has(id)).length;
  const allSelected = rowIds.length > 0 && selectedCount === rowIds.length;
  const partiallySelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  const currency = group.amountSummary.currency ?? 'BRL';

  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={allSelected}
          aria-label={t('transactions.groupSelect', { label: group.label })}
          onChange={(event) => onSelectRows(rowIds, event.target.checked)}
        />
        <GroupLabel group={group} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">
          {t('table.groupRows', { count: group.count })}
        </span>
        <AmountSummaryItem label={t('transactions.groupPositive')}>
          <FormattedCurrency
            amountCents={group.amountSummary.positiveCents}
            currency={currency}
            signed={false}
          />
        </AmountSummaryItem>
        <AmountSummaryItem label={t('transactions.groupNegative')}>
          <FormattedCurrency
            amountCents={group.amountSummary.negativeCents}
            currency={currency}
            signed={false}
          />
        </AmountSummaryItem>
        <AmountSummaryItem label={t('transactions.groupBalance')}>
          <FormattedCurrency
            amountCents={group.amountSummary.balanceCents}
            currency={currency}
            signed
          />
        </AmountSummaryItem>
        {group.amountSummary.mixedCurrencies ? (
          <span className="text-muted-foreground">{t('transactions.groupMixedCurrency')}</span>
        ) : null}
      </div>
    </>
  );
}

function AmountSummaryItem({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </span>
  );
}

function GroupLabel({ group }: { readonly group: DataTableRowGroup }) {
  if (group.field === 'category' && group.categoryPresentation) {
    return (
      <div className="min-w-0 max-w-72">
        <CategoryBadge presentation={group.categoryPresentation} />
      </div>
    );
  }

  if (group.field === 'label' && group.labelPresentations && group.labelPresentations.length > 0) {
    return (
      <div className="min-w-0 max-w-96">
        <LabelBadgeList labels={group.labelPresentations} />
      </div>
    );
  }

  return <span className="min-w-0 truncate font-medium">{group.label}</span>;
}
