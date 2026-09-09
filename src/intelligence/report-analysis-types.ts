import type { LocalDatePeriod } from './period.js';
import type { ReportTaxonomy } from './report-taxonomy.js';
import type { TaxonomyTreatment } from './report-taxonomy-policy.js';

export type ReportCadence = 'daily' | 'weekly' | 'monthly';
export type ReportFactDirection = 'expense' | 'income' | 'refund';
export type ReportClassificationSource =
  | 'confirmed'
  | 'accepted-suggestion'
  | 'assumed-suggestion'
  | 'unclassified';
export type SpendingPattern =
  | 'undefined'
  | 'one-off'
  | 'monthly-recurring'
  | 'yearly-recurring'
  | 'small-bursts';

export type ReportFact = {
  readonly id: string;
  readonly date: string;
  readonly cents: number;
  readonly currency: string;
  readonly direction: ReportFactDirection;
  readonly account: string;
  readonly party: string;
  readonly detail?: string | undefined;
  readonly installment?: string | undefined;
  readonly installmentPurchaseCents?: number | undefined;
  readonly taxonomies: readonly ReportTaxonomy[];
  readonly classification: ReportClassificationSource;
  readonly suggestionScore?: number | undefined;
  readonly treatment: Exclude<TaxonomyTreatment, 'internal-own-account'>;
  readonly href: string;
};

export type ReportStats = {
  readonly n: number;
  readonly averageCents: number;
  readonly standardDeviationCents: number;
  readonly medianCents: number;
  readonly minCents: number;
  readonly maxCents: number;
};

export type ReportProfile = {
  readonly key: string;
  readonly kind: ReportTaxonomy['kind'];
  readonly id: string;
  readonly path: string;
  readonly depth: number;
  readonly pattern: SpendingPattern;
  readonly basis: 'active-day' | 'month' | 'year' | 'burst';
  readonly stats: ReportStats;
  readonly history: {
    readonly facts: number;
    readonly first: string | null;
    readonly last: string | null;
    readonly activeMonths: number;
    readonly spanMonths: number;
    readonly monthlyCoverage: number;
    readonly bursts: number;
  };
  readonly current: {
    readonly facts: number;
    readonly cents: number;
    readonly comparable: boolean;
    readonly deltaCents: number | null;
    readonly deltaRatio: number | null;
    readonly zScore: number | null;
    readonly expectedness: 'no-baseline' | 'within-range' | 'unusual';
  };
};

export type ReportCandidate = {
  readonly id: string;
  readonly kind: 'offset' | 'transaction' | 'aggregate';
  readonly importance: number;
  readonly title: string;
  readonly amount: string;
  readonly baseline?: string | undefined;
  readonly delta?: string | undefined;
  readonly ratio?: string | undefined;
  readonly signal: 'no-baseline' | 'within-range' | 'unusual';
  readonly transactionIds: readonly string[];
  readonly profileRefs: readonly string[];
  readonly preferredProfileRef?: string | undefined;
  readonly evidence: readonly string[];
  readonly driver?: {
    readonly date: string;
    readonly party: string;
    readonly detail?: string | undefined;
    readonly installment?: string | undefined;
    readonly installmentGroup?:
      | {
          readonly installment: string;
          readonly currentCharge: string;
          readonly purchaseTotal: string;
        }
      | undefined;
    readonly href: string;
    readonly category?: string | undefined;
    readonly labels: readonly string[];
    readonly classification: ReportClassificationSource;
    readonly partyHistory: {
      readonly count: number;
      readonly first: string | null;
      readonly last: string | null;
      readonly average: string | null;
    };
  };
  readonly periodHref?: string | undefined;
};

export type ReportAnalysis = {
  readonly period: LocalDatePeriod & { readonly cadence: ReportCadence };
  readonly language: string;
  readonly currency: string;
  readonly summary: {
    readonly expense: string;
    readonly income: string;
    readonly refund: string;
    readonly expenseDelta: string;
    readonly expenseRatio: string | null;
    readonly incomeDelta: string;
    readonly incomeRatio: string | null;
  };
  readonly candidates: readonly ReportCandidate[];
  readonly profiles: readonly ReportProfile[];
  readonly mustInspect: readonly string[];
  readonly mustReport: readonly string[];
  readonly classification: Readonly<Record<ReportClassificationSource, number>>;
  readonly excluded: {
    readonly internal: { readonly structural: number; readonly semantic: number };
    readonly portfolio: number;
    readonly settlements: number;
  };
  readonly chart: readonly {
    readonly start: string;
    readonly end: string;
    readonly incomeCents: number;
    readonly expenseCents: number;
    readonly categoryTotals: Readonly<Record<string, number>>;
    readonly labelTotals: Readonly<Record<string, number>>;
  }[];
};
