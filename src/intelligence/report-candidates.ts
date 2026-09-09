import LZString from 'lz-string';
import type { LocalDatePeriod } from './period.js';
import {
  daysBetween,
  formatMoney,
  formatRatio,
  formatSignedMoney,
  normalizeCompare,
  sumCents,
} from './report-analysis-helpers.js';
import type { ReportCandidate, ReportFact, ReportProfile } from './report-analysis-types.js';
import { profileComparison } from './report-profiles.js';
import type { ReportTaxonomy } from './report-taxonomy.js';

const MAX_CANDIDATES = 12;
const { compressToEncodedURIComponent } = LZString;

type CandidateBuildInput = {
  readonly facts: readonly ReportFact[];
  readonly currentFacts: readonly ReportFact[];
  readonly profiles: readonly ReportProfile[];
  readonly period: LocalDatePeriod;
  readonly language: string;
  readonly currency: string;
  readonly publicBaseUrl: string | undefined;
  readonly floorCents: number;
};

export function buildCandidates(input: CandidateBuildInput): readonly ReportCandidate[] {
  const offsets = buildOffsetCandidates(input);
  const offsetExpenseIds = new Set(
    offsets.flatMap((candidate) => candidate.transactionIds.slice(0, 1)),
  );
  return [
    ...offsets,
    ...buildTransactionCandidates(input, offsetExpenseIds),
    ...buildAggregateCandidates(input, offsetExpenseIds),
  ]
    .toSorted(
      (left, right) => right.importance - left.importance || left.id.localeCompare(right.id),
    )
    .slice(0, MAX_CANDIDATES);
}

function buildOffsetCandidates(input: CandidateBuildInput): readonly ReportCandidate[] {
  const candidates: ReportCandidate[] = [];
  const expenses = input.currentFacts.filter((fact) => fact.direction === 'expense');
  const incomes = input.currentFacts.filter((fact) => fact.direction === 'income');
  const consumed = new Set<string>();
  for (const expense of expenses.toSorted((left, right) => right.cents - left.cents)) {
    const match = incomes.find(
      (income) =>
        !consumed.has(income.id) &&
        income.cents === expense.cents &&
        income.account === expense.account &&
        Math.abs(daysBetween(expense.date, income.date)) <= 7,
    );
    if (!match || expense.cents < Math.max(input.floorCents, 10_000)) continue;
    consumed.add(match.id);
    candidates.push({
      id: `offset:${expense.id}:${match.id}`,
      kind: 'offset',
      importance: expense.cents * 3,
      title: `${expense.party} / ${match.party}`,
      amount: formatMoney(expense.cents, input.language, input.currency),
      signal: 'unusual',
      transactionIds: [expense.id, match.id],
      profileRefs: [],
      evidence: [
        `Exact opposite amounts in the same account within seven days: ${expense.date} and ${match.date}.`,
        `<a href="${expense.href}">${expense.date}</a>`,
        `<a href="${match.href}">${match.date}</a>`,
      ],
    });
  }
  return candidates;
}

function buildTransactionCandidates(
  input: CandidateBuildInput,
  offsetExpenseIds: ReadonlySet<string>,
): readonly ReportCandidate[] {
  const candidates: ReportCandidate[] = [];
  const expenses = input.currentFacts.filter(
    (fact) =>
      fact.direction === 'expense' &&
      fact.cents >= input.floorCents &&
      !offsetExpenseIds.has(fact.id),
  );
  const largestByTaxonomy = largestExpenseByDeepTaxonomy(expenses);
  const profileByKey = new Map(input.profiles.map((profile) => [profile.key, profile]));
  const seenInstallments = new Set<string>();
  const periodExpenseCents = sumCents(
    input.currentFacts.filter((fact) => fact.direction === 'expense'),
  );
  for (const fact of expenses
    .filter((candidate) => !isOvershadowed(candidate, largestByTaxonomy))
    .toSorted((left, right) => right.cents - left.cents)
    .slice(0, 8)) {
    if (fact.installment) {
      const installmentKey = `${normalizeCompare(fact.party)}:${normalizeCompare(fact.detail ?? '')}:${fact.installment.split('/')[1] ?? ''}`;
      if (seenInstallments.has(installmentKey)) continue;
      seenInstallments.add(installmentKey);
    }
    const candidate = buildTransactionCandidate(fact, input, profileByKey);
    if (candidate.signal !== 'unusual' && fact.cents < periodExpenseCents * 0.2) continue;
    candidates.push(candidate);
  }
  return candidates;
}

function largestExpenseByDeepTaxonomy(facts: readonly ReportFact[]): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const fact of facts) {
    for (const taxonomy of deepestTaxonomies(fact.taxonomies)) {
      const key = `${taxonomy.kind}:${taxonomy.id}`;
      result.set(key, Math.max(result.get(key) ?? 0, fact.cents));
    }
  }
  return result;
}

