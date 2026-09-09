import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { lazy, type ReactNode, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  aggregateCategoryBreakdownFromTotals,
  aggregateLabelBreakdownFromTotals,
  aggregateTopLevelCategoriesFromTotals,
  aggregateTopLevelLabelsFromTotals,
  type ChartCategoryRef,
  type ChartLabelRef,
  categoryHasSubcategoryBreakdownFromTotals,
  labelHasSubLabelBreakdownFromTotals,
} from '../../../../chart/transaction-aggregates.js';
import type {
  TransactionChartCategorySection,
  TransactionChartLabelSection,
  TransactionChartSection,
} from '../../../../db/transaction-charts.js';
import { apiJson } from '../../lib/api.js';
import { formatCurrencyAmount } from '../../lib/format.js';
import type { TransactionChartTab } from '../../lib/table-url-state.js';
import { hasNonBalanceScopeFilters } from '../../lib/transaction-filters.js';
import type { LabelRecord } from '../labels/LabelEditDialog.js';
import { Disclosure } from '../ui/Disclosure.js';
import { DisclosureContent } from '../ui/DisclosureContent.js';
import { DisclosureSummary } from '../ui/DisclosureSummary.js';

const TransactionBalanceLineChart = lazy(() =>
  import('./TransactionBalanceLineChart.js').then((module) => ({
    default: module.TransactionBalanceLineChart,
  })),
);
const CategoryAllocationCharts = lazy(() =>
  import('./CategoryAllocationCharts.js').then((module) => ({
    default: module.CategoryAllocationCharts,
  })),
);
const LabelAllocationCharts = lazy(() =>
  import('./LabelAllocationCharts.js').then((module) => ({
    default: module.LabelAllocationCharts,
  })),
);

function ChartSuspense({ children }: { readonly children: ReactNode }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">…</p>}>{children}</Suspense>
  );
}

const EMPTY_CATEGORY_BY_ID: Record<string, Record<string, unknown>> = {};
const EMPTY_LABEL_BY_ID: Record<string, LabelRecord> = {};
const EMPTY_TABLE_FILTERS: Record<string, string | string[]> = {};

const CHART_TABS: readonly TransactionChartTab[] = ['balance', 'category', 'label'];

export type TransactionChartsState = {
  readonly open?: boolean;
  readonly tab?: TransactionChartTab;
};

function buildChartCategoryById(
  byId: Record<string, Record<string, unknown>>,
): Record<string, ChartCategoryRef> {
  const result: Record<string, ChartCategoryRef> = {};
  for (const [id, raw] of Object.entries(byId)) {
    const presentation = raw['presentation'] as
      | { readonly name?: string; readonly color?: string }
      | undefined;
    result[id] = {
      id,
      parent_id: typeof raw['parent_id'] === 'string' ? raw['parent_id'] : null,
      name: presentation?.name ?? String(raw['name_translated'] ?? raw['name'] ?? id),
      color: presentation?.color ?? '#64748b',
    };
  }
  return result;
}

function buildChartLabelById(byId: Record<string, LabelRecord>): Record<string, ChartLabelRef> {
  const result: Record<string, ChartLabelRef> = {};
  for (const label of Object.values(byId)) {
    result[label.id] = {
      id: label.id,
      parent_id: label.parent_id,
      name: label.name,
      color: label.color,
    };
  }
  return result;
}

function chartTabLabel(tab: TransactionChartTab, t: (key: string) => string): string {
  switch (tab) {
    case 'balance':
      return t('charts.dailyBalance');
    case 'category':
      return t('charts.byCategory');
    case 'label':
      return t('charts.byLabel');
  }
}

