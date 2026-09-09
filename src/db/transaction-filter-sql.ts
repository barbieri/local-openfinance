import type { SQLInputValue } from 'node:sqlite';
import { buildConfirmedTransactionClassificationSql } from '../annotation/classification-policy.js';
import { toLocalDateKey } from '../utils/local-date.js';
import { TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL } from './transaction-foreign-amount.js';

export type TransactionClassificationFilter = 'all' | 'classified' | 'unclassified';
export type TransactionTransferFilter = 'all' | 'hide' | 'only';

export type TransactionCommonSqlFilters = {
  readonly transactionIds?: readonly string[] | 'all' | undefined;
  readonly accountIds: readonly string[] | 'all';
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly classification: TransactionClassificationFilter;
  readonly transfers: TransactionTransferFilter;
  readonly useCreditPurchaseDate: boolean;
  readonly minAbsoluteAmountCents: number | null;
};

export type TransactionSqlWhere = {
  readonly sql: string;
  readonly params: SQLInputValue[];
};

export const TRANSACTION_FILTERED_FROM_SQL = `
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  JOIN connections c ON c.item_id = a.connection_item_id
  LEFT JOIN transaction_category_overrides tco ON tco.transaction_id = t.id`;

export const TRANSACTION_CREDIT_PURCHASE_DATE_SQL = `
  CASE
    WHEN json_extract(t.raw_json, '$.creditCardMetadata.purchaseDate') IS NOT NULL
      AND TRIM(json_extract(t.raw_json, '$.creditCardMetadata.purchaseDate')) != ''
    THEN json_extract(t.raw_json, '$.creditCardMetadata.purchaseDate')
    ELSE t.occurred_at
  END`;

export function transactionOccurredAtSql(useCreditPurchaseDate: boolean): string {
  return useCreditPurchaseDate ? TRANSACTION_CREDIT_PURCHASE_DATE_SQL : 't.occurred_at';
}

export function buildTransactionCommonWhere(
  filters: TransactionCommonSqlFilters,
  timeZone: string,
): TransactionSqlWhere {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  appendTransactionCommonFilters(parts, params, filters, timeZone);
  return {
    sql: parts.length > 0 ? `AND ${parts.join(' AND ')}` : '',
    params,
  };
}

export function appendTransactionCommonFilters(
  parts: string[],
  params: SQLInputValue[],
  filters: TransactionCommonSqlFilters,
  timeZone: string,
): void {
  appendDateBounds(parts, params, filters, timeZone);
  appendTransactionIdsFilter(parts, params, filters.transactionIds);
  appendAccountFilter(parts, params, filters.accountIds);
  appendClassificationFilter(parts, filters.classification);
  appendTransfersFilter(parts, filters.transfers);
  appendMinimumAmountFilter(parts, params, filters.minAbsoluteAmountCents);
}

function appendTransactionIdsFilter(
  parts: string[],
  params: SQLInputValue[],
  transactionIds: readonly string[] | 'all' | undefined,
): void {
  if (transactionIds === undefined || transactionIds === 'all') return;
  if (transactionIds.length === 0) {
    parts.push('0');
    return;
  }
  parts.push('t.id IN (SELECT value FROM json_each(?))');
  params.push(JSON.stringify(transactionIds));
}

export function appendAccountFilter(
  parts: string[],
  params: SQLInputValue[],
  accountIds: readonly string[] | 'all',
  accountIdColumn = 't.account_id',
): void {
  if (accountIds === 'all' || accountIds.length === 0) {
    return;
  }
  parts.push(`${accountIdColumn} IN (${accountIds.map(() => '?').join(', ')})`);
  params.push(...accountIds);
}

function appendDateBounds(
  parts: string[],
  params: SQLInputValue[],
  filters: Pick<TransactionCommonSqlFilters, 'startDate' | 'endDate' | 'useCreditPurchaseDate'>,
  timeZone: string,
): void {
  const occurredAtSql = transactionOccurredAtSql(filters.useCreditPurchaseDate);
  const startIso = resolveTransactionOccurredAtLowerBound(filters.startDate, timeZone);
  const endIso = resolveTransactionOccurredAtUpperBound(filters.endDate, timeZone);
  if (startIso) {
    parts.push(`${occurredAtSql} >= ?`);
    params.push(startIso);
  }
  if (endIso) {
    parts.push(`${occurredAtSql} <= ?`);
    params.push(endIso);
  }
}

function appendClassificationFilter(
  parts: string[],
  classification: TransactionClassificationFilter,
): void {
  if (classification === 'all') {
    return;
  }
  const predicate = buildConfirmedTransactionClassificationSql();
  parts.push(classification === 'classified' ? predicate : `NOT ${predicate}`);
}

function appendTransfersFilter(parts: string[], transfers: TransactionTransferFilter): void {
  if (transfers === 'all') {
    return;
  }
  const transferExists = `EXISTS (
    SELECT 1
    FROM transfer_group_members tgm
    WHERE tgm.entry_type = 'transaction' AND tgm.entry_id = t.id
  )`;
  parts.push(transfers === 'only' ? transferExists : `NOT ${transferExists}`);
}

function appendMinimumAmountFilter(
  parts: string[],
  params: SQLInputValue[],
  minAbsoluteAmountCents: number | null,
): void {
  if (minAbsoluteAmountCents === null) {
    return;
  }
  parts.push(`ABS(${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL}) > ?`);
  params.push(minAbsoluteAmountCents);
}

export function resolveTransactionOccurredAtLowerBound(
  value: string | null,
  timeZone: string,
): string | null {
  if (!value) {
    return null;
  }
  if (value.includes('T')) {
    return normalizeDateTimeFilterValue(value);
  }
  return localDateKeyStartIso(value, timeZone);
}

export function resolveTransactionOccurredAtUpperBound(
  value: string | null,
  timeZone: string,
): string | null {
  if (!value) {
    return null;
  }
  if (value.includes('T')) {
    return normalizeDateTimeFilterValue(value);
  }
  return localDateKeyEndIso(value, timeZone);
}

export function resolveTransactionLocalDateStartIso(dateKey: string, timeZone: string): string {
  return localDateKeyStartIso(dateKey, timeZone);
}

export function resolveTransactionLocalDateEndIso(dateKey: string, timeZone: string): string {
  return localDateKeyEndIso(dateKey, timeZone);
}

function normalizeDateTimeFilterValue(value: string): string {
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value) ? `${value}:00` : value;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

function localDateKeyStartIso(dateKey: string, timeZone: string): string {
  return new Date(findLocalDateBoundaryMs(dateKey, timeZone, 'start')).toISOString();
}

function localDateKeyEndIso(dateKey: string, timeZone: string): string {
  return new Date(findLocalDateBoundaryMs(dateKey, timeZone, 'end')).toISOString();
}

function findLocalDateBoundaryMs(
  dateKey: string,
  timeZone: string,
  boundary: 'start' | 'end',
): number {
  const target = boundary === 'start' ? dateKey : nextLocalDateKey(dateKey);
  let low = Date.parse(`${dateKey}T00:00:00.000Z`) - 36 * 3_600_000;
  let high = Date.parse(`${dateKey}T00:00:00.000Z`) + 36 * 3_600_000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const key = toLocalDateKey(new Date(mid).toISOString(), timeZone);
    if (key < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return boundary === 'end' ? Math.max(0, low - 1) : low;
}

function nextLocalDateKey(dateKey: string): string {
  const [yearText, monthText, dayText] = dateKey.split('-');
  const next = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText) + 1));
  return next.toISOString().slice(0, 10);
}
