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
import { useAppNavigation } from '../../lib/navigation.js';
import { buildInvestmentTableColumns } from './build-investment-table-columns.js';
import { InvestmentMatchSummary } from './InvestmentMatchSummary.js';
import { InvestmentSidebar, InvestmentSidebarToggle } from './InvestmentSidebar.js';
import {
  buildInvestmentViewSummary,
  DEFAULT_INVESTMENT_GROUP_BY,
  defaultInvestmentVisibleColumns,
  effectiveInvestmentVisibleColumns,
  ensureInvestmentVisibleColumns,
  filterInvestmentRows,
  GROUP_BY_COLUMN,
  type InvestmentColumnKey,
  type InvestmentGroupBy,
  investmentAllocationCents,
  investmentAmountCents,
  investmentGroupKey,
  investmentGroupLabel,
  isSingleStatusFilter,
  toggleInvestmentVisibleColumn,
  updateInvestmentViewForStatusFilter,
} from './investments-page-helpers.js';

export function InvestmentsPage() {
  const { t } = useTranslation();
  const { openInvestmentPermalink } = useAppNavigation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [groupBy, setGroupBy] = useState<InvestmentGroupBy>(DEFAULT_INVESTMENT_GROUP_BY);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<ReadonlySet<InvestmentColumnKey>>(() =>
    defaultInvestmentVisibleColumns(true),
  );

  const singleStatusFilter = isSingleStatusFilter(statusFilter);
  const effectiveGroupBy = singleStatusFilter && groupBy === 'status' ? 'none' : groupBy;

  const effectiveVisibleColumns = useMemo(() => {
    return effectiveInvestmentVisibleColumns({
      visibleColumns,
      groupBy: effectiveGroupBy,
      singleStatus: singleStatusFilter,
    });
  }, [effectiveGroupBy, singleStatusFilter, visibleColumns]);

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

  const viewSummary = useMemo(
    () => buildInvestmentViewSummary({ search, statusFilter, groupBy: effectiveGroupBy }),
    [effectiveGroupBy, search, statusFilter],
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
        onOpenInvestment: openInvestmentPermalink,
        t,
      }),
    [allocationById, effectiveVisibleColumns, hiddenByGroup, openInvestmentPermalink, t],
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
    const updatedView = updateInvestmentViewForStatusFilter({
      statusFilter: next,
      groupBy,
      visibleColumns,
    });
    setGroupBy(updatedView.groupBy);
    setVisibleColumns(updatedView.visibleColumns);
  };

  const handleGroupByChange = (next: InvestmentGroupBy) => {
    setGroupBy(next);
    setVisibleColumns((current) =>
      ensureInvestmentVisibleColumns({
        visibleColumns: current,
        groupBy: next,
        singleStatus: singleStatusFilter,
      }),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <InvestmentMatchSummary total={rows.length} viewSummary={viewSummary} />
        <InvestmentSidebarToggle
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          viewSummary={viewSummary}
        />
      </div>
      <GrandTotalSummary
        label={t('table.grandTotal')}
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
      <InvestmentSidebar
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusFilterChange}
        groupBy={effectiveGroupBy}
        onGroupByChange={handleGroupByChange}
        singleStatusFilter={singleStatusFilter}
        visibleColumns={visibleColumns}
        onToggleColumn={(key, checked) =>
          setVisibleColumns((current) =>
            toggleInvestmentVisibleColumn({
              visibleColumns: current,
              groupBy: effectiveGroupBy,
              singleStatus: singleStatusFilter,
              key,
              checked,
            }),
          )
        }
      />
    </div>
  );
}