function CategoryChartPanel({
  data,
  categoryById,
}: {
  readonly data: TransactionChartCategorySection;
  readonly categoryById: Record<string, Record<string, unknown>>;
}) {
  const { t } = useTranslation();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const chartCategories = useMemo(() => buildChartCategoryById(categoryById), [categoryById]);

  const categoryBuckets = useMemo(
    () =>
      aggregateTopLevelCategoriesFromTotals(
        data.categoryTotals,
        chartCategories,
        t('charts.uncategorized'),
      ),
    [chartCategories, data.categoryTotals, t],
  );

  const subCategoryBuckets = useMemo(() => {
    if (!selectedCategoryId) {
      return [];
    }
    if (
      !categoryHasSubcategoryBreakdownFromTotals(
        data.categoryTotals,
        chartCategories,
        selectedCategoryId,
      )
    ) {
      return [];
    }
    return aggregateCategoryBreakdownFromTotals(
      data.categoryTotals,
      chartCategories,
      selectedCategoryId,
    );
  }, [chartCategories, data.categoryTotals, selectedCategoryId]);

  const selectedCategoryName =
    selectedCategoryId != null ? (chartCategories[selectedCategoryId]?.name ?? null) : null;

  if (categoryBuckets.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('charts.noCategoryData')}</p>;
  }

  return (
    <ChartSuspense>
      <CategoryAllocationCharts
        buckets={categoryBuckets}
        subBuckets={subCategoryBuckets}
        selectedCategoryId={selectedCategoryId}
        selectedCategoryName={selectedCategoryName}
        currency={data.currency}
        onSelectCategory={setSelectedCategoryId}
      />
    </ChartSuspense>
  );
}

function LabelChartPanel({
  data,
  labelById,
}: {
  readonly data: TransactionChartLabelSection;
  readonly labelById: Record<string, LabelRecord>;
}) {
  const { t } = useTranslation();
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);

  const chartLabels = useMemo(() => buildChartLabelById(labelById), [labelById]);

  const labelBuckets = useMemo(
    () => aggregateTopLevelLabelsFromTotals(data.labelTotals, chartLabels),
    [chartLabels, data.labelTotals],
  );

  const subLabelBuckets = useMemo(() => {
    if (!selectedLabelId) {
      return [];
    }
    if (!labelHasSubLabelBreakdownFromTotals(data.labelTotals, chartLabels, selectedLabelId)) {
      return [];
    }
    return aggregateLabelBreakdownFromTotals(data.labelTotals, chartLabels, selectedLabelId);
  }, [chartLabels, data.labelTotals, selectedLabelId]);

  const selectedLabelName =
    selectedLabelId != null ? (chartLabels[selectedLabelId]?.name ?? null) : null;

  if (labelBuckets.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('charts.noLabelData')}</p>;
  }

  return (
    <ChartSuspense>
      <LabelAllocationCharts
        buckets={labelBuckets}
        subBuckets={subLabelBuckets}
        selectedLabelId={selectedLabelId}
        selectedLabelName={selectedLabelName}
        currency={data.currency}
        onSelectLabel={setSelectedLabelId}
      />
    </ChartSuspense>
  );
}

function ChartPanel({
  data,
  categoryById,
  labelById,
  ignoresNonScopeFilters,
}: {
  readonly data: TransactionChartSection;
  readonly categoryById: Record<string, Record<string, unknown>>;
  readonly labelById: Record<string, LabelRecord>;
  readonly ignoresNonScopeFilters: boolean;
}) {
  switch (data.chart) {
    case 'balance':
      return (
        <ChartSuspense>
          <TransactionBalanceLineChart
            data={data}
            currency={data.currency}
            ignoresNonScopeFilters={ignoresNonScopeFilters}
          />
        </ChartSuspense>
      );
    case 'category':
      return <CategoryChartPanel data={data} categoryById={categoryById} />;
    case 'label':
      return <LabelChartPanel data={data} labelById={labelById} />;
  }
}

function buildChartsCollapsedSummary(input: {
  readonly chartsOpen: boolean;
  readonly summaryTab: TransactionChartTab | undefined;
  readonly summaryCount: number | undefined;
  readonly t: (key: string, options?: Record<string, unknown>) => string;
}): string | null {
  if (input.chartsOpen || !input.summaryTab) {
    return null;
  }

  const tabLabel = chartTabLabel(input.summaryTab, input.t);
  if (input.summaryCount == null || input.summaryCount <= 0) {
    return `: ${tabLabel}`;
  }

  const countLabel =
    input.summaryTab === 'balance'
      ? input.t('charts.dayCount', { count: input.summaryCount })
      : input.t('charts.matchingCount', { count: input.summaryCount });

  return `: ${tabLabel} · ${countLabel}`;
}

