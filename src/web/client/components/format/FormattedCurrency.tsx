import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { formatCurrencyAmount } from '../../lib/format.js';

type FormattedCurrencyProps = {
  readonly amountCents: number;
  readonly currency?: string;
  readonly className?: string;
  readonly signed?: boolean;
};

export function FormattedCurrency({
  amountCents,
  currency = 'BRL',
  className,
  signed = true,
}: FormattedCurrencyProps) {
  const { i18n } = useTranslation();
  const formatted = formatCurrencyAmount(amountCents, currency, i18n.language, { signed: false });

  const sign = signed && amountCents !== 0 ? (amountCents > 0 ? '+' : '-') : '';
  const tone =
    signed && amountCents !== 0
      ? amountCents > 0
        ? 'text-[var(--credit)]'
        : 'text-[var(--debit)]'
      : '';

  return (
    <span className={clsx('tabular-nums', tone, className)}>
      {sign}
      {formatted}
    </span>
  );
}
