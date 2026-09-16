import type { DatabaseSync } from 'node:sqlite';
import { listCompatibleInvestmentSnapshotRuns } from '../db/intelligence.js';
import { loadInvestments } from '../db/investment-details.js';
import {
  aggregateInvestmentAllocationBuckets,
  type InvestmentAllocationDimension,
  type InvestmentAllocationPosition,
  investmentAllocationCents,
} from '../investment-allocation.js';
import type { ResolvedReportConfig } from '../types.js';
import type { LocalDatePeriod } from './period.js';

const SNAPSHOT_VERSION = 2 as const;
const MAX_PREVIOUS_SNAPSHOT_CANDIDATES = 32;

export type InvestmentAllocationBucket = {
  readonly id: string;
  readonly label: string;
  readonly cents: number;
  readonly count: number;
};

export type InvestmentAllocationCurrency = {
  readonly currency: string;
  readonly totalCents: number;
  readonly count: number;
  readonly type: readonly InvestmentAllocationBucket[];
  readonly subtype: readonly InvestmentAllocationBucket[];
  readonly code: readonly InvestmentAllocationBucket[];
};

export type InvestmentReportSnapshot =
  | {
      readonly version: typeof SNAPSHOT_VERSION;
      readonly scopeFingerprint: string;
      readonly availability: 'excluded';
      readonly previousPeriodEnd: null;
      readonly currencies: readonly [];
    }
  | {
      readonly version: typeof SNAPSHOT_VERSION;
      readonly scopeFingerprint: string;
      readonly availability: 'included';
      readonly previousPeriodEnd: string | null;
      readonly currencies: readonly InvestmentAllocationCurrency[];
      readonly materialChanges: readonly InvestmentMaterialChange[];
    };

export type InvestmentMaterialChange = {
  readonly currency: string;
  readonly dimension: 'total' | 'type' | 'subtype' | 'code';
  readonly id: string;
  readonly label: string;
  readonly kind: 'changed' | 'added' | 'removed';
  readonly currentCents: number;
  readonly previousCents: number;
  readonly deltaCents: number;
  readonly percent: number | null;
};

export function buildInvestmentReportSnapshot(
  db: DatabaseSync,
  reportId: string,
  period: LocalDatePeriod,
  report: Pick<ResolvedReportConfig, 'accountIds'>,
): InvestmentReportSnapshot {
  const scopeFingerprint = investmentScopeFingerprint(report.accountIds);
  if (report.accountIds.length > 0) {
    return {
      version: SNAPSHOT_VERSION,
      scopeFingerprint,
      availability: 'excluded',
      previousPeriodEnd: null,
      currencies: [],
    };
  }
  const currencies = buildCurrencies(db);
  const current = {
    version: SNAPSHOT_VERSION,
    scopeFingerprint,
    availability: 'included' as const,
    previousPeriodEnd: null,
    currencies,
  };
  const previous = loadPreviousSnapshot(db, reportId, period.end, scopeFingerprint);
  return {
    ...current,
    previousPeriodEnd: previous?.periodEnd ?? null,
    materialChanges: previous ? materialChanges(previous.snapshot, current) : [],
  };
}

export function investmentScopeFingerprint(accountIds: readonly string[]): string {
  return JSON.stringify({
    version: SNAPSHOT_VERSION,
    inclusion: accountIds.length === 0 ? 'connection' : 'excluded-account-scope',
    accountIds: [...accountIds].toSorted(),
  });
}

function buildCurrencies(db: DatabaseSync): readonly InvestmentAllocationCurrency[] {
  const byCurrency = new Map<string, InvestmentAllocationPosition[]>();
  for (const row of loadInvestments(db)) {
    const position = {
      id: row.id,
      currency: row.currency,
      type: row.type,
      subtype: row.subtype,
      code: row.code,
      displayName: row.name,
      cents: row.total_cents ?? row.balance_cents ?? 0,
    };
    if (investmentAllocationCents(position) <= 0) continue;
    const positions = byCurrency.get(row.currency) ?? [];
    positions.push(position);
    byCurrency.set(row.currency, positions);
  }
  return [...byCurrency.entries()]
    .map(([currency, positions]) => {
      const buckets = (dimension: InvestmentAllocationDimension) =>
        aggregateInvestmentAllocationBuckets(positions, dimension);
      const type = buckets('type');
      return {
        currency,
        totalCents: type.reduce((sum, bucket) => sum + bucket.cents, 0),
        count: type.reduce((sum, bucket) => sum + bucket.count, 0),
        type,
        subtype: buckets('subtype'),
        code: buckets('code'),
      };
    })
    .toSorted((a, b) => a.currency.localeCompare(b.currency));
}

function loadPreviousSnapshot(
  db: DatabaseSync,
  reportId: string,
  periodEnd: string,
  fingerprint: string,
): {
  readonly snapshot: Extract<InvestmentReportSnapshot, { readonly availability: 'included' }>;
  readonly periodEnd: string;
} | null {
  const rows = listCompatibleInvestmentSnapshotRuns(db, {
    reportId,
    beforePeriodEnd: periodEnd,
    snapshotVersion: SNAPSHOT_VERSION,
    scopeFingerprint: fingerprint,
    limit: MAX_PREVIOUS_SNAPSHOT_CANDIDATES,
  });
  for (const row of rows) {
    const snapshot = parseSnapshot(row.briefingJson);
    if (snapshot?.scopeFingerprint === fingerprint) return { snapshot, periodEnd: row.periodEnd };
  }
  return null;
}