export function TransactionCharts({
  chartQueryString,
  chartState,
  onChartStateChange,
  matchingTotal,
  tableFilters = EMPTY_TABLE_FILTERS,
  categoryById = EMPTY_CATEGORY_BY_ID,
  labelById = EMPTY_LABEL_BY_ID,
}: {
  readonly chartQueryString: string;
  readonly chartState: TransactionChartsState;
  readonly onChartStateChange: (patch: Partial<TransactionChartsState>) => void;
  readonly matchingTotal?: number;
  readonly tableFilters?: Record<string, string | string[]>;
  readonly categoryById?: Record<string, Record<string, unknown>>;
  readonly labelById?: Record<string, LabelRecord>;
}) {
  const { t } = useTranslation();
  const chartsOpen = chartState.open === true;
  const activeTab = chartState.tab;
  const shouldFetch = chartsOpen && activeTab != null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['transaction-charts', chartQueryString, activeTab],
    queryFn: () =>
      apiJson<TransactionChartSection>(
        `/api/transactions/charts?${chartQueryString}&chart=${activeTab}`,
      ),
    enabled: shouldFetch,
  });

  const handleOpenChange = (open: boolean): void => {
    if (open) {
      onChartStateChange({
        open: true,
        tab: chartState.tab ?? 'balance',
      });
      return;
    }
    onChartStateChange({ open: false });
  };

  const handleTabChange = (tab: TransactionChartTab): void => {
    onChartStateChange({ open: true, tab });
  };

  const summaryTab = activeTab;
  const summaryCount = data?.total ?? matchingTotal;
  const ignoresNonScopeFilters = hasNonBalanceScopeFilters(tableFilters);
  const collapsedSummary = buildChartsCollapsedSummary({
    chartsOpen,
    summaryTab,
    summaryCount,
    t,
  });

  return (
    <Disclosure className="bg-muted/20" open={chartsOpen} onOpenChange={handleOpenChange}>
      <DisclosureSummary>
        <span className="font-medium">{t('charts.title')}</span>
        {collapsedSummary && (
          <span className="hidden font-normal text-muted-foreground sm:inline">
            {collapsedSummary}
          </span>
        )}
      </DisclosureSummary>
      <DisclosureContent className="space-y-4">
        <div
          className="flex flex-wrap gap-1 border-b border-border pb-2"
          role="tablist"
          aria-label={t('charts.title')}
        >
          {CHART_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={clsx(
                'rounded px-3 py-1 text-sm transition-colors',
                activeTab === tab
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
              onClick={() => handleTabChange(tab)}
            >
              {chartTabLabel(tab, t)}
            </button>
          ))}
        </div>

        {!activeTab && <p className="text-sm text-muted-foreground">{t('charts.selectTabHint')}</p>}

        {shouldFetch && isLoading && (
          <p className="text-sm text-muted-foreground">{t('charts.loading')}</p>
        )}

        {shouldFetch && isError && (
          <p className="text-sm text-destructive">{t('charts.loadError')}</p>
        )}

        {shouldFetch && data && data.total === 0 && activeTab !== 'balance' && (
          <p className="text-sm text-muted-foreground">{t('charts.noData')}</p>
        )}

        {shouldFetch && data && (data.total > 0 || data.chart === 'balance') && (
          <ChartPanel
            data={data}
            categoryById={categoryById}
            labelById={labelById}
            ignoresNonScopeFilters={ignoresNonScopeFilters}
          />
        )}
      </DisclosureContent>
    </Disclosure>
  );
}

export function AllocationPie({
  rows,
  nameKey,
  valueKey,
  currency = 'BRL',
}: {
  readonly rows: readonly Record<string, unknown>[];
  readonly nameKey: string;
  readonly valueKey: string;
  readonly currency?: string;
}) {
  const { t, i18n } = useTranslation();
  const data = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const name = String(row[nameKey] ?? 'Unknown');
      const cents = Number(row[valueKey] ?? 0);
      totals.set(name, (totals.get(name) ?? 0) + Math.abs(cents));
    }
    return [...totals.entries()].map(([name, cents]) => ({
      name,
      cents,
    }));
  }, [rows, nameKey, valueKey]);

  if (data.length === 0) {
    return null;
  }

  return (
    <section className="rounded-md border border-border p-3">
      <h3 className="font-medium">{t('charts.allocation')}</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {data.map((item) => (
          <li key={item.name} className="flex justify-between tabular-nums">
            <span>{item.name}</span>
            <span>{formatCurrencyAmount(item.cents, currency, i18n.language)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
