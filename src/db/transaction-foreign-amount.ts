import { parseAmountToCents } from '../openfinance/money.js';

/** SQLite expression for the amount used in charts, sums, and transfer matching. */
export const TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL =
  'COALESCE(t.amount_in_account_currency_cents, t.amount_cents)';

export function readTransactionAmountInAccountCurrencyCents(
  record: Record<string, unknown>,
): number | null {
  return parseAmountToCents(record['amountInAccountCurrency']);
}

export function normalizeTransactionAmountInAccountCurrencyCents(
  amountInAccountCurrencyCents: number | null,
  amountCents: number,
): number {
  return amountInAccountCurrencyCents ?? amountCents;
}

export function resolveSyncedTransactionAmountInAccountCurrencyCents(
  record: Record<string, unknown>,
  amountCents: number,
): number {
  const fromApi = readTransactionAmountInAccountCurrencyCents(record);
  return fromApi ?? amountCents;
}

export function resolveTransactionForeignAmountFields(input: {
  readonly currency: string;
  readonly accountCurrency: string;
  readonly amountInAccountCurrencyCents: number;
}): {
  readonly account_currency: string;
  readonly amount_in_account_currency_cents: number;
} {
  return {
    account_currency: input.accountCurrency,
    amount_in_account_currency_cents: input.amountInAccountCurrencyCents,
  };
}

export function isForeignCurrencyTransaction(currency: string, accountCurrency: string): boolean {
  return currency !== accountCurrency;
}

export function computeForeignExchangeRate(
  foreignAmountCents: number,
  accountAmountCents: number,
): number | null {
  if (foreignAmountCents === 0) {
    return null;
  }

  return Math.abs(accountAmountCents) / Math.abs(foreignAmountCents);
}
