import type { TFunction } from 'i18next';
import type { TransactionSummary } from '../../../../db/transaction-foreign-amount.js';
import {
  formatLocalDateRangeLabel,
  resolveEffectiveTransactionDateFilter,
} from '../../lib/transaction-date-navigation.js';
import type { TransactionFilterSummaryPart } from '../../lib/transaction-filters.js';
import { FormattedCurrency } from '../format/FormattedCurrency.js';

export function TransactionMatchSummary({
  total,
  summary,
  filters,
  filterSummaryParts,
  t,
  locale,
}: {
  readonly total: number;
  readonly summary: readonly TransactionSummary[];
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
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>
        {t('pagination.matchingTotalScoped', {
          total,
          period: period ?? t('pagination.allPeriods'),
        })}
        {filtersLabel ? ` · ${t('filters.active')}: ${filtersLabel}` : ''}
      </p>
      {summary.map((item) => (
        <p key={item.currency} className="flex flex-wrap gap-x-3">
          <span>
            {t('pagination.matchingDebits', { count: item.debitCount })}{' '}
            <FormattedCurrency amountCents={item.debitCents} currency={item.currency} />
          </span>
          <span>
            {t('pagination.matchingCredits', { count: item.creditCount })}{' '}
            <FormattedCurrency amountCents={item.creditCents} currency={item.currency} />
          </span>
          <span>
            {t('pagination.matchingBalance')}{' '}
            <FormattedCurrency amountCents={item.balanceCents} currency={item.currency} />
          </span>
        </p>
      ))}
    </div>
  );
}
