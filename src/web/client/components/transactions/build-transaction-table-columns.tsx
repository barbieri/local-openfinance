import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy';
import { legacyCreateColumnHelper as createColumnHelper } from '@tanstack/react-table/legacy';
import type { useTranslation } from 'react-i18next';
import type { resolveColumnBadgeDisplay } from '../../lib/column-badge-display.js';
import { LabelsCell } from '../../lib/labels-display.js';
import {
  formatTransactionDateCellValue,
  formatTransactionDateColumnHeader,
} from '../../lib/transaction-date-navigation.js';
import { TransactionCategoryCell } from '../categories/TransactionCategoryCell.js';
import { numericColumn } from '../data-table/column-meta.js';
import { ForeignCurrencyAmount } from '../format/ForeignCurrencyAmount.js';
import { TransferLinkCell } from './TransferLinkTooltip.js';
import {
  TransactionTableAccountCell,
  TransactionTableInstallmentCell,
} from './transaction-table-cells.js';
import type { TransactionColumnKey } from './transactions-page-column-keys.js';
import type { TransactionRow } from './transactions-page-types.js';

export function buildTransactionTableColumns(input: {
  readonly filters: Record<string, string | string[]>;
  readonly selected: readonly string[];
  readonly visibleColumns: ReadonlySet<TransactionColumnKey>;
  readonly categoryColumnDisplay: ReturnType<typeof resolveColumnBadgeDisplay>;
  readonly labelsColumnDisplay: ReturnType<typeof resolveColumnBadgeDisplay>;
  readonly handleRowSelectionChange: (rowId: string, checked: boolean, shiftKey: boolean) => void;
  readonly t: ReturnType<typeof useTranslation>['t'];
  readonly locale: string;
  readonly usePurchaseDate?: boolean | undefined;
}): ColumnDef<TransactionRow, unknown>[] {
  const helper = createColumnHelper<TransactionRow>();
  const all = [
    helper.display({
      id: 'select',
      header: () => null,
      enableSorting: false,
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={input.selected.includes(row.original.id)}
          aria-label={input.t('table.selectRow', {
            label:
              row.original.display_description ?? row.original.merchant_name ?? row.original.id,
          })}
          onChange={(e) => {
            const nativeEvent = e.nativeEvent;
            input.handleRowSelectionChange(
              row.original.id,
              e.target.checked,
              nativeEvent instanceof MouseEvent && nativeEvent.shiftKey,
            );
          }}
        />
      ),
    }),
    helper.accessor('local_date', {
      id: 'date',
      header: () =>
        formatTransactionDateColumnHeader(input.filters, input.locale, input.t, {
          usePurchaseDate: input.usePurchaseDate,
        }),
      enableSorting: true,
      sortDescFirst: true,
      cell: ({ getValue }) =>
        formatTransactionDateCellValue(getValue(), input.filters, input.locale),
    }),
    helper.accessor('account_id', {
      id: 'account',
      header: () => input.t('columns.account'),
      enableSorting: true,
      cell: ({ getValue }) => <TransactionTableAccountCell accountId={getValue()} />,
    }),
    helper.accessor('merchant_name', {
      id: 'merchant',
      header: () => input.t('columns.merchant'),
      enableSorting: true,
      cell: ({ row }) => (
        <div className="min-w-32">
          <div>{row.original.merchant_name ?? '—'}</div>
          <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">
            {row.original.display_description ?? row.original.description ?? '—'}
          </div>
        </div>
      ),
    }),
    helper.accessor('display_description', {
      id: 'description',
      header: () => input.t('columns.description'),
      enableSorting: true,
      cell: ({ row }) => row.original.display_description ?? row.original.description ?? '—',
    }),
    helper.display({
      id: 'category',
      header: () => input.t('columns.category'),
      meta: { align: 'center' },
      enableSorting: true,
      cell: ({ row }) => (
        <div className="space-y-1">
          <TransactionCategoryCell
            presentation={row.original.category_presentation}
            variant={input.categoryColumnDisplay}
          />
          <div className="sm:hidden">
            <LabelsCell row={row.original} variant={input.labelsColumnDisplay} />
          </div>
        </div>
      ),
    }),
    helper.accessor('annotation', {
      id: 'labels',
      header: () => input.t('columns.labels'),
      enableSorting: false,
      cell: ({ row }) => <LabelsCell row={row.original} variant={input.labelsColumnDisplay} />,
    }),
    helper.accessor('transfer_group', {
      id: 'transfer',
      header: () => '⇄',
      meta: { align: 'center' },
      enableSorting: false,
      cell: ({ row }) => <TransferLinkCell transferGroup={row.original.transfer_group} />,
    }),
    helper.display({
      id: 'installments',
      header: () => input.t('columns.installments'),
      meta: { align: 'center' },
      enableSorting: false,
      cell: ({ row }) => <TransactionTableInstallmentCell row={row.original} />,
    }),
    helper.accessor('amount_cents', {
      id: 'amount',
      header: () => input.t('columns.amount'),
      ...numericColumn<TransactionRow>(),
      cell: ({ row }) => (
        <ForeignCurrencyAmount
          amountCents={row.original.amount_cents}
          currency={row.original.currency}
          accountCurrency={row.original.account_currency}
          amountInAccountCurrencyCents={row.original.amount_in_account_currency_cents}
        />
      ),
    }),
  ] as ColumnDef<TransactionRow, unknown>[];

  return all.filter((col) => input.visibleColumns.has(col.id as TransactionColumnKey));
}