function isOvershadowed(fact: ReportFact, largestByTaxonomy: ReadonlyMap<string, number>): boolean {
  return deepestTaxonomies(fact.taxonomies).some((taxonomy) => {
    const largest = largestByTaxonomy.get(`${taxonomy.kind}:${taxonomy.id}`) ?? fact.cents;
    return fact.cents < largest * 0.05;
  });
}

function deepestTaxonomies(taxonomies: readonly ReportTaxonomy[]): readonly ReportTaxonomy[] {
  const deepest = new Map<ReportTaxonomy['kind'], ReportTaxonomy>();
  for (const taxonomy of taxonomies) {
    const current = deepest.get(taxonomy.kind);
    if (!current || taxonomy.depth > current.depth) deepest.set(taxonomy.kind, taxonomy);
  }
  return [...deepest.values()];
}

function buildTransactionCandidate(
  fact: ReportFact,
  input: CandidateBuildInput,
  profileByKey: ReadonlyMap<string, ReportProfile>,
): ReportCandidate {
  const refs = fact.taxonomies
    .flatMap((taxonomy) => {
      const key = `${taxonomy.kind}:${taxonomy.id}`;
      const profile = profileByKey.get(key);
      return profile ? [{ key, profile }] : [];
    })
    .toSorted(compareProfileRelevance)
    .slice(0, 2)
    .map(({ key }) => key);
  const preferred = selectPreferredProfile(fact, refs, profileByKey, input.currentFacts);
  const comparison = preferred ? profileComparison(fact.cents, preferred.stats) : null;
  return {
    id: `transaction:${fact.id}`,
    kind: 'transaction',
    importance: fact.cents * (comparison?.expectedness === 'unusual' ? 2 : 1),
    title: fact.detail ?? fact.party,
    amount: formatMoney(fact.cents, input.language, input.currency),
    ...candidateComparison(preferred, comparison, input),
    signal: comparison?.expectedness ?? 'no-baseline',
    transactionIds: [fact.id],
    profileRefs: refs,
    ...(preferred ? { preferredProfileRef: preferred.key } : {}),
    evidence: preferred
      ? [`${preferred.path}: ${preferred.pattern}, ${preferred.basis}, n=${preferred.stats.n}.`]
      : ['No relevant classification baseline.'],
    driver: buildCandidateDriver(fact, input),
  };
}

function selectPreferredProfile(
  fact: ReportFact,
  refs: readonly string[],
  profiles: ReadonlyMap<string, ReportProfile>,
  currentFacts: readonly ReportFact[],
): ReportProfile | undefined {
  return refs
    .flatMap((key) => {
      const profile = profiles.get(key);
      return profile?.basis === 'active-day' &&
        currentActiveDayTotal(currentFacts, fact.date, profile) === fact.cents
        ? [profile]
        : [];
    })
    .toSorted(compareProfileRelevance)[0];
}

function currentActiveDayTotal(
  facts: readonly ReportFact[],
  date: string,
  profile: ReportProfile,
): number {
  let total = 0;
  for (const fact of facts) {
    if (
      fact.direction === 'expense' &&
      fact.date === date &&
      fact.taxonomies.some(
        (taxonomy) => taxonomy.kind === profile.kind && taxonomy.id === profile.id,
      )
    ) {
      total += fact.cents;
    }
  }
  return total;
}

function compareProfileRelevance(
  left: { readonly profile: ReportProfile } | ReportProfile,
  right: { readonly profile: ReportProfile } | ReportProfile,
): number {
  const leftProfile = 'profile' in left ? left.profile : left;
  const rightProfile = 'profile' in right ? right.profile : right;
  return (
    Number(rightProfile.stats.n > 0) - Number(leftProfile.stats.n > 0) ||
    rightProfile.depth - leftProfile.depth ||
    rightProfile.current.cents - leftProfile.current.cents
  );
}

function candidateComparison(
  profile: ReportProfile | undefined,
  comparison: ReturnType<typeof profileComparison> | null,
  input: Pick<CandidateBuildInput, 'language' | 'currency'>,
): Pick<ReportCandidate, 'baseline' | 'delta' | 'ratio'> {
  if (!profile || !comparison || comparison.deltaCents === null) return {};
  return {
    baseline: formatMoney(profile.stats.averageCents, input.language, input.currency),
    delta: formatSignedMoney(comparison.deltaCents, input.language, input.currency),
    ...(comparison.deltaRatio === null
      ? {}
      : { ratio: formatRatio(comparison.deltaRatio, input.language) ?? undefined }),
  };
}

