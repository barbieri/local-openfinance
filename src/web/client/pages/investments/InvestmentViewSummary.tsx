import { useTranslation } from 'react-i18next';
import type { InvestmentViewSummaryPart } from './investments-page-helpers.js';

export function InvestmentViewSummaryParts({
  parts,
}: {
  readonly parts: readonly InvestmentViewSummaryPart[];
}) {
  const { t } = useTranslation();

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {parts.map((part) => (
        <span
          key={part.id}
          className="inline-flex max-w-full items-center rounded border border-border bg-background px-1.5 py-0.5 text-xs"
        >
          {part.id === 'search'
            ? `${t('filters.searchInvestments')}: ${part.value}`
            : t(part.translationKey)}
        </span>
      ))}
    </span>
  );
}
