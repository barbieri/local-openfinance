import type {
  BalanceChartDailyTotalRow,
  BalanceChartInitialSumRow,
} from '../db/balance-chart-query.js';
import { toLocalDateKey } from '../utils/local-date.js';

export type AccountBalanceAnchor = {
  readonly accountId: string;
  readonly balanceCents: number;
  readonly syncedAt: string;
  readonly currency: string;
};

export type BalanceChartWarningCode = 'limited_history' | 'no_bank_accounts' | 'mixed_currencies';

export type BalanceChartWarning = {
  readonly code: BalanceChartWarningCode;
  readonly message: string;
};

export type AccountBalanceDailyPoint = {
  readonly date: string;
  readonly credit: number;
  readonly debit: number;
  readonly balance: number;
  readonly isEstimated: boolean;
};

type AccountDayTotals = {
  credit: number;
  debit: number;
  net: number;
};

function nextDateKey(dateKey: string): string {
  const [yearText, monthText, dayText] = dateKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function iterateDateKeysInclusive(start: string, end: string): string[] {
  if (start > end) {
    return [];
  }

  const dates: string[] = [];
  let current = start;
  while (current <= end) {
    dates.push(current);
    current = nextDateKey(current);
  }
  return dates;
}

function compareDateKeys(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function resolveAnchorLocalDate(syncedAt: string, timeZone: string): string {
  return toLocalDateKey(syncedAt, timeZone);
}

function resolveDisplayDateBound(value: string | null, timeZone: string): string | null {
  if (!value) {
    return null;
  }
  if (value.includes('T')) {
    return toLocalDateKey(value, timeZone);
  }
  return value;
}

function indexInitialSums(rows: readonly BalanceChartInitialSumRow[]): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    result.set(row.account_id, Number(row.net_cents));
  }
  return result;
}

function indexDailyTotals(
  rows: readonly BalanceChartDailyTotalRow[],
): ReadonlyMap<string, ReadonlyMap<string, AccountDayTotals>> {
  const result = new Map<string, Map<string, AccountDayTotals>>();
  for (const row of rows) {
    const byDate = result.get(row.account_id) ?? new Map<string, AccountDayTotals>();
    byDate.set(row.local_date, {
      credit: Number(row.credit_cents),
      debit: Number(row.debit_cents),
      net: Number(row.net_cents),
    });
    result.set(row.account_id, byDate);
  }
  return result;
}

export function resolveBalanceChartDisplayRange(input: {
  readonly anchors: readonly AccountBalanceAnchor[];
  readonly earliestLocalDateByAccount: ReadonlyMap<string, string | null>;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly timeZone: string;
}): { readonly start: string; readonly end: string } | null {
  if (input.anchors.length === 0) {
    return null;
  }

  const syncedDates = input.anchors.map((anchor) =>
    resolveAnchorLocalDate(anchor.syncedAt, input.timeZone),
  );
  const defaultEnd = syncedDates.reduce((max, date) => (date > max ? date : max));
  const defaultStart = [...input.earliestLocalDateByAccount.values()].reduce<string | null>(
    (earliest, localDate) => {
      if (localDate == null) {
        return earliest;
      }
      if (earliest == null || localDate < earliest) {
        return localDate;
      }
      return earliest;
    },
    null,
  );

  const start =
    resolveDisplayDateBound(input.startDate, input.timeZone) ?? defaultStart ?? defaultEnd;
  const end = resolveDisplayDateBound(input.endDate, input.timeZone) ?? defaultEnd;

  if (start > end) {
    return null;
  }

  return { start, end };
}

function buildAccountDailyPoints(input: {
  readonly anchor: AccountBalanceAnchor;
  readonly displayDates: readonly string[];
  readonly netAfterDisplayStartCents: number;
  readonly dailyTotalsByDate: ReadonlyMap<string, AccountDayTotals>;
  readonly earliestLocalDate: string | null;
}): readonly AccountBalanceDailyPoint[] {
  let runningBalance = input.anchor.balanceCents - input.netAfterDisplayStartCents;

  return input.displayDates.map((date) => {
    const dayTotals = input.dailyTotalsByDate.get(date) ?? { credit: 0, debit: 0, net: 0 };
    runningBalance += dayTotals.net;
    const isEstimated =
      input.earliestLocalDate != null ? compareDateKeys(date, input.earliestLocalDate) < 0 : true;

    return {
      date,
      credit: dayTotals.credit,
      debit: dayTotals.debit,
      balance: runningBalance,
      isEstimated,
    };
  });
}

