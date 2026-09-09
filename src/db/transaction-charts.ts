import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  type BalanceChartWarning,
  buildAccountBalanceDailyPoints,
  iterateDateKeysInclusive,
  resolveBalanceChartDisplayRange,
} from '../chart/account-balance-over-time.js';
import { CHART_UNCATEGORIZED_CATEGORY_ID } from '../chart/transaction-aggregates.js';
import { VISIBLE_ACCOUNT_TRANSACTIONS_WHERE } from './account-links.js';
import {
  loadBalanceChartAnchors,
  loadBalanceChartDailyTotals,
  loadBalanceChartEarliestTransactions,
  loadBalanceChartInitialSums,
  resolveBalanceChartEarliestLocalDates,
} from './balance-chart-query.js';
import { buildCategoryIndex } from './category-display.js';
import { TRANSACTION_FILTERED_FROM_SQL } from './transaction-filter-sql.js';
import { TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL } from './transaction-foreign-amount.js';
import {
  buildTransactionBalanceScopeWhere,
  buildTransactionListWhere,
  resolveTransactionLocalDateStartIso,
  resolveTransactionOccurredAtLowerBound,
  type TransactionWebListFilters,
} from './transaction-query.js';

export type TransactionChartKind = 'balance' | 'category' | 'label';

export type TransactionChartBalancePoint = {
  readonly date: string;
  readonly credit: number;
  readonly debit: number;
  readonly balance: number;
  readonly isEstimated: boolean;
};

export type TransactionChartBalanceWarning = BalanceChartWarning;

export type TransactionChartDataset = {
  readonly total: number;
  readonly currency: string;
  readonly dailyBalance: readonly TransactionChartBalancePoint[];
  readonly categoryTotals: Readonly<Record<string, number>>;
  readonly labelTotals: Readonly<Record<string, number>>;
};

export type TransactionChartBalanceSection = {
  readonly chart: 'balance';
  readonly total: number;
  readonly currency: string;
  readonly dailyBalance: readonly TransactionChartBalancePoint[];
  readonly warnings: readonly TransactionChartBalanceWarning[];
};

export type TransactionChartCategorySection = {
  readonly chart: 'category';
  readonly total: number;
  readonly currency: string;
  readonly categoryTotals: Readonly<Record<string, number>>;
};

export type TransactionChartLabelSection = {
  readonly chart: 'label';
  readonly total: number;
  readonly currency: string;
  readonly labelTotals: Readonly<Record<string, number>>;
};

export type TransactionChartSection =
  | TransactionChartBalanceSection
  | TransactionChartCategorySection
  | TransactionChartLabelSection;

type FilteredTransactionRow = {
  readonly occurred_at: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly category_id: string | null;
};

function buildFilteredTransactionsCte(where: {
  readonly sql: string;
  readonly params: SQLInputValue[];
}): { readonly sql: string; readonly params: SQLInputValue[] } {
  return {
    sql: `
      WITH filtered AS (
        SELECT
          t.id,
          t.occurred_at,
          ${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL} AS amount_cents,
          a.currency AS currency,
          COALESCE(tco.category_id, t.category_id) AS category_id
        ${TRANSACTION_FILTERED_FROM_SQL}
        WHERE ${VISIBLE_ACCOUNT_TRANSACTIONS_WHERE}
          ${where.sql}
      )`,
    params: where.params,
  };
}

function loadFilteredTransactionRows(
  db: DatabaseSync,
  where: { readonly sql: string; readonly params: SQLInputValue[] },
): FilteredTransactionRow[] {
  const cte = buildFilteredTransactionsCte(where);
  const sql = `${cte.sql}
    SELECT occurred_at, amount_cents, currency, category_id
    FROM filtered
    ORDER BY occurred_at ASC, id ASC`;

  return db.prepare(sql).all(...cte.params) as FilteredTransactionRow[];
}

