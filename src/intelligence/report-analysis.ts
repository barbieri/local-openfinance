import type { DatabaseSync } from 'node:sqlite';
import type { ResolvedConfig } from '../types.js';
import { addDaysToLocalDateKey, type LocalDatePeriod, shiftLocalDateKeyMonths } from './period.js';
import {
  changeRatio,
  daysBetween,
  formatMoney,
  formatRatio,
  formatSignedMoney,
  within,
} from './report-analysis-helpers.js';
import type {
  ReportAnalysis,
  ReportCadence,
  ReportCandidate,
  ReportClassificationSource,
  ReportFact,
  ReportProfile,
} from './report-analysis-types.js';
import { buildCandidates, selectMustReport } from './report-candidates.js';
import { loadReportFacts } from './report-facts.js';
import { buildProfiles } from './report-profiles.js';
import type { ReportQueryScope } from './report-scope.js';
import type { ReportTaxonomy } from './report-taxonomy.js';
import type { ReportTaxonomyPolicy } from './report-taxonomy-policy.js';

const MAX_PROFILES = 12;

type BuildReportAnalysisInput = {
  readonly db: DatabaseSync;
  readonly resolved: ResolvedConfig;
  readonly scope: ReportQueryScope;
  readonly policy: ReportTaxonomyPolicy;
};

export type ReportAnalysisPacket = {
  readonly analysis: ReportAnalysis;
  readonly reportableFacts: readonly ReportFact[];
};

export type {
  ReportAnalysis,
  ReportCadence,
  ReportCandidate,
  ReportClassificationSource,
  ReportFact,
  ReportFactDirection,
  ReportProfile,
  ReportStats,
  SpendingPattern,
} from './report-analysis-types.js';
export { buildReportPeriodHref } from './report-candidates.js';

export function buildReportAnalysis(input: BuildReportAnalysisInput): ReportAnalysis {
  return buildReportAnalysisPacket(input).analysis;
}

export function buildReportAnalysisPacket(input: BuildReportAnalysisInput): ReportAnalysisPacket {
  const { resolved, scope } = input;
  const cadence = reportCadence(scope);
  const loaded = loadReportFacts({
    ...input,
    historyStart: addDaysToLocalDateKey(
      scope.period.start,
      -resolved.config.intelligence.rareLookbackYears * 366,
    ),
  });
  const analyticalFacts = loaded.facts.filter((fact) => fact.treatment === 'reportable');
  const currentFacts = within(analyticalFacts, scope.period);
  const previousPeriod = previousPeriodFor(scope.period, cadence);
  const currency = resolveAnalysisCurrency(currentFacts, analyticalFacts);
  const currencyFacts = analyticalFacts.filter((fact) => fact.currency === currency);
  const currentCurrencyFacts = within(currencyFacts, scope.period);
  const previousCurrencyFacts = within(currencyFacts, previousPeriod);
  const profiles = buildProfiles(currencyFacts, scope.period, cadence);
  const candidates = buildCandidates({
    facts: currencyFacts,
    currentFacts: currentCurrencyFacts,
    profiles,
    period: scope.period,
    language: scope.report.language,
    currency,
    publicBaseUrl: resolved.config.web.publicBaseUrl,
    floorCents: resolved.config.intelligence.minReportedItemAmountCents,
  });
  const mustReport = selectMustReport(candidates);
  const relevantProfiles = selectAnalysisProfiles(profiles, candidates, mustReport);
  const totals = directionTotals(currentCurrencyFacts);
  const priorTotals = directionTotals(previousCurrencyFacts);
  const chart = chartPeriods(scope.period, cadence).map((period) => {
    const periodFacts = within(currencyFacts, period);
    const periodTotals = directionTotals(periodFacts);
    return {
      ...period,
      incomeCents: periodTotals.income,
      expenseCents: periodTotals.expense,
      categoryTotals: rootTaxonomyTotals(periodFacts, 'category'),
      labelTotals: rootTaxonomyTotals(periodFacts, 'label'),
    };
  });
  const analysis: ReportAnalysis = {
    period: { ...scope.period, cadence },
    language: scope.report.language,
    currency,
    summary: {
      expense: formatMoney(totals.expense, scope.report.language, currency),
      income: formatMoney(totals.income, scope.report.language, currency),
      refund: formatMoney(totals.refund, scope.report.language, currency),
      expenseDelta: formatSignedMoney(
        totals.expense - priorTotals.expense,
        scope.report.language,
        currency,
      ),
      expenseRatio: formatRatio(
        changeRatio(totals.expense, priorTotals.expense),
        scope.report.language,
      ),
      incomeDelta: formatSignedMoney(
        totals.income - priorTotals.income,
        scope.report.language,
        currency,
      ),
      incomeRatio: formatRatio(
        changeRatio(totals.income, priorTotals.income),
        scope.report.language,
      ),
    },
    candidates,
    profiles: relevantProfiles,
    mustInspect: candidates.slice(0, 6).map((candidate) => candidate.id),
    mustReport,
    classification: classificationCounts(currentCurrencyFacts),
    excluded: loaded.excluded,
    chart,
  };
  return { analysis, reportableFacts: analyticalFacts };
}

