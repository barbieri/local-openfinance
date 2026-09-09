import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { toLocalDateKey } from '../utils/local-date.js';
import { VISIBLE_ACCOUNT_TRANSACTIONS_WHERE } from './account-links.js';
import { TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL } from './transaction-foreign-amount.js';
import {
  resolveTransactionLocalDateEndIso,
  resolveTransactionLocalDateStartIso,
} from './transaction-query.js';

export type BalanceChartSqlAnchor = {
  readonly id: string;
  readonly balance_cents: number | null;
  readonly currency: string;
  readonly synced_at: string;
};

export type BalanceChartInitialSumRow = {
  readonly account_id: string;
  readonly net_cents: number;
};

export type BalanceChartDailyTotalRow = {
  readonly account_id: string;
  readonly local_date: string;
  readonly credit_cents: number;
  readonly debit_cents: number;
  readonly net_cents: number;
};

export type BalanceChartEarliestTransactionRow = {
  readonly account_id: string;
  readonly earliest_occurred_at: string | null;
};

const BALANCE_SCOPE_TRANSACTION_WHERE = `
  ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}
  AND UPPER(a.type) = 'BANK'
  AND t.occurred_at <= a.synced_at
`;

const AMOUNT_CENTS_SQL = TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL;

function buildBalanceAmountAggregatesSql(amountColumn: string): string {
  return `
    COALESCE(SUM(CASE WHEN ${amountColumn} >= 0 THEN ${amountColumn} ELSE 0 END), 0) AS credit_cents,
    COALESCE(SUM(CASE WHEN ${amountColumn} < 0 THEN -${amountColumn} ELSE 0 END), 0) AS debit_cents,
    COALESCE(SUM(${amountColumn}), 0) AS net_cents
  `;
}

export function loadBalanceChartAnchors(
  db: DatabaseSync,
  scopeWhere: { readonly sql: string; readonly params: SQLInputValue[] },
): BalanceChartSqlAnchor[] {
  const sql = `
    SELECT a.id, a.balance_cents, a.currency, a.synced_at
    FROM accounts a
    WHERE a.id NOT IN (
      SELECT account_id FROM account_group_members WHERE is_canonical = 0
    )
      AND UPPER(a.type) = 'BANK'
      ${scopeWhere.sql}`;

  return db.prepare(sql).all(...scopeWhere.params) as BalanceChartSqlAnchor[];
}

export function loadBalanceChartEarliestTransactions(
  db: DatabaseSync,
  scopeWhere: { readonly sql: string; readonly params: SQLInputValue[] },
): BalanceChartEarliestTransactionRow[] {
  const sql = `
    SELECT t.account_id, MIN(t.occurred_at) AS earliest_occurred_at
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE ${BALANCE_SCOPE_TRANSACTION_WHERE}
      ${scopeWhere.sql}
    GROUP BY t.account_id`;

  return db.prepare(sql).all(...scopeWhere.params) as BalanceChartEarliestTransactionRow[];
}

export function loadBalanceChartInitialSums(
  db: DatabaseSync,
  scopeWhere: { readonly sql: string; readonly params: SQLInputValue[] },
  displayStartIso: string,
): BalanceChartInitialSumRow[] {
  const sql = `
    SELECT t.account_id,
      COALESCE(SUM(${AMOUNT_CENTS_SQL}), 0) AS net_cents
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE ${BALANCE_SCOPE_TRANSACTION_WHERE}
      AND t.occurred_at >= ?
      ${scopeWhere.sql}
    GROUP BY t.account_id`;

  return db.prepare(sql).all(displayStartIso, ...scopeWhere.params) as BalanceChartInitialSumRow[];
}

export function loadBalanceChartDailyTotals(
  db: DatabaseSync,
  scopeWhere: { readonly sql: string; readonly params: SQLInputValue[] },
  displayDates: readonly string[],
  timeZone: string,
): BalanceChartDailyTotalRow[] {
  if (displayDates.length === 0) {
    return [];
  }

  const dateBounds = displayDates.map((localDate) => ({
    localDate,
    startIso: resolveTransactionLocalDateStartIso(localDate, timeZone),
    endIso: resolveTransactionLocalDateEndIso(localDate, timeZone),
  }));

  const valuesSql = dateBounds.map(() => '(?, ?, ?)').join(', ');
  const dateParams = dateBounds.flatMap((bound) => [bound.localDate, bound.startIso, bound.endIso]);

  const sql = `
    WITH date_bounds(local_date, start_iso, end_iso) AS (
      VALUES ${valuesSql}
    )
    SELECT t.account_id,
      db.local_date,
      ${buildBalanceAmountAggregatesSql(AMOUNT_CENTS_SQL)}
    FROM date_bounds db
    INNER JOIN transactions t
      ON t.occurred_at >= db.start_iso
      AND t.occurred_at <= db.end_iso
    INNER JOIN accounts a ON a.id = t.account_id
    WHERE ${BALANCE_SCOPE_TRANSACTION_WHERE}
      ${scopeWhere.sql}
    GROUP BY t.account_id, db.local_date`;

  return db.prepare(sql).all(...dateParams, ...scopeWhere.params) as BalanceChartDailyTotalRow[];
}

export function resolveBalanceChartEarliestLocalDates(
  rows: readonly BalanceChartEarliestTransactionRow[],
  timeZone: string,
): ReadonlyMap<string, string | null> {
  const result = new Map<string, string | null>();
  for (const row of rows) {
    result.set(
      row.account_id,
      row.earliest_occurred_at ? toLocalDateKey(row.earliest_occurred_at, timeZone) : null,
    );
  }
  return result;
}