function loadCategoryTotals(
  db: DatabaseSync,
  where: { readonly sql: string; readonly params: SQLInputValue[] },
): Record<string, number> {
  const cte = buildFilteredTransactionsCte(where);
  const sql = `${cte.sql}
    SELECT category_id, SUM(ABS(amount_cents)) AS total_cents
    FROM filtered
    WHERE category_id IS NOT NULL
    GROUP BY category_id`;

  const rows = db.prepare(sql).all(...cte.params) as Array<{
    readonly category_id: string;
    readonly total_cents: number;
  }>;

  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[row.category_id] = Number(row.total_cents);
  }
  return totals;
}

function loadUncategorizedTotal(
  db: DatabaseSync,
  where: { readonly sql: string; readonly params: SQLInputValue[] },
): number {
  const cte = buildFilteredTransactionsCte(where);
  const sql = `${cte.sql}
    SELECT COALESCE(SUM(ABS(amount_cents)), 0) AS total_cents
    FROM filtered
    WHERE category_id IS NULL`;

  return Number(
    (db.prepare(sql).get(...cte.params) as { readonly total_cents: number }).total_cents,
  );
}

function loadLabelTotals(
  db: DatabaseSync,
  where: { readonly sql: string; readonly params: SQLInputValue[] },
): Record<string, number> {
  const cte = buildFilteredTransactionsCte(where);
  const sql = `${cte.sql}
    SELECT eal.label_id, SUM(ABS(f.amount_cents)) AS total_cents
    FROM filtered f
    INNER JOIN entry_annotations ea
      ON ea.entry_type = 'transaction' AND ea.entry_id = f.id
    INNER JOIN entry_annotation_labels eal ON eal.annotation_id = ea.id
    GROUP BY eal.label_id`;

  const rows = db.prepare(sql).all(...cte.params) as Array<{
    readonly label_id: string;
    readonly total_cents: number;
  }>;

  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[row.label_id] = Number(row.total_cents);
  }
  return totals;
}

const BALANCE_CHART_MESSAGES = {
  formatLimitedHistoryMessage: (date: string) =>
    `Balances before ${date} depend on incomplete local transaction history.`,
  formatNoBankAccountsMessage: () => 'No bank accounts are in scope for the balance chart.',
  formatMixedCurrenciesMessage: () =>
    'Balance chart cannot aggregate accounts with different currencies.',
} as const;

function mapBalanceChartAnchors(rows: ReturnType<typeof loadBalanceChartAnchors>): Array<{
  readonly accountId: string;
  readonly balanceCents: number;
  readonly syncedAt: string;
  readonly currency: string;
}> {
  return rows.map((anchor) => ({
    accountId: anchor.id,
    balanceCents: Number(anchor.balance_cents ?? 0),
    syncedAt: anchor.synced_at,
    currency: anchor.currency,
  }));
}

function loadTrueBalanceChartSection(
  db: DatabaseSync,
  filters: TransactionWebListFilters,
  timeZone: string,
): TransactionChartBalanceSection {
  const accountScopeWhere = buildTransactionBalanceScopeWhere(filters, 'a.id');
  const transactionScopeWhere = buildTransactionBalanceScopeWhere(filters);
  const anchorRows = loadBalanceChartAnchors(db, accountScopeWhere);
  const anchors = mapBalanceChartAnchors(anchorRows);
  const earliestLocalDateByAccount = resolveBalanceChartEarliestLocalDates(
    loadBalanceChartEarliestTransactions(db, transactionScopeWhere),
    timeZone,
  );

  const displayRange = resolveBalanceChartDisplayRange({
    anchors,
    earliestLocalDateByAccount,
    startDate: filters.startDate,
    endDate: filters.endDate,
    timeZone,
  });

  const displayStartIso =
    displayRange != null
      ? resolveTransactionLocalDateStartIso(displayRange.start, timeZone)
      : (resolveTransactionOccurredAtLowerBound(filters.startDate, timeZone) ??
        '1970-01-01T00:00:00.000Z');

  const initialSums = loadBalanceChartInitialSums(db, transactionScopeWhere, displayStartIso);
  const dailyTotals =
    displayRange != null
      ? loadBalanceChartDailyTotals(
          db,
          transactionScopeWhere,
          iterateDateKeysInclusive(displayRange.start, displayRange.end),
          timeZone,
        )
      : [];

  const { dailyBalance, warnings } = buildAccountBalanceDailyPoints({
    anchors,
    initialSums,
    dailyTotals,
    earliestLocalDateByAccount,
    startDate: filters.startDate,
    endDate: filters.endDate,
    timeZone,
    ...BALANCE_CHART_MESSAGES,
  });

  return {
    chart: 'balance',
    total: dailyBalance.length,
    currency: anchorRows[0]?.currency ?? 'BRL',
    dailyBalance,
    warnings,
  };
}

