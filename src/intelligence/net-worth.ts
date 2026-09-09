import type { DatabaseSync } from 'node:sqlite';
import { VISIBLE_ACCOUNTS_WHERE } from '../db/account-links.js';
import { allSql } from '../db/sqlite-query.js';
import { addDaysToLocalDateKey, type LocalDatePeriod } from './period.js';

export type NetWorthCurrencySnapshot = {
  readonly currency: string;
  readonly bankBalanceCents: number;
  readonly investmentCents: number;
  readonly loanCents: number;
  readonly creditCardBalanceCents: number;
  readonly netCents: number;
  readonly deltaVsPreviousRunCents: number | null;
  readonly deltaVsFourWeeksAgoCents: number | null;
};

export type NetWorthSnapshot = {
  readonly currencies: readonly NetWorthCurrencySnapshot[];
};

type CurrentNetWorthCurrency = Omit<
  NetWorthCurrencySnapshot,
  'deltaVsPreviousRunCents' | 'deltaVsFourWeeksAgoCents'
>;

type MutableNetWorthCurrency = {
  currency: string;
  bankBalanceCents: number;
  investmentCents: number;
  loanCents: number;
  creditCardBalanceCents: number;
};

export function buildNetWorthSnapshot(
  db: DatabaseSync,
  reportId: string,
  period: LocalDatePeriod,
  accountIds: readonly string[],
): NetWorthSnapshot {
  const previousRuns = listPreviousNetWorth(db, reportId, period);
  return {
    currencies: loadNetWorth(db, accountIds).map((current) => {
      const previous = previousRuns.previous.get(current.currency);
      const fourWeeksAgo = previousRuns.fourWeeksAgo.get(current.currency);
      return {
        ...current,
        deltaVsPreviousRunCents: previous === undefined ? null : current.netCents - previous,
        deltaVsFourWeeksAgoCents:
          fourWeeksAgo === undefined ? null : current.netCents - fourWeeksAgo,
      };
    }),
  };
}

function sqlList(values: readonly string[]): string {
  return values.map(() => '?').join(', ');
}

function loadNetWorth(
  db: DatabaseSync,
  accountIds: readonly string[],
): readonly CurrentNetWorthCurrency[] {
  const accountWhere = accountIds.length === 0 ? '' : `AND id IN (${sqlList(accountIds)})`;
  const banks = allSql<{
    readonly balance_cents: number | null;
    readonly currency: string;
    readonly type: string;
  }>(
    db,
    `SELECT balance_cents, currency, type
     FROM accounts
     WHERE ${VISIBLE_ACCOUNTS_WHERE} ${accountWhere}`,
    ...accountIds,
  );
  const totalsByCurrency = new Map<string, MutableNetWorthCurrency>();
  for (const row of banks) {
    const totals = getCurrencyTotals(totalsByCurrency, row.currency);
    const balance = row.balance_cents ?? 0;
    if (row.type === 'CREDIT') {
      totals.creditCardBalanceCents += balance;
    } else {
      totals.bankBalanceCents += balance;
    }
  }
  const connectionWhere = accountIds.length === 0 ? '' : 'WHERE 0';
  const investments = allSql<{ readonly balance_cents: number | null; readonly currency: string }>(
    db,
    `SELECT balance_cents, currency FROM investments ${connectionWhere}`,
  );
  for (const row of investments) {
    const totals = getCurrencyTotals(totalsByCurrency, row.currency);
    const balance = row.balance_cents ?? 0;
    totals.investmentCents += balance;
  }
  const loans = allSql<{
    readonly currency: string;
    readonly outstanding_balance_cents: number | null;
  }>(db, `SELECT outstanding_balance_cents, currency FROM loans ${connectionWhere}`);
  for (const row of loans) {
    const totals = getCurrencyTotals(totalsByCurrency, row.currency);
    const balance = row.outstanding_balance_cents ?? 0;
    totals.loanCents += balance;
  }
  const sortedTotals = [...totalsByCurrency.values()];
  sortedTotals.sort((left, right) => left.currency.localeCompare(right.currency));
  return sortedTotals.map((totals) => ({
    ...totals,
    netCents:
      totals.bankBalanceCents +
      totals.investmentCents -
      totals.loanCents -
      Math.abs(totals.creditCardBalanceCents),
  }));
}

function getCurrencyTotals(
  totalsByCurrency: Map<string, MutableNetWorthCurrency>,
  currency: string,
): MutableNetWorthCurrency {
  const existing = totalsByCurrency.get(currency);
  if (existing) {
    return existing;
  }
  const totals: MutableNetWorthCurrency = {
    currency,
    bankBalanceCents: 0,
    investmentCents: 0,
    loanCents: 0,
    creditCardBalanceCents: 0,
  };
  totalsByCurrency.set(currency, totals);
  return totals;
}

function listPreviousNetWorth(
  db: DatabaseSync,
  reportId: string,
  period: LocalDatePeriod,
): {
  readonly previous: ReadonlyMap<string, number>;
  readonly fourWeeksAgo: ReadonlyMap<string, number>;
} {
  const runs = allSql<{ readonly briefing_json: string; readonly period_end: string }>(
    db,
    `SELECT briefing_json, period_end
     FROM intelligence_runs
     WHERE report_id = ?
     ORDER BY created_at DESC
     LIMIT 100`,
    reportId,
  );
  const previous = new Map<string, number>();
  const fourWeeksAgo = new Map<string, number>();
  const fourWeekBoundary = addDaysToLocalDateKey(period.end, -28);
  for (const run of runs) {
    for (const snapshot of parseRunNetWorth(run.briefing_json)) {
      if (!previous.has(snapshot.currency)) {
        previous.set(snapshot.currency, snapshot.netCents);
      }
      if (run.period_end <= fourWeekBoundary && !fourWeeksAgo.has(snapshot.currency)) {
        fourWeeksAgo.set(snapshot.currency, snapshot.netCents);
      }
    }
  }
  return { previous, fourWeeksAgo };
}

function parseRunNetWorth(
  raw: string,
): readonly Pick<NetWorthCurrencySnapshot, 'currency' | 'netCents'>[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return [];
    }
    const netWorth = parsed['netWorth'];
    if (!isRecord(netWorth) || !Array.isArray(netWorth['currencies'])) {
      return [];
    }
    const snapshots: Array<Pick<NetWorthCurrencySnapshot, 'currency' | 'netCents'>> = [];
    for (const value of netWorth['currencies']) {
      if (
        isRecord(value) &&
        typeof value['currency'] === 'string' &&
        typeof value['netCents'] === 'number'
      ) {
        snapshots.push({ currency: value['currency'], netCents: value['netCents'] });
      }
    }
    return snapshots;
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
