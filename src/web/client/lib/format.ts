import { getDateTimeFormat, getNumberFormat } from '../../../utils/intl-formatters.js';

export function formatLocalDate(value: string | null | undefined, locale: string): string {
  if (!value) {
    return '—';
  }
  const dateKey = value.slice(0, 10);
  return getDateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${dateKey}T12:00:00`));
}

export function formatLocalDateTime(value: string | null | undefined, locale: string): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value.includes('T') ? value : `${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return getDateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatCurrencyAmount(
  amountCents: number,
  currency: string,
  locale: string,
  options?: { readonly signed?: boolean },
): string {
  const signed = options?.signed ?? false;
  const formatted = getNumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(Math.abs(amountCents) / 100);

  if (!signed || amountCents === 0) {
    return formatted;
  }
  return `${amountCents > 0 ? '+' : '-'}${formatted}`;
}

export function formatDualCurrencyAmount(
  amountCents: number,
  currency: string,
  accountCurrency: string,
  amountInAccountCurrencyCents: number,
  locale: string,
  options?: { readonly signed?: boolean },
): string {
  const primary = formatCurrencyAmount(amountCents, currency, locale, options);
  const secondary = formatCurrencyAmount(
    amountInAccountCurrencyCents,
    accountCurrency,
    locale,
    options,
  );
  return `${primary} (${secondary})`;
}