function aggregateDailyPoints(
  pointsByAccount: ReadonlyMap<string, readonly AccountBalanceDailyPoint[]>,
  displayDates: readonly string[],
): AccountBalanceDailyPoint[] {
  const pointsByDateByAccount = [...pointsByAccount.values()].map((points) => {
    const byDate = new Map<string, AccountBalanceDailyPoint>();
    for (const point of points) {
      byDate.set(point.date, point);
    }
    return byDate;
  });

  return displayDates.map((date) => {
    let credit = 0;
    let debit = 0;
    let balance = 0;
    let isEstimated = false;

    for (const byDate of pointsByDateByAccount) {
      const point = byDate.get(date);
      if (!point) {
        continue;
      }
      credit += point.credit;
      debit += point.debit;
      balance += point.balance;
      isEstimated ||= point.isEstimated;
    }

    return { date, credit, debit, balance, isEstimated };
  });
}

export function buildAccountBalanceDailyPoints(input: {
  readonly anchors: readonly AccountBalanceAnchor[];
  readonly initialSums: readonly BalanceChartInitialSumRow[];
  readonly dailyTotals: readonly BalanceChartDailyTotalRow[];
  readonly earliestLocalDateByAccount: ReadonlyMap<string, string | null>;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly timeZone: string;
  readonly formatLimitedHistoryMessage: (date: string) => string;
  readonly formatNoBankAccountsMessage: () => string;
  readonly formatMixedCurrenciesMessage: () => string;
}): {
  readonly dailyBalance: readonly AccountBalanceDailyPoint[];
  readonly warnings: readonly BalanceChartWarning[];
} {
  if (input.anchors.length === 0) {
    return {
      dailyBalance: [],
      warnings: [
        {
          code: 'no_bank_accounts',
          message: input.formatNoBankAccountsMessage(),
        },
      ],
    };
  }

  const currencies = new Set(input.anchors.map((anchor) => anchor.currency));
  if (currencies.size > 1) {
    return {
      dailyBalance: [],
      warnings: [
        {
          code: 'mixed_currencies',
          message: input.formatMixedCurrenciesMessage(),
        },
      ],
    };
  }

  const displayRange = resolveBalanceChartDisplayRange({
    anchors: input.anchors,
    earliestLocalDateByAccount: input.earliestLocalDateByAccount,
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone,
  });
  if (!displayRange) {
    return { dailyBalance: [], warnings: [] };
  }

  const displayDates = iterateDateKeysInclusive(displayRange.start, displayRange.end);
  const initialSumsByAccount = indexInitialSums(input.initialSums);
  const dailyTotalsByAccount = indexDailyTotals(input.dailyTotals);
  const pointsByAccount = new Map<string, readonly AccountBalanceDailyPoint[]>();

  for (const anchor of input.anchors) {
    pointsByAccount.set(
      anchor.accountId,
      buildAccountDailyPoints({
        anchor,
        displayDates,
        netAfterDisplayStartCents: initialSumsByAccount.get(anchor.accountId) ?? 0,
        dailyTotalsByDate: dailyTotalsByAccount.get(anchor.accountId) ?? new Map(),
        earliestLocalDate: input.earliestLocalDateByAccount.get(anchor.accountId) ?? null,
      }),
    );
  }

  const dailyBalance = aggregateDailyPoints(pointsByAccount, displayDates);
  const warnings: BalanceChartWarning[] = [];

  const limitedHistoryDates = [
    ...new Set(
      [...input.earliestLocalDateByAccount.values()].filter((date): date is string => date != null),
    ),
  ].toSorted(compareDateKeys);

  if (limitedHistoryDates.length > 0) {
    const earliest = limitedHistoryDates[0];
    if (earliest && compareDateKeys(displayRange.start, earliest) < 0) {
      warnings.push({
        code: 'limited_history',
        message: input.formatLimitedHistoryMessage(earliest),
      });
    }
  } else if (compareDateKeys(displayRange.start, displayRange.end) <= 0) {
    warnings.push({
      code: 'limited_history',
      message: input.formatLimitedHistoryMessage(displayRange.start),
    });
  }

  return { dailyBalance, warnings };
}