function buildCandidateDriver(
  fact: ReportFact,
  input: CandidateBuildInput,
): NonNullable<ReportCandidate['driver']> {
  const history = input.facts.filter(
    (candidate) =>
      candidate.direction === fact.direction &&
      candidate.currency === fact.currency &&
      normalizeCompare(candidate.party) === normalizeCompare(fact.party) &&
      candidate.date < input.period.start,
  );
  const installmentGroup =
    fact.installment && fact.installmentPurchaseCents
      ? {
          installment: fact.installment,
          currentCharge: formatMoney(fact.cents, input.language, input.currency),
          purchaseTotal: formatMoney(fact.installmentPurchaseCents, input.language, input.currency),
        }
      : undefined;
  return {
    date: fact.date,
    party: fact.party,
    ...(fact.detail ? { detail: fact.detail } : {}),
    ...(fact.installment ? { installment: fact.installment } : {}),
    ...(installmentGroup ? { installmentGroup } : {}),
    href: fact.href,
    category: deepestPath(fact.taxonomies, 'category'),
    labels: pathsFor(fact.taxonomies, 'label'),
    classification: fact.classification,
    partyHistory: {
      count: history.length,
      first: history[0]?.date ?? null,
      last: history.at(-1)?.date ?? null,
      average:
        history.length === 0
          ? null
          : formatMoney(sumCents(history) / history.length, input.language, input.currency),
    },
  };
}

function buildAggregateCandidates(
  input: CandidateBuildInput,
  offsetExpenseIds: ReadonlySet<string>,
): readonly ReportCandidate[] {
  const aggregateProfiles = input.profiles
    .filter(
      (profile) =>
        profile.depth === 1 &&
        profile.current.cents >= input.floorCents &&
        profile.current.deltaCents !== null &&
        !isDominatedByOffset(profile, input, offsetExpenseIds),
    )
    .toSorted(
      (left, right) =>
        Math.abs(right.current.deltaCents ?? 0) - Math.abs(left.current.deltaCents ?? 0),
    )
    .slice(0, 8);
  return aggregateProfiles.map((profile) => ({
    id: `aggregate:${profile.key}`,
    kind: 'aggregate',
    importance: Math.abs(profile.current.deltaCents ?? 0) + profile.current.cents,
    title: profile.path,
    amount: formatMoney(profile.current.cents, input.language, input.currency),
    signal: profile.current.expectedness,
    baseline: formatMoney(profile.stats.averageCents, input.language, input.currency),
    delta: formatSignedMoney(profile.current.deltaCents ?? 0, input.language, input.currency),
    ...(profile.current.deltaRatio === null
      ? {}
      : { ratio: formatRatio(profile.current.deltaRatio, input.language) ?? undefined }),
    transactionIds: [],
    profileRefs: [profile.key],
    preferredProfileRef: profile.key,
    evidence: [`${profile.pattern}, ${profile.basis}, n=${profile.stats.n}.`],
    periodHref: buildReportPeriodHref({
      publicBaseUrl: input.publicBaseUrl,
      period: input.period,
      kind: profile.kind,
      id: profile.id,
    }),
  }));
}

function isDominatedByOffset(
  profile: ReportProfile,
  input: CandidateBuildInput,
  offsetExpenseIds: ReadonlySet<string>,
): boolean {
  const matchedCents = input.currentFacts.reduce((sum, fact) => {
    if (!offsetExpenseIds.has(fact.id)) return sum;
    return fact.taxonomies.some(
      (taxonomy) => taxonomy.kind === profile.kind && taxonomy.id === profile.id,
    )
      ? sum + fact.cents
      : sum;
  }, 0);
  return matchedCents >= profile.current.cents * 0.5;
}

export function selectMustReport(candidates: readonly ReportCandidate[]): readonly string[] {
  const selected: string[] = [];
  for (const candidate of candidates) {
    if (
      candidate.kind === 'offset' ||
      candidate.signal === 'unusual' ||
      (candidate.kind === 'transaction' && candidate.signal === 'no-baseline')
    ) {
      selected.push(candidate.id);
      if (selected.length === 5) break;
    }
  }
  return selected;
}

export function buildReportPeriodHref(input: {
  readonly publicBaseUrl: string | undefined;
  readonly period: LocalDatePeriod;
  readonly kind: ReportTaxonomy['kind'];
  readonly id: string;
}): string {
  const filterKey = input.kind === 'category' ? 'category-id' : 'label-id';
  const state = {
    f: {
      d: 'custom',
      'start-date': `${input.period.start}T00:00`,
      'end-date': `${input.period.end}T23:59`,
      [filterKey]: input.id,
    },
    display: { category: 'full', labels: 'full', date: 'credit-purchase' },
  };
  const base = input.publicBaseUrl?.replace(/\/+$/u, '');
  return `${base ? `${base}/` : ''}#/transactions/s=${compressToEncodedURIComponent(JSON.stringify(state))}`;
}

function deepestPath(
  facts: readonly ReportTaxonomy[],
  kind: ReportTaxonomy['kind'],
): string | undefined {
  let deepest: ReportTaxonomy | undefined;
  for (const fact of facts) {
    if (fact.kind === kind && (!deepest || fact.depth > deepest.depth)) deepest = fact;
  }
  return deepest?.path;
}

function pathsFor(
  facts: readonly ReportTaxonomy[],
  kind: ReportTaxonomy['kind'],
): readonly string[] {
  const paths: string[] = [];
  for (const fact of facts) {
    if (fact.kind === kind) paths.push(fact.path);
  }
  return paths;
}
