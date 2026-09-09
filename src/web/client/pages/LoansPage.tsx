import { useQuery } from '@tanstack/react-query';
import { legacyCreateColumnHelper as createColumnHelper } from '@tanstack/react-table/legacy';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { numericColumn } from '../components/data-table/column-meta.js';
import { DataTable } from '../components/data-table/DataTable.js';
import { FormattedDate } from '../components/format/dates.js';
import { FormattedCurrency } from '../components/format/FormattedCurrency.js';
import { FormattedPercent } from '../components/format/FormattedPercent.js';
import { GrandTotalSummary } from '../components/format/GrandTotalSummary.js';
import { computeAllocationPercents } from '../lib/allocation.js';
import { apiJson } from '../lib/api.js';
import { sumAmountsByCurrency } from '../lib/currency-totals.js';

const EMPTY_LOAN_ROWS: Record<string, unknown>[] = [];

export function LoansPage() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['loans'],
    queryFn: () => apiJson<{ rows: Record<string, unknown>[] }>('/api/loans'),
  });
  const rows = data?.rows ?? EMPTY_LOAN_ROWS;
  const balanceTotalsByCurrency = useMemo(() => {
    const loanRows = data?.rows ?? EMPTY_LOAN_ROWS;
    return sumAmountsByCurrency(
      loanRows,
      (row) => Number(row.balance_cents ?? 0),
      (row) => String(row.currency ?? 'BRL'),
    );
  }, [data?.rows]);
  const allocationById = useMemo(() => {
    const loanRows = data?.rows ?? EMPTY_LOAN_ROWS;
    const percents = computeAllocationPercents(loanRows, 'balance_cents');
    const map = new Map<string, number>();
    loanRows.forEach((row, index) => {
      const pct = percents.get(index);
      if (pct !== undefined) {
        map.set(String(row.id), pct);
      }
    });
    return map;
  }, [data?.rows]);

  const columns = useMemo(() => {
    const h = createColumnHelper<Record<string, unknown>>();
    return [
      h.accessor('name', { header: () => t('columns.name') }),
      h.accessor('contract_amount_cents', {
        header: () => t('columns.contract'),
        ...numericColumn<Record<string, unknown>>(),
        cell: ({ row }) => (
          <FormattedCurrency
            amountCents={Number(row.original.contract_amount_cents ?? 0)}
            currency={String(row.original.currency ?? 'BRL')}
          />
        ),
      }),
      h.accessor('balance_cents', {
        header: () => t('columns.balance'),
        ...numericColumn<Record<string, unknown>>(),
        cell: ({ row }) => (
          <FormattedCurrency
            amountCents={Number(row.original.balance_cents ?? 0)}
            currency={String(row.original.currency ?? 'BRL')}
          />
        ),
      }),
      h.display({
        id: 'allocation',
        header: () => t('columns.allocation'),
        ...numericColumn<Record<string, unknown>>(),
        cell: ({ row }) => {
          const pct = allocationById.get(String(row.original.id));
          return pct !== undefined ? <FormattedPercent value={pct} decimals={1} /> : <>—</>;
        },
      }),
      h.accessor('due_date', {
        header: () => t('columns.dueDate'),
        cell: ({ getValue }) => <FormattedDate value={String(getValue() ?? '')} />,
      }),
    ];
  }, [allocationById, t]);

  return (
    <div className="space-y-3">
      <GrandTotalSummary
        label={t('table.grandTotal')}
        countLabel={t('loans.loanCount', { count: rows.length })}
        totalsByCurrency={balanceTotalsByCurrency}
      />
      <DataTable columns={columns} data={rows} emptyMessage={t('table.empty')} />
    </div>
  );
}