export function selectAnalysisProfiles(
  profiles: readonly ReportProfile[],
  candidates: readonly ReportCandidate[],
  mustReport: readonly string[],
): readonly ReportProfile[] {
  const mustReportIds = new Set(mustReport);
  const requiredProfileKeys = new Set<string>();
  const relevantProfileKeys = new Set<string>();
  for (const candidate of candidates) {
    const required = mustReportIds.has(candidate.id);
    for (const profileRef of candidate.profileRefs) {
      relevantProfileKeys.add(profileRef);
      if (required) requiredProfileKeys.add(profileRef);
    }
  }
  return profiles
    .filter((profile) => relevantProfileKeys.has(profile.key))
    .toSorted(
      (left, right) =>
        right.current.cents - left.current.cents ||
        right.depth - left.depth ||
        left.key.localeCompare(right.key),
    )
    .filter((profile, index) => index < MAX_PROFILES || requiredProfileKeys.has(profile.key));
}

function resolveAnalysisCurrency(
  currentFacts: readonly ReportFact[],
  history: readonly ReportFact[],
): string {
  const currentExpenseByCurrency = new Map<string, number>();
  for (const fact of currentFacts) {
    if (fact.direction !== 'expense') continue;
    currentExpenseByCurrency.set(
      fact.currency,
      (currentExpenseByCurrency.get(fact.currency) ?? 0) + fact.cents,
    );
  }
  return (
    [...currentExpenseByCurrency.entries()].toSorted(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )[0]?.[0] ??
    history.at(-1)?.currency ??
    'BRL'
  );
}

function reportCadence(scope: ReportQueryScope): ReportCadence {
  if (scope.report.window.kind === 'last-complete-day') return 'daily';
  if (scope.report.window.kind === 'last-complete-month') return 'monthly';
  return 'weekly';
}

function previousPeriodFor(period: LocalDatePeriod, cadence: ReportCadence): LocalDatePeriod {
  if (cadence === 'monthly') {
    const start = shiftLocalDateKeyMonths(period.start, -1);
    return { start, end: addDaysToLocalDateKey(period.start, -1) };
  }
  const length = daysBetween(period.start, period.end) + 1;
  return {
    start: addDaysToLocalDateKey(period.start, -length),
    end: addDaysToLocalDateKey(period.end, -length),
  };
}

function chartPeriods(period: LocalDatePeriod, cadence: ReportCadence): readonly LocalDatePeriod[] {
  if (cadence === 'monthly') {
    return Array.from({ length: 12 }, (_, index) => {
      const start = shiftLocalDateKeyMonths(period.start, index - 11);
      return { start, end: addDaysToLocalDateKey(shiftLocalDateKeyMonths(start, 1), -1) };
    });
  }
  const count = cadence === 'daily' ? 30 : 8;
  const days = cadence === 'daily' ? 1 : daysBetween(period.start, period.end) + 1;
  return Array.from({ length: count }, (_, index) => {
    const offset = (index - count + 1) * days;
    return {
      start: addDaysToLocalDateKey(period.start, offset),
      end: addDaysToLocalDateKey(period.end, offset),
    };
  });
}

function rootTaxonomyTotals(
  facts: readonly ReportFact[],
  kind: ReportTaxonomy['kind'],
): Readonly<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const fact of facts) {
    if (fact.direction !== 'expense') continue;
    const roots = fact.taxonomies.filter(
      (taxonomy) => taxonomy.kind === kind && taxonomy.depth === 1,
    );
    for (const root of roots) {
      totals[root.id] = (totals[root.id] ?? 0) + fact.cents;
    }
  }
  return totals;
}

function directionTotals(facts: readonly ReportFact[]) {
  const totals = { expense: 0, income: 0, refund: 0 };
  for (const fact of facts) totals[fact.direction] += fact.cents;
  return totals;
}

function classificationCounts(
  facts: readonly ReportFact[],
): Readonly<Record<ReportClassificationSource, number>> {
  const counts: Record<ReportClassificationSource, number> = {
    confirmed: 0,
    'accepted-suggestion': 0,
    'assumed-suggestion': 0,
    unclassified: 0,
  };
  for (const fact of facts) counts[fact.classification] += 1;
  return counts;
}