function parseSnapshot(
  raw: string,
): Extract<InvestmentReportSnapshot, { readonly availability: 'included' }> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed['investments'])) return null;
    const value = parsed['investments'];
    if (
      value['version'] !== SNAPSHOT_VERSION ||
      value['availability'] !== 'included' ||
      typeof value['scopeFingerprint'] !== 'string' ||
      !Array.isArray(value['currencies'])
    )
      return null;
    const currencies = value['currencies'].flatMap((currency) => {
      if (
        !isRecord(currency) ||
        typeof currency['currency'] !== 'string' ||
        typeof currency['totalCents'] !== 'number' ||
        typeof currency['count'] !== 'number'
      )
        return [];
      const type = parseBuckets(currency['type']);
      const subtype = parseBuckets(currency['subtype']);
      const code = parseBuckets(currency['code']);
      return type && subtype && code
        ? [
            {
              currency: currency['currency'],
              totalCents: currency['totalCents'],
              count: currency['count'],
              type,
              subtype,
              code,
            },
          ]
        : [];
    });
    if (currencies.length !== value['currencies'].length) return null;
    return {
      version: SNAPSHOT_VERSION,
      scopeFingerprint: value['scopeFingerprint'],
      availability: 'included',
      previousPeriodEnd: null,
      currencies,
      materialChanges: [],
    };
  } catch {
    return null;
  }
}

function materialChanges(
  previous: Extract<InvestmentReportSnapshot, { readonly availability: 'included' }>,
  current: Omit<
    Extract<InvestmentReportSnapshot, { readonly availability: 'included' }>,
    'materialChanges'
  >,
): readonly InvestmentMaterialChange[] {
  const output: InvestmentMaterialChange[] = [];
  const priorCurrencies = new Map(previous.currencies.map((value) => [value.currency, value]));
  const currentCurrencies = new Map(current.currencies.map((value) => [value.currency, value]));
  for (const currencyCode of new Set([...priorCurrencies.keys(), ...currentCurrencies.keys()])) {
    const currency = currentCurrencies.get(currencyCode) ?? {
      currency: currencyCode,
      totalCents: 0,
      count: 0,
      type: [],
      subtype: [],
      code: [],
    };
    const prior = priorCurrencies.get(currencyCode);
    compare(
      output,
      currencyCode,
      'total',
      'total',
      'Total',
      currency.totalCents,
      prior?.totalCents ?? 0,
      true,
    );
    for (const dimension of ['type', 'subtype', 'code'] as const) {
      const priorBuckets = new Map((prior?.[dimension] ?? []).map((value) => [value.id, value]));
      const ids = new Set([
        ...priorBuckets.keys(),
        ...currency[dimension].map((value) => value.id),
      ]);
      for (const id of ids) {
        const before = priorBuckets.get(id);
        const after = currency[dimension].find((value) => value.id === id);
        compare(
          output,
          currencyCode,
          dimension,
          id,
          after?.label ?? before?.label ?? id,
          after?.cents ?? 0,
          before?.cents ?? 0,
          true,
        );
      }
    }
  }
  return output.toSorted(
    (a, b) =>
      a.currency.localeCompare(b.currency) ||
      a.dimension.localeCompare(b.dimension) ||
      a.id.localeCompare(b.id),
  );
}

function parseBuckets(value: unknown): readonly InvestmentAllocationBucket[] | null {
  if (!Array.isArray(value)) return null;
  const buckets = value.flatMap((bucket) =>
    isRecord(bucket) &&
    typeof bucket['id'] === 'string' &&
    typeof bucket['label'] === 'string' &&
    typeof bucket['cents'] === 'number' &&
    typeof bucket['count'] === 'number'
      ? [
          {
            id: bucket['id'],
            label: bucket['label'],
            cents: bucket['cents'],
            count: bucket['count'],
          },
        ]
      : [],
  );
  return buckets.length === value.length ? buckets : null;
}

function compare(
  output: InvestmentMaterialChange[],
  currency: string,
  dimension: InvestmentMaterialChange['dimension'],
  id: string,
  label: string,
  currentCents: number,
  previousCents: number,
  baselineExists: boolean,
): void {
  if (!baselineExists || currentCents === previousCents) return;
  const deltaCents = currentCents - previousCents;
  const kind = previousCents === 0 ? 'added' : currentCents === 0 ? 'removed' : 'changed';
  if (kind === 'changed' && Math.abs(deltaCents) * 100 <= Math.abs(previousCents)) return;
  output.push({
    currency,
    dimension,
    id,
    label,
    kind,
    currentCents,
    previousCents,
    deltaCents,
    percent: kind === 'changed' ? (deltaCents / previousCents) * 100 : null,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
