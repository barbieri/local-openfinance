import { addDaysToLocalDateKey, type LocalDatePeriod, shiftLocalDateKeyMonths } from './period.js';
import {
  daysBetween,
  groupBy,
  monthsBetween,
  sumCents,
  within,
} from './report-analysis-helpers.js';
import type {
  ReportCadence,
  ReportFact,
  ReportProfile,
  ReportStats,
  SpendingPattern,
} from './report-analysis-types.js';
import type { ReportTaxonomy } from './report-taxonomy.js';

export function buildProfiles(
  facts: readonly ReportFact[],
  period: LocalDatePeriod,
  cadence: ReportCadence,
): readonly ReportProfile[] {
  const groups = new Map<string, { taxonomy: ReportTaxonomy; facts: ReportFact[] }>();
  for (const fact of facts) {
    if (fact.direction !== 'expense') continue;
    for (const taxonomy of fact.taxonomies) {
      const key = `${taxonomy.kind}:${taxonomy.id}`;
      const group = groups.get(key) ?? { taxonomy, facts: [] };
      group.facts.push(fact);
      groups.set(key, group);
    }
  }
  return [...groups.entries()].map(([key, group]) => buildProfile(key, group, period, cadence));
}

function buildProfile(
  key: string,
  group: { readonly taxonomy: ReportTaxonomy; readonly facts: readonly ReportFact[] },
  period: LocalDatePeriod,
  cadence: ReportCadence,
): ReportProfile {
  const historical = group.facts.filter((fact) => fact.date < period.start);
  const current = within(group.facts, period);
  const pattern = classifyPattern(historical);
  const basis = patternBasis(pattern);
  const profileStats = stats(
    valuesForBasis(historical, basis, addDaysToLocalDateKey(period.start, -1)),
  );
  const comparable = isComparable(cadence, basis, current);
  const currentValue = comparable ? valueForCurrent(current, basis) : null;
  const comparison = profileComparison(currentValue, profileStats);
  const months = [...new Set(historical.map((fact) => fact.date.slice(0, 7)))].toSorted();
  const spanMonths =
    months.length === 0 ? 0 : monthsBetween(months[0] ?? '', months.at(-1) ?? '') + 1;
  return {
    key,
    kind: group.taxonomy.kind,
    id: group.taxonomy.id,
    path: group.taxonomy.path,
    depth: group.taxonomy.depth,
    pattern,
    basis,
    stats: profileStats,
    history: {
      facts: historical.length,
      first: historical[0]?.date ?? null,
      last: historical.at(-1)?.date ?? null,
      activeMonths: months.length,
      spanMonths,
      monthlyCoverage: spanMonths === 0 ? 0 : months.length / spanMonths,
      bursts: groupBursts(historical).length,
    },
    current: {
      facts: current.length,
      cents: sumCents(current),
      comparable,
      ...comparison,
    },
  };
}

export function profileComparison(currentValue: number | null, profileStats: ReportStats) {
  if (currentValue === null || profileStats.n === 0) {
    return {
      deltaCents: null,
      deltaRatio: null,
      zScore: null,
      expectedness: 'no-baseline' as const,
    };
  }
  const deltaCents = currentValue - profileStats.averageCents;
  const deltaRatio =
    profileStats.averageCents === 0 ? null : deltaCents / profileStats.averageCents;
  const zScore =
    profileStats.standardDeviationCents === 0
      ? null
      : deltaCents / profileStats.standardDeviationCents;
  return {
    deltaCents,
    deltaRatio,
    zScore,
    expectedness:
      Math.abs(zScore ?? 0) >= 2 || Math.abs(deltaRatio ?? 0) >= 1
        ? ('unusual' as const)
        : ('within-range' as const),
  };
}

