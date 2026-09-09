import type { TFunction } from 'i18next';
import {
  formatLocalDateRangeLabel,
  resolveEffectiveTransactionDateFilter,
} from '../../lib/transaction-date-navigation.js';
import type { TransactionFilterSummaryPart } from '../../lib/transaction-filters.js';

export function TransactionMatchSummary({
  total,
  filters,
  filterSummaryParts,
  t,
  locale,
}: {
  readonly total: number;
  readonly filters: Record<string, string | string[]>;
  readonly filterSummaryParts: readonly TransactionFilterSummaryPart[];
  readonly t: TFunction;
  readonly locale: string;
}) {
  const dateFilter = resolveEffectiveTransactionDateFilter(filters);
  const period = dateFilter ? formatLocalDateRangeLabel(dateFilter.range, locale) : null;
  const filterLabels: string[] = [];
  for (const part of filterSummaryParts) {
    if (part.id === 'date') {
      continue;
    }
    filterLabels.push(part.value ? `${part.label}: ${part.value}` : part.label);
  }
  const filtersLabel = filterLabels.join(', ');
  return (
    <p className="text-sm text-muted-foreground">
      {t('pagination.matchingTotalScoped', { total, period: period ?? t('pagination.allPeriods') })}
      {filtersLabel ? ` · ${t('filters.active')}: ${filtersLabel}` : ''}
    </p>
  );
}
