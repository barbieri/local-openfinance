import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from '../../components/data-table/DataTable.js';
import { FormattedCurrency } from '../../components/format/FormattedCurrency.js';
import { FormattedPercent } from '../../components/format/FormattedPercent.js';
import { GrandTotalSummary } from '../../components/format/GrandTotalSummary.js';
import { computeAllocationPercents } from '../../lib/allocation.js';
import { apiJson } from '../../lib/api.js';
import { sumAmountsByCurrency } from '../../lib/currency-totals.js';
import { buildInvestmentTableColumns } from './build-investment-table-columns.js';
import {
  defaultInvestmentVisibleColumns,
  filterInvestmentRows,
  GROUP_BY_COLUMN,
  INVESTMENT_COLUMN_KEYS,
  type InvestmentColumnKey,
  type InvestmentGroupBy,
  investmentAllocationCents,
  investmentAmountCents,
  investmentGroupKey,
  investmentGroupLabel,
  isSingleStatusFilter,
} from './investments-page-helpers.js';

export function InvestmentsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [groupBy, setGroupBy] = useState<InvestmentGroupBy>('none');
  const [visibleColumns, setVisibleColumns] = useState<ReadonlySet<InvestmentColumnKey>>(() =>
    defaultInvestmentVisibleColumns(true),
  );

  const singleStatusFilter = isSingleStatusFilter(statusFilter);
  const effectiveGroupBy = singleStatusFilter && groupBy === 'status' ? 'none' : groupBy;

  const effectiveVisibleColumns = useMemo(() => {
    if (!singleStatusFilter) {
      return visibleColumns;
    }
    const next = new Set(visibleColumns);
    next.delete('status');
    return next;
  }, [singleStatusFilter, visibleColumns]);

  const { data } = useQuery({
    queryKey: ['investments', statusFilter],
    queryFn: () =>
      apiJson<{ rows: Record<string, unknown>[] }>(
        `/api/investments${statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''}`,
      ),
  });

  const rows = useMemo(
    () => filterInvestmentRows(data?.rows ?? [], search, statusFilter),
    [data?.rows, search, statusFilter],
  );

  const allocationById = useMemo(() => {
    const percents = computeAllocationPercents(
      rows.map((row) => ({ ...row, balance_cents: investmentAllocationCents(row) })),
      'balance_cents',
    );
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      const pct = percents.get(index);
      if (pct !== undefined) {
        map.set(String(row.id), pct);
      }
    });
    return map;
  }, [rows]);

  const portfolioAllocationTotalCents = useMemo(
    () => rows.reduce((sum, row) => sum + investmentAllocationCents(row), 0),
    [rows],
  );

  const portfolioTotalsByCurrency = useMemo(
    () => sumAmountsByCurrency(rows, investmentAmountCents, (row) => String(row.currency ?? 'BRL')),
    [rows],
  );

  const hiddenByGroup = effectiveGroupBy !== 'none' ? GROUP_BY_COLUMN[effectiveGroupBy] : undefined;

  const columns = useMemo(
    () =>
      buildInvestmentTableColumns({
        visibleColumns: effectiveVisibleColumns,
        hiddenByGroup,
        allocationById,
        t,
      }),
    [allocationById, effectiveVisibleColumns, hiddenByGroup, t],
  );

  const groupedRows = useMemo(() => {
    if (effectiveGroupBy === 'none') {
      return [{ key: 'all', label: null as string | null, rows }];
    }
    const groups = new Map<
      string,
      { readonly label: string; readonly rows: Record<string, unknown>[] }
    >();
    for (const row of rows) {
      const key = investmentGroupKey(row, effectiveGroupBy);
      const label = investmentGroupLabel(row, effectiveGroupBy);
      const existing = groups.get(key);
      groups.set(key, {
        label,
        rows: existing ? [...existing.rows, row] : [row],
      });
    }
    const groupEntries = [...groups.entries()];
    groupEntries.sort(([, a], [, b]) => a.label.localeCompare(b.label));
    return groupEntries.map(([key, group]) => {
      const totalCents = group.rows.reduce((sum, row) => sum + investmentAmountCents(row), 0);
      const groupAllocationTotalCents = group.rows.reduce(
        (sum, row) => sum + investmentAllocationCents(row),
        0,
      );
      return {
        key,
        label: group.label,
        rows: group.rows,
        totalCents,
        allocationPct:
          portfolioAllocationTotalCents > 0
            ? groupAllocationTotalCents / portfolioAllocationTotalCents
            : 0,
        currency: String(group.rows[0]?.currency ?? 'BRL'),
      };
    });
  }, [effectiveGroupBy, portfolioAllocationTotalCents, rows]);

  const handleStatusFilterChange = (next: string) => {
    setStatusFilter(next);
    if (isSingleStatusFilter(next)) {
      setVisibleColumns((prev) => {
        const updated = new Set(prev);
        updated.delete('status');
        return updated;
      });
      if (groupBy === 'status') {
        setGroupBy('none');
      }
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="min-w-[12rem] rounded border border-input bg-background px-2 py-1 text-sm"
          placeholder={t('filters.searchInvestments')}
          aria-label={t('filters.searchInvestments')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded border border-input bg-background px-2 py-1 text-sm"
          aria-label={t('filters.statusAll')}
          value={statusFilter}
          onChange={(e) => handleStatusFilterChange(e.target.value)}
        >
          <option value="ACTIVE">{t('filters.statusActive')}</option>
          <option value="all">{t('filters.statusAll')}</option>
          <option value="ACTIVE,TOTAL_WITHDRAWAL">{t('filters.statusActiveWithdrawn')}</option>
        </select>
        <select
          className="rounded border border-input bg-background px-2 py-1 text-sm"
          aria-label={t('filters.groupByConnection')}
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as InvestmentGroupBy)}
        >
          <option value="none">{t('filters.noGrouping')}</option>
          <option value="connection">{t('filters.groupByConnection')}</option>
          <option value="account">{t('filters.groupByAccount')}</option>
          <option value="type">{t('filters.groupByType')}</option>
          <option value="subtype">{t('filters.groupBySubtype')}</option>
          {!singleStatusFilter && <option value="status">{t('filters.groupByStatus')}</option>}
          <option value="name">{t('filters.groupByName')}</option>
        </select>
        <details className="rounded border border-border px-2 py-1 text-sm">
          <summary className="cursor-pointer">{t('filters.columns')}</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {INVESTMENT_COLUMN_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={visibleColumns.has(key)}
                  onChange={(e) => {
                    setVisibleColumns((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) {
                        next.add(key);
                      } else if (next.size > 1) {
                        next.delete(key);
                      }
                      return next;
                    });
                  }}
                />
                {t(`columns.${key}`)}
              </label>
            ))}
          </div>
        </details>
      </div>
      <GrandTotalSummary
        label={t('table.grandTotal')}
        countLabel={t('investments.positionCount', { count: rows.length })}
        totalsByCurrency={portfolioTotalsByCurrency}
      />
      {groupedRows.map((group) => (
        <div key={group.key}>
          {group.label && (
            <h3 className="mb-1 flex flex-wrap items-baseline gap-2 text-sm font-semibold text-muted-foreground">
              <span>{group.label}</span>
              {'totalCents' in group && (
                <>
                  <FormattedCurrency
                    amountCents={Number(group.totalCents ?? 0)}
                    currency={String(group.currency ?? 'BRL')}
                    signed={false}
                  />
                  {'allocationPct' in group && (
                    <FormattedPercent value={Number(group.allocationPct ?? 0)} decimals={1} />
                  )}
                </>
              )}
            </h3>
          )}
          <DataTable columns={columns} data={group.rows} emptyMessage={t('table.empty')} />
        </div>
      ))}
    </div>
  );
}