function loadFilteredTransactionSummary(
  db: DatabaseSync,
  where: { readonly sql: string; readonly params: SQLInputValue[] },
): { readonly total: number; readonly currency: string } {
  const cte = buildFilteredTransactionsCte(where);
  const sql = `${cte.sql}
    SELECT COUNT(*) AS total, MIN(currency) AS currency
    FROM filtered`;

  const row = db.prepare(sql).get(...cte.params) as {
    readonly total: number;
    readonly currency: string | null;
  };

  return {
    total: Number(row.total),
    currency: row.currency ?? 'BRL',
  };
}

export function parseTransactionChartKind(value: string | undefined): TransactionChartKind | null {
  if (value === 'balance' || value === 'category' || value === 'label') {
    return value;
  }
  return null;
}

export function loadTransactionChartSection(
  db: DatabaseSync,
  filters: TransactionWebListFilters,
  timeZone: string,
  chart: TransactionChartKind,
): TransactionChartSection {
  const categoryIndex = buildCategoryIndex(db);
  const where = buildTransactionListWhere(filters, categoryIndex, timeZone);

  switch (chart) {
    case 'balance':
      return loadTrueBalanceChartSection(db, filters, timeZone);
    case 'category': {
      const summary = loadFilteredTransactionSummary(db, where);
      const categoryTotals = loadCategoryTotals(db, where);
      const uncategorizedTotal = loadUncategorizedTotal(db, where);
      if (uncategorizedTotal > 0) {
        categoryTotals[CHART_UNCATEGORIZED_CATEGORY_ID] = uncategorizedTotal;
      }
      return {
        chart: 'category',
        total: summary.total,
        currency: summary.currency,
        categoryTotals,
      };
    }
    case 'label': {
      const summary = loadFilteredTransactionSummary(db, where);
      return {
        chart: 'label',
        total: summary.total,
        currency: summary.currency,
        labelTotals: loadLabelTotals(db, where),
      };
    }
  }
}

export function loadTransactionChartDataset(
  db: DatabaseSync,
  filters: TransactionWebListFilters,
  timeZone: string,
): TransactionChartDataset {
  const categoryIndex = buildCategoryIndex(db);
  const where = buildTransactionListWhere(filters, categoryIndex, timeZone);

  const rows = loadFilteredTransactionRows(db, where);
  const transactionCurrencies = new Set(rows.map((row) => row.currency));
  if (transactionCurrencies.size > 1) {
    throw new Error('Transaction charts cannot combine multiple currencies.');
  }
  const categoryTotals = loadCategoryTotals(db, where);
  const uncategorizedTotal = loadUncategorizedTotal(db, where);
  if (uncategorizedTotal > 0) {
    categoryTotals[CHART_UNCATEGORIZED_CATEGORY_ID] = uncategorizedTotal;
  }

  const balanceSection = loadTrueBalanceChartSection(db, filters, timeZone);
  if (balanceSection.warnings.some((warning) => warning.code === 'mixed_currencies')) {
    throw new Error('Transaction charts cannot combine multiple currencies.');
  }
  const transactionCurrency = rows[0]?.currency;
  if (
    transactionCurrency &&
    balanceSection.dailyBalance.length > 0 &&
    transactionCurrency !== balanceSection.currency
  ) {
    throw new Error('Transaction charts cannot combine multiple currencies.');
  }

  return {
    total: rows.length,
    currency: transactionCurrency ?? balanceSection.currency,
    dailyBalance: balanceSection.dailyBalance,
    categoryTotals,
    labelTotals: loadLabelTotals(db, where),
  };
}
