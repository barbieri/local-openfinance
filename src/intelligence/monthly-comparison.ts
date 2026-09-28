import { addDaysToLocalDateKey, isCompleteCalendarMonth } from './period.js';
import type { ReportAnalysis } from './report-analysis-types.js';

export type LinearRegression = { readonly slope: number; readonly intercept: number };

export type MonthlyComparisonModel = {
  readonly buckets: ReportAnalysis['chart'];
  readonly expenses: readonly number[];
  readonly income: readonly number[];
  readonly monthlyBalances: readonly number[];
  readonly balances: readonly number[];
  readonly completeMonths: readonly boolean[];
  readonly expenseMom: readonly (number | null)[];
  readonly incomeMom: readonly (number | null)[];
  readonly trend: {
    readonly startIndex: number;
    readonly endIndex: number;
    readonly expense: LinearRegression;
    readonly income: LinearRegression;
  } | null;
};

export type PeriodComparisonModel = {
  readonly cadence: 'weekly' | 'monthly';
  readonly buckets: ReportAnalysis['chart'];
  readonly expenses: readonly number[];
  readonly income: readonly number[];
  readonly periodBalances: readonly number[];
  readonly completeBuckets: readonly boolean[];
  readonly trend: MonthlyComparisonModel['trend'];
};

export function buildPeriodComparisonModel(
  chart: ReportAnalysis['chart'],
  cadence: 'weekly' | 'monthly',
): PeriodComparisonModel {
  const buckets = cadence === 'monthly' ? chart.slice(-12) : chart;
  const expenses = buckets.map((bucket) => bucket.expenseCents);
  const income = buckets.map((bucket) => bucket.incomeCents);
  const periodBalances = buckets.map((bucket) => bucket.incomeCents - bucket.expenseCents);
  const completeBuckets = buckets.map((bucket) =>
    cadence === 'monthly'
      ? isCompleteCalendarMonth(bucket)
      : addDaysToLocalDateKey(bucket.start, 6) === bucket.end,
  );
  const complete = buckets.flatMap((bucket, index) =>
    completeBuckets[index]
      ? [{ index, expense: bucket.expenseCents, income: bucket.incomeCents }]
      : [],
  );
  const firstComplete = complete[0];
  const lastComplete = complete.at(-1);
  return {
    cadence,
    buckets,
    expenses,
    income,
    periodBalances,
    completeBuckets,
    trend:
      firstComplete && lastComplete && firstComplete !== lastComplete
        ? {
            startIndex: firstComplete.index,
            endIndex: lastComplete.index,
            expense: regressionPoints(
              complete.map(({ index, expense }) => ({ index, value: expense })),
            ),
            income: regressionPoints(
              complete.map(({ index, income }) => ({ index, value: income })),
            ),
          }
        : null,
  };
}

export function buildMonthlyComparisonModel(
  chart: ReportAnalysis['chart'],
): MonthlyComparisonModel {
  const buckets = chart.slice(-12);
  const expenses = buckets.map((bucket) => bucket.expenseCents);
  const income = buckets.map((bucket) => bucket.incomeCents);
  const monthlyBalances = buckets.map((bucket) => bucket.incomeCents - bucket.expenseCents);
  const completeMonths = buckets.map(isCompleteCalendarMonth);
  const complete = buckets.flatMap((bucket, index) =>
    completeMonths[index]
      ? [{ index, expense: bucket.expenseCents, income: bucket.incomeCents }]
      : [],
  );
  const firstComplete = complete[0];
  const lastComplete = complete.at(-1);
  let balance = 0;
  return {
    buckets,
    expenses,
    income,
    monthlyBalances,
    balances: monthlyBalances.map((value) => (balance += value)),
    completeMonths,
    expenseMom: percentChange(expenses, completeMonths),
    incomeMom: percentChange(income, completeMonths),
    trend:
      firstComplete && lastComplete && firstComplete !== lastComplete
        ? {
            startIndex: firstComplete.index,
            endIndex: lastComplete.index,
            expense: regressionPoints(
              complete.map(({ index, expense }) => ({ index, value: expense })),
            ),
            income: regressionPoints(
              complete.map(({ index, income }) => ({ index, value: income })),
            ),
          }
        : null,
  };
}

function percentChange(
  values: readonly number[],
  completeMonths: readonly boolean[],
): readonly (number | null)[] {
  return values.map((value, index) => {
    const previous = values[index - 1];
    return previous === undefined ||
      previous === 0 ||
      !completeMonths[index] ||
      !completeMonths[index - 1]
      ? null
      : (value - previous) / previous;
  });
}

export function linearRegression(values: readonly number[]): LinearRegression {
  return regressionPoints(values.map((value, index) => ({ index, value })));
}

function regressionPoints(
  points: readonly { readonly index: number; readonly value: number }[],
): LinearRegression {
  if (points.length === 0) return { slope: 0, intercept: 0 };
  const meanX = points.reduce((sum, point) => sum + point.index, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.index - meanX) ** 2, 0);
  if (denominator === 0) return { slope: 0, intercept: meanY };
  const slope =
    points.reduce((sum, point) => sum + (point.index - meanX) * (point.value - meanY), 0) /
    denominator;
  return { slope, intercept: meanY - slope * meanX };
}