function classifyPattern(facts: readonly ReportFact[]): SpendingPattern {
  const activeDates = [...new Set(facts.map((fact) => fact.date))].toSorted();
  if (activeDates.length <= 2) return 'one-off';
  const activeMonths = [...new Set(activeDates.map((date) => date.slice(0, 7)))].toSorted();
  const spanMonths = monthsBetween(activeMonths[0] ?? '', activeMonths.at(-1) ?? '') + 1;
  const coverage = spanMonths <= 0 ? 0 : activeMonths.length / spanMonths;
  if (activeMonths.length >= 4 && coverage >= 0.6) return 'monthly-recurring';
  const yearMonths = new Map<string, Set<string>>();
  for (const date of activeDates) {
    const month = date.slice(5, 7);
    const years = yearMonths.get(month) ?? new Set<string>();
    years.add(date.slice(0, 4));
    yearMonths.set(month, years);
  }
  if ([...yearMonths.values()].some((years) => years.size >= 3)) return 'yearly-recurring';
  const bursts = groupBursts(facts);
  if (bursts.length >= 2 && bursts.some((burst) => burst.length >= 2)) return 'small-bursts';
  return 'undefined';
}

function patternBasis(pattern: SpendingPattern): ReportProfile['basis'] {
  if (pattern === 'monthly-recurring') return 'month';
  if (pattern === 'yearly-recurring') return 'year';
  if (pattern === 'small-bursts') return 'burst';
  return 'active-day';
}

function valuesForBasis(
  facts: readonly ReportFact[],
  basis: ReportProfile['basis'],
  historyEnd: string,
): readonly number[] {
  if (basis === 'burst') return groupBursts(facts).map(sumCents);
  if (basis === 'month') return zeroFilledPeriodTotals(facts, 7, historyEnd);
  if (basis === 'year') return zeroFilledPeriodTotals(facts, 4, historyEnd);
  return [...groupBy(facts, (fact) => fact.date).values()].map(sumCents);
}

function valueForCurrent(facts: readonly ReportFact[], basis: ReportProfile['basis']): number {
  if (basis === 'burst') return Math.max(...groupBursts(facts).map(sumCents), 0);
  return sumCents(facts);
}

function isComparable(
  cadence: ReportCadence,
  basis: ReportProfile['basis'],
  current: readonly ReportFact[],
): boolean {
  if (current.length === 0) return false;
  if (basis === 'month') return cadence === 'monthly';
  if (basis === 'year') return false;
  return true;
}

function groupBursts(facts: readonly ReportFact[]): readonly (readonly ReportFact[])[] {
  const sorted = facts.toSorted((left, right) => left.date.localeCompare(right.date));
  const bursts: ReportFact[][] = [];
  for (const fact of sorted) {
    const last = bursts.at(-1);
    if (!last || daysBetween(last.at(-1)?.date ?? fact.date, fact.date) > 14) {
      bursts.push([fact]);
    } else {
      last.push(fact);
    }
  }
  return bursts;
}

function zeroFilledPeriodTotals(
  facts: readonly ReportFact[],
  keyLength: 4 | 7,
  historyEnd: string,
): readonly number[] {
  if (facts.length === 0) return [];
  const totals = new Map<string, number>();
  for (const fact of facts) {
    const key = fact.date.slice(0, keyLength);
    totals.set(key, (totals.get(key) ?? 0) + fact.cents);
  }
  if (keyLength === 4) {
    const first = Number(facts[0]?.date.slice(0, 4));
    const last = Number(historyEnd.slice(0, 4));
    return Array.from(
      { length: last - first + 1 },
      (_, index) => totals.get(String(first + index)) ?? 0,
    );
  }
  const first = facts[0]?.date.slice(0, 7) ?? '';
  const last = historyEnd.slice(0, 7);
  const values: number[] = [];
  let cursor = `${first}-01`;
  while (cursor.slice(0, 7) <= last) {
    values.push(totals.get(cursor.slice(0, 7)) ?? 0);
    cursor = shiftLocalDateKeyMonths(cursor, 1);
  }
  return values;
}

function stats(values: readonly number[]): ReportStats {
  if (values.length === 0) {
    return {
      n: 0,
      averageCents: 0,
      standardDeviationCents: 0,
      medianCents: 0,
      minCents: 0,
      maxCents: 0,
    };
  }
  const sorted = values.toSorted((left, right) => left - right);
  const averageCents = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - averageCents) ** 2, 0) / values.length;
  const middle = Math.floor(sorted.length / 2);
  const medianCents =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  return {
    n: values.length,
    averageCents,
    standardDeviationCents: Math.sqrt(variance),
    medianCents,
    minCents: sorted[0] ?? 0,
    maxCents: sorted.at(-1) ?? 0,
  };
}
