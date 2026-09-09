import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy';
import { legacyCreateColumnHelper as createColumnHelper } from '@tanstack/react-table/legacy';
import type { useTranslation } from 'react-i18next';
import { numericColumn } from '../../components/data-table/column-meta.js';
import { ConnectionCell } from '../../components/entities/ConnectionCell.js';
import { FormattedDate } from '../../components/format/dates.js';
import { FormattedCurrency } from '../../components/format/FormattedCurrency.js';
import { FormattedPercent } from '../../components/format/FormattedPercent.js';
import { FormattedNumber } from '../../components/format/numbers.js';
import {
  type InvestmentColumnKey,
  investmentAccountLabel,
  investmentAmountCents,
  investmentIssuerLabel,
  investmentRateLabel,
} from './investments-page-helpers.js';

export function buildInvestmentTableColumns(input: {
  readonly visibleColumns: ReadonlySet<InvestmentColumnKey>;
  readonly hiddenByGroup: InvestmentColumnKey | undefined;
  readonly allocationById: ReadonlyMap<string, number>;
  readonly t: ReturnType<typeof useTranslation>['t'];
}): ColumnDef<Record<string, unknown>, unknown>[] {
  const h = createColumnHelper<Record<string, unknown>>();
  const currencyCell = (cents: number | null | undefined, currency: string) =>
    cents === null || cents === undefined ? (
      <>—</>
    ) : (
      <FormattedCurrency amountCents={Number(cents)} currency={currency} signed={false} />
    );

  const all = [
    h.display({
      id: 'connection',
      header: () => input.t('columns.connection'),
      enableSorting: true,
      cell: ({ row }) => (
        <ConnectionCell connectionId={String(row.original.connection_item_id ?? '')} />
      ),
    }),
    h.display({
      id: 'account',
      header: () => input.t('columns.account'),
      enableSorting: true,
      cell: ({ row }) => investmentAccountLabel(row.original),
    }),
    h.display({
      id: 'name',
      header: () => input.t('columns.name'),
      enableSorting: true,
      cell: ({ row }) => String(row.original.display_name ?? row.original.name ?? '—'),
    }),
    h.accessor('code', { id: 'code', header: () => input.t('columns.code'), enableSorting: true }),
    h.accessor('type', { id: 'type', header: () => input.t('columns.type'), enableSorting: true }),
    h.accessor('subtype', {
      id: 'subtype',
      header: () => input.t('columns.subtype'),
      enableSorting: true,
    }),
    h.accessor('status', {
      id: 'status',
      header: () => input.t('columns.status'),
      enableSorting: true,
    }),
    h.display({
      id: 'total',
      header: () => input.t('columns.total'),
      ...numericColumn<Record<string, unknown>>(),
      cell: ({ row }) =>
        currencyCell(investmentAmountCents(row.original), String(row.original.currency ?? 'BRL')),
    }),
    h.display({
      id: 'quantity',
      header: () => input.t('columns.quantity'),
      ...numericColumn<Record<string, unknown>>(),
      cell: ({ row }) => {
        const quantity = row.original.quantity;
        if (quantity === null || quantity === undefined) {
          return <>—</>;
        }
        return <FormattedNumber value={Number(quantity)} />;
      },
    }),
    h.display({
      id: 'unitPrice',
      header: () => input.t('columns.unitPrice'),
      ...numericColumn<Record<string, unknown>>(),
      cell: ({ row }) =>
        currencyCell(
          row.original.unit_price_cents as number | null,
          String(row.original.currency ?? 'BRL'),
        ),
    }),
    h.display({
      id: 'isin',
      header: () => input.t('columns.isin'),
      enableSorting: true,
      cell: ({ row }) => String(row.original.isin ?? '—'),
    }),
    h.display({
      id: 'rate',
      header: () => input.t('columns.rate'),
      enableSorting: true,
      cell: ({ row }) => investmentRateLabel(row.original) ?? '—',
    }),
    h.display({
      id: 'issuer',
      header: () => input.t('columns.issuer'),
      enableSorting: true,
      cell: ({ row }) => investmentIssuerLabel(row.original) ?? '—',
    }),
    h.display({
      id: 'purchaseDate',
      header: () => input.t('columns.purchaseDate'),
      enableSorting: true,
      cell: ({ row }) => <FormattedDate value={String(row.original.purchase_date ?? '')} />,
    }),
    h.display({
      id: 'dueDate',
      header: () => input.t('columns.dueDate'),
      enableSorting: true,
      cell: ({ row }) => <FormattedDate value={String(row.original.due_date ?? '')} />,
    }),
    h.display({
      id: 'taxes',
      header: () => input.t('columns.taxes'),
      ...numericColumn<Record<string, unknown>>(),
      cell: ({ row }) =>
        currencyCell(
          row.original.taxes_cents as number | null,
          String(row.original.currency ?? 'BRL'),
        ),
    }),
    h.display({
      id: 'taxes2',
      header: () => input.t('columns.taxes2'),
      ...numericColumn<Record<string, unknown>>(),
      cell: ({ row }) =>
        currencyCell(
          row.original.taxes2_cents as number | null,
          String(row.original.currency ?? 'BRL'),
        ),
    }),
    h.display({
      id: 'allocation',
      header: () => input.t('columns.allocation'),
      ...numericColumn<Record<string, unknown>>(),
      cell: ({ row }) => {
        const pct = input.allocationById.get(String(row.original.id));
        return pct !== undefined ? <FormattedPercent value={pct} decimals={1} /> : <>—</>;
      },
    }),
  ];
  return all.filter(
    (col) =>
      input.visibleColumns.has(col.id as InvestmentColumnKey) && col.id !== input.hiddenByGroup,
  );
}
