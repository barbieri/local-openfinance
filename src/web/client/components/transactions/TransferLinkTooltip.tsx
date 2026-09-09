import { useTranslation } from 'react-i18next';
import { isForeignCurrencyTransaction } from '../../../../db/transaction-foreign-amount.js';
import { formatCurrencyAmount, formatDualCurrencyAmount } from '../../lib/format.js';
import { formatRelativeOrAbsoluteDate } from '../../lib/format-relative-date.js';
import type { CategoryPresentation } from '../categories/category-badge-presentation.js';
import { MaterialIcon } from '../ui/IconPicker.js';
import { Tooltip } from '../ui/Tooltip.js';

export type TransferRelatedLeg = {
  readonly transaction_id: string;
  readonly account_id: string;
  readonly account_display_name: string;
  readonly amount_cents: number;
  readonly amount_in_account_currency_cents: number;
  readonly currency: string;
  readonly account_currency: string;
  readonly occurred_at: string;
  readonly role: string;
  readonly description: string | null;
  readonly merchant_name: string | null;
  readonly display_name: string;
  readonly amount_difference_cents: number;
  readonly category_presentation: CategoryPresentation | null;
  readonly annotation: {
    readonly category: string | null;
    readonly subCategory: string | null;
    readonly labels: readonly string[];
    readonly notes: string | null;
  } | null;
};

type TransferLinkTooltipProps = {
  readonly kind: string;
  readonly related: TransferRelatedLeg;
};

function resolveAnnotationCategory(
  annotation: TransferRelatedLeg['annotation'],
  separator: string,
): string | null {
  if (!annotation?.category) {
    return null;
  }
  if (annotation.subCategory) {
    return `${annotation.category}${separator}${annotation.subCategory}`;
  }
  return annotation.category;
}

function formatTransferAmountLabel(related: TransferRelatedLeg, locale: string): string {
  if (isForeignCurrencyTransaction(related.currency, related.account_currency)) {
    return formatDualCurrencyAmount(
      related.amount_cents,
      related.currency,
      related.account_currency,
      related.amount_in_account_currency_cents,
      locale,
    );
  }
  return formatCurrencyAmount(
    related.amount_in_account_currency_cents,
    related.account_currency,
    locale,
  );
}

export function TransferLinkTooltip({ kind, related }: TransferLinkTooltipProps) {
  const { t, i18n } = useTranslation();
  const dateLabel = formatRelativeOrAbsoluteDate(related.occurred_at, i18n.language);
  const amountLabel = formatTransferAmountLabel(related, i18n.language);
  const signedAmount =
    related.amount_in_account_currency_cents >= 0
      ? `+${amountLabel}`
      : `-${amountLabel.replace('-', '')}`;
  const categoryPath =
    related.category_presentation?.path ?? related.category_presentation?.name ?? null;
  const annotationCategory = resolveAnnotationCategory(related.annotation, t('labels.separator'));
  const labels = related.annotation?.labels ?? [];

  return (
    <Tooltip
      align="end"
      label={t('transfers.linkedTo', {
        account: related.account_display_name,
        amount: amountLabel,
        date: dateLabel,
      })}
      className="max-w-[min(22rem,calc(100vw-1rem))] space-y-1.5 py-2 font-normal"
      content={
        <>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {kind.replace(/_/g, ' ')}
          </div>
          <div className="font-medium">{related.account_display_name}</div>
          {related.merchant_name && (
            <div>
              <span className="text-muted-foreground">{t('columns.merchant')}: </span>
              {related.merchant_name}
            </div>
          )}
          {related.description && (
            <div className="text-muted-foreground">{related.description}</div>
          )}
          <div>
            <span className="text-muted-foreground">{t('columns.date')}: </span>
            {dateLabel}
          </div>
          <div>
            <span className="text-muted-foreground">{t('columns.amount')}: </span>
            <span className="tabular-nums font-medium">{signedAmount}</span>
            {related.amount_difference_cents > 0 && (
              <span className="text-muted-foreground">
                {' '}
                (
                {t('transfers.amountDifference', {
                  amount: formatCurrencyAmount(
                    related.amount_difference_cents,
                    related.currency,
                    i18n.language,
                  ),
                })}
                )
              </span>
            )}
          </div>
          {related.category_presentation && (
            <div className="flex items-center gap-1.5">
              <span
                className="inline-flex size-5 shrink-0 items-center justify-center rounded"
                style={{
                  color: related.category_presentation.color,
                  backgroundColor: `${related.category_presentation.color}20`,
                }}
              >
                <MaterialIcon name={related.category_presentation.icon} size={14} />
              </span>
              <span>{categoryPath}</span>
            </div>
          )}
          {labels.length > 0 && (
            <div>
              <span className="text-muted-foreground">{t('columns.labels')}: </span>
              {labels.join(', ')}
            </div>
          )}
          {annotationCategory && (
            <div>
              <span className="text-muted-foreground">{t('transfers.annotation')}: </span>
              {annotationCategory}
            </div>
          )}
          {related.annotation?.notes && (
            <div>
              <span className="text-muted-foreground">{t('transfers.notes')}: </span>
              {related.annotation.notes}
            </div>
          )}
        </>
      }
    >
      <span className="text-primary">⇄</span>
    </Tooltip>
  );
}

export function TransferLinkCell({
  transferGroup,
}: {
  readonly transferGroup: {
    readonly id: string;
    readonly kind: string;
    readonly related: TransferRelatedLeg | null;
  } | null;
}) {
  const { t } = useTranslation();
  if (!transferGroup) {
    return null;
  }

  if (!transferGroup.related) {
    return (
      <Tooltip align="end" content={t('transfers.linked')}>
        <span className="text-primary">⇄</span>
      </Tooltip>
    );
  }

  return <TransferLinkTooltip kind={transferGroup.kind} related={transferGroup.related} />;
}
