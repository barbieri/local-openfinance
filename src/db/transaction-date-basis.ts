import { toLocalDateKey } from '../utils/local-date.js';

export const TRANSACTION_CREDIT_PURCHASE_DATE_VALUE_SQL =
  "TRIM(json_extract(t.raw_json, '$.creditCardMetadata.purchaseDate'))";

export const TRANSACTION_HAS_CREDIT_PURCHASE_DATE_SQL = `
  json_extract(t.raw_json, '$.creditCardMetadata.purchaseDate') IS NOT NULL
  AND ${TRANSACTION_CREDIT_PURCHASE_DATE_VALUE_SQL} != ''`;

export const TRANSACTION_HAS_CALENDAR_PURCHASE_DATE_SQL = `
  ${TRANSACTION_HAS_CREDIT_PURCHASE_DATE_SQL}
  AND LENGTH(${TRANSACTION_CREDIT_PURCHASE_DATE_VALUE_SQL}) = 10
  AND DATE(${TRANSACTION_CREDIT_PURCHASE_DATE_VALUE_SQL}) = ${TRANSACTION_CREDIT_PURCHASE_DATE_VALUE_SQL}`;

export const TRANSACTION_CREDIT_PURCHASE_DATE_SQL = `
  CASE
    WHEN ${TRANSACTION_HAS_CREDIT_PURCHASE_DATE_SQL}
    THEN ${TRANSACTION_CREDIT_PURCHASE_DATE_VALUE_SQL}
    ELSE t.occurred_at
  END`;

export function resolveTransactionLocalDate(value: string, timeZone: string): string {
  return isCalendarDateKey(value) ? value : toLocalDateKey(value, timeZone);
}

export function resolveTransactionDateBasis(input: {
  readonly occurredAt: string;
  readonly purchaseDate: string | null;
  readonly useCreditPurchaseDate: boolean;
  readonly timeZone: string;
}): { readonly displayOccurredAt: string; readonly localDate: string } {
  const displayOccurredAt =
    input.useCreditPurchaseDate && input.purchaseDate ? input.purchaseDate : input.occurredAt;
  return {
    displayOccurredAt,
    localDate: resolveTransactionLocalDate(displayOccurredAt, input.timeZone),
  };
}

function isCalendarDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
