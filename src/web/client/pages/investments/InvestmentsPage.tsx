import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from '../../components/data-table/DataTable.js';
import { FormattedCurrency } from '../../components/format/FormattedCurrency.js';
import { FormattedPercent } from '../../components/format/FormattedPercent.js';
import { GrandTotalSummary } from '../../components/format/GrandTotalSummary.js';
import { Disclosure } from '../../components/ui/Disclosure.js';
import { DisclosureContent } from '../../components/ui/DisclosureContent.js';
import { DisclosureSummary } from '../../components/ui/DisclosureSummary.js';
import { apiJson } from '../../lib/api.js';
import { useAppNavigation } from '../../lib/navigation.js';
import { buildInvestmentTableColumns } from './build-investment-table-columns.js';
import { InvestmentMatchSummary } from './InvestmentMatchSummary.js';
import { InvestmentSidebar, InvestmentSidebarToggle } from './InvestmentSidebar.js';
import {
  buildInvestmentAllocationCurrencyCharts,
  buildInvestmentAllocationModel,
  clearInvestmentAllocationChartSelections,
  type InvestmentAllocationPosition,
  type InvestmentAllocationSelection,
  summarizeInvestmentAllocationGroup,
} from './investment-allocation-chart-data.js';
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

const InvestmentAllocationCharts = lazy(() =>
  import('./InvestmentAllocationCharts.js').then((module) => ({
    default: module.InvestmentAllocationCharts,
  })),
);

function readableInvestmentValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function investmentAllocationPosition(row: Record<string, unknown>): InvestmentAllocationPosition {
  const id = String(row.id ?? '');
  const code = readableInvestmentValue(row.code, '');
  return {
    id,
    currency: readableInvestmentValue(row.currency, 'BRL'),
    type: readableInvestmentValue(row.type, 'Unknown'),
    subtype: readableInvestmentValue(row.subtype, 'Unknown'),
    code: code || null,
    displayName: readableInvestmentValue(
      row.display_name,
      readableInvestmentValue(row.name, id || 'Unknown'),
    ),
    totalCents: investmentAmountCents(row),
    allocationCents: investmentAllocationCents(row),
  };
}

export function InvestmentsPage() {
  const { t } = useTranslation();
  const { openInvestmentPermalink } = useAppNavigation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [groupBy, setGroupBy] = useState<InvestmentGroupBy>(DEFAULT_INVESTMENT_GROUP_BY);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chartsOpen, setChartsOpen] = useState(false);
  const [chartSelections, setChartSelections] = useState<
    Readonly<Record<string, InvestmentAllocationSelection>>
  >({});
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

  const allocationModel = useMemo(
    () => buildInvestmentAllocationModel(rows.map(investmentAllocationPosition)),
    [rows],
  );

  const allocationCharts = useMemo(
    () =>
      chartsOpen ? buildInvestmentAllocationCurrencyCharts(allocationModel, chartSelections) : [],
    [allocationModel, chartSelections, chartsOpen],
  );

  const hiddenByGroup = effectiveGroupBy !== 'none' ? GROUP_BY_COLUMN[effectiveGroupBy] : undefined;

  const columns = useMemo(
    () =>
      buildInvestmentTableColumns({
        visibleColumns: effectiveVisibleColumns,
        hiddenByGroup,
        allocationById: allocationModel.allocationById,
        onOpenInvestment: openInvestmentPermalink,
        t,
      }),
    [
      allocationModel.allocationById,
      effectiveVisibleColumns,
      hiddenByGroup,
      openInvestmentPermalink,
      t,
    ],
  );

  const groupedRows = useMemo(() => {
    if (effectiveGroupBy === 'none') {
      return [
        {
          key: 'all',
          label: null as string | null,
          rows,
          summary: summarizeInvestmentAllocationGroup(
            allocationModel,
            rows.map((row) => String(row.id ?? '')),
          ),
        },
      ];
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
    return groupEntries.map(([key, group]) => ({
      key,
      label: group.label,
      rows: group.rows,
      summary: summarizeInvestmentAllocationGroup(
        allocationModel,
        group.rows.map((row) => String(row.id ?? '')),
      ),
    }));
  }, [allocationModel, effectiveGroupBy, rows]);

  const handleStatusFilterChange = (next: string) => {
    setStatusFilter(next);
    setChartSelections(clearInvestmentAllocationChartSelections);
    const updatedView = updateInvestmentViewForStatusFilter({
      statusFilter: next,
      groupBy,
      visibleColumns,
    });
    setGroupBy(updatedView.groupBy);
    setVisibleColumns(updatedView.visibleColumns);
  };

  const handleSearchChange = (next: string) => {
    setSearch(next);
    setChartSelections(clearInvestmentAllocationChartSelections);
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
        totalsByCurrency={allocationModel.amountTotalsByCurrency}
      />
      <Disclosure className="bg-muted/20" open={chartsOpen} onOpenChange={setChartsOpen}>
        <DisclosureSummary>
          <span className="font-medium">{t('investmentCharts.title')}</span>
        </DisclosureSummary>
        <DisclosureContent>
          {chartsOpen && (
            <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>
              <InvestmentAllocationCharts
                charts={allocationCharts}
                onSelect={(currency, selection) =>
                  setChartSelections((current) => ({ ...current, [currency]: selection }))
                }
              />
            </Suspense>
          )}
        </DisclosureContent>
      </Disclosure>
      {groupedRows.map((group) => (
        <div key={group.key}>
          {group.label && (
            <h3 className="mb-1 flex flex-wrap items-baseline gap-2 text-sm font-semibold text-muted-foreground">
              <span>{group.label}</span>
              {group.summary.currencies.map((currencySummary) => (
                <span key={currencySummary.currency} className="inline-flex items-baseline gap-1">
                  <FormattedCurrency
                    amountCents={currencySummary.totalCents}
                    currency={currencySummary.currency}
                    signed={false}
                  />
                  {currencySummary.allocationPercent === null ? null : (
                    <FormattedPercent value={currencySummary.allocationPercent} decimals={1} />
                  )}
                </span>
              ))}
            </h3>
          )}
          <DataTable columns={columns} data={group.rows} emptyMessage={t('table.empty')} />
        </div>
      ))}
      <InvestmentSidebar
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        search={search}
        onSearchChange={handleSearchChange}
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
