import { useTranslation } from 'react-i18next';
import { InvestmentViewSummaryParts } from './InvestmentViewSummary.js';
import type { InvestmentViewSummaryPart } from './investments-page-helpers.js';

export function InvestmentMatchSummary({
  total,
  viewSummary,
}: {
  readonly total: number;
  readonly viewSummary: readonly InvestmentViewSummaryPart[];
}) {
  const { t } = useTranslation();

  return (
    <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      <span>{t('investments.matchingPositionCount', { count: total })}</span>
      <span aria-hidden>·</span>
      <span>{t('filters.active')}:</span>
      <InvestmentViewSummaryParts parts={viewSummary} />
    </p>
  );
}
