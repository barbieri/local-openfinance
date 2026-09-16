import {
  aggregateInvestmentAllocationBuckets,
  type InvestmentAllocationDimension,
  investmentAllocationBucketIdentity,
  type InvestmentAllocationPosition as SharedInvestmentAllocationPosition,
} from '../../../../investment-allocation.js';

const COMMON_TYPE_COLORS: Readonly<Record<string, string>> = {
  FIXED_INCOME: '#0f766e',
  VARIABLE_INCOME: '#2563eb',
};

export type InvestmentAllocationBucket = {
  readonly id: string;
  readonly label: string;
  readonly cents: number;
  readonly color: string;
};

export type InvestmentAllocationPosition = {
  readonly id: string;
  readonly currency: string;
  readonly type: string;
  readonly subtype: string;
  readonly code: string | null;
  readonly displayName: string;
  readonly totalCents: number;
  readonly allocationCents: number;
};

function allocationPosition(
  position: InvestmentAllocationPosition,
): SharedInvestmentAllocationPosition {
  return {
    id: position.id,
    currency: position.currency,
    type: position.type,
    subtype: position.subtype,
    code: position.code,
    displayName: position.displayName,
    cents: positiveAllocationCents(position),
  };
}

export type InvestmentAllocationModel = {
  readonly positions: readonly InvestmentAllocationPosition[];
  readonly positionsByCurrency: ReadonlyMap<string, readonly InvestmentAllocationPosition[]>;
  readonly allocationById: ReadonlyMap<string, number>;
  readonly amountTotalsByCurrency: readonly (readonly [string, number])[];
  readonly allocationTotalsByCurrency: ReadonlyMap<string, number>;
};

export type InvestmentAllocationGroupCurrencySummary = {
  readonly currency: string;
  readonly totalCents: number;
  readonly allocationPercent: number | null;
};

export type InvestmentAllocationGroupSummary = {
  readonly currencies: readonly InvestmentAllocationGroupCurrencySummary[];
};

export type InvestmentAllocationSelection = {
  readonly typeId: string | null;
  readonly subtypeId: string | null;
  readonly codeId: string | null;
};

export type ResolvedInvestmentAllocationSelection = InvestmentAllocationSelection & {
  readonly type: InvestmentAllocationBucket | null;
  readonly subtype: InvestmentAllocationBucket | null;
  readonly code: InvestmentAllocationBucket | null;
};

export type InvestmentAllocationCurrencyChart = {
  readonly currency: string;
  readonly types: readonly InvestmentAllocationBucket[];
  readonly subtypes: readonly InvestmentAllocationBucket[];
  readonly codes: readonly InvestmentAllocationBucket[];
  readonly selection: ResolvedInvestmentAllocationSelection;
};

export function clearInvestmentAllocationChartSelections(
  _selections: Readonly<Record<string, InvestmentAllocationSelection>>,
): Readonly<Record<string, InvestmentAllocationSelection>> {
  return {};
}

function readableValue(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function sortedCurrencyEntries(totals: ReadonlyMap<string, number>): Array<[string, number]> {
  const entries = [...totals.entries()];
  entries.sort(([left], [right]) => left.localeCompare(right));
  return entries;
}

function positiveAllocationCents(position: InvestmentAllocationPosition): number {
  return Number.isFinite(position.allocationCents) && position.allocationCents > 0
    ? position.allocationCents
    : 0;
}

function addPositionByCurrency(
  positionsByCurrency: Map<string, InvestmentAllocationPosition[]>,
  currency: string,
  position: InvestmentAllocationPosition,
): void {
  const existing = positionsByCurrency.get(currency);
  if (existing) {
    existing.push(position);
    return;
  }
  positionsByCurrency.set(currency, [position]);
}

function buildAllocationById(
  positionsByCurrency: ReadonlyMap<string, readonly InvestmentAllocationPosition[]>,
  allocationTotalsByCurrency: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  const allocationById = new Map<string, number>();
  for (const [currency, currencyPositions] of positionsByCurrency) {
    const total = allocationTotalsByCurrency.get(currency) ?? 0;
    if (total <= 0) {
      continue;
    }
    for (const position of currencyPositions) {
      const cents = positiveAllocationCents(position);
      if (position.id && cents > 0) {
        allocationById.set(position.id, cents / total);
      }
    }
  }
  return allocationById;
}

export function buildInvestmentAllocationModel(
  positions: readonly InvestmentAllocationPosition[],
): InvestmentAllocationModel {
  const positionsByCurrency = new Map<string, InvestmentAllocationPosition[]>();
  const amountTotalsByCurrency = new Map<string, number>();
  const allocationTotalsByCurrency = new Map<string, number>();
  for (const position of positions) {
    const currency = readableValue(position.currency, 'BRL');
    addPositionByCurrency(positionsByCurrency, currency, position);
    const totalCents = Number.isFinite(position.totalCents) ? position.totalCents : 0;
    amountTotalsByCurrency.set(currency, (amountTotalsByCurrency.get(currency) ?? 0) + totalCents);
    allocationTotalsByCurrency.set(
      currency,
      (allocationTotalsByCurrency.get(currency) ?? 0) + positiveAllocationCents(position),
    );
  }
  return {
    positions,
    positionsByCurrency,
    allocationById: buildAllocationById(positionsByCurrency, allocationTotalsByCurrency),
    amountTotalsByCurrency: sortedCurrencyEntries(amountTotalsByCurrency),
    allocationTotalsByCurrency,
  };
}

export function summarizeInvestmentAllocationGroup(
  model: InvestmentAllocationModel,
  positionIds: Iterable<string>,
): InvestmentAllocationGroupSummary {
  const ids = new Set(positionIds);
  const amountTotalsByCurrency = new Map<string, number>();
  const allocationTotalsByCurrency = new Map<string, number>();
  for (const position of model.positions) {
    if (!ids.has(position.id)) {
      continue;
    }
    const currency = readableValue(position.currency, 'BRL');
    const totalCents = Number.isFinite(position.totalCents) ? position.totalCents : 0;
    amountTotalsByCurrency.set(currency, (amountTotalsByCurrency.get(currency) ?? 0) + totalCents);
    allocationTotalsByCurrency.set(
      currency,
      (allocationTotalsByCurrency.get(currency) ?? 0) + positiveAllocationCents(position),
    );
  }
  return {
    currencies: sortedCurrencyEntries(amountTotalsByCurrency).map(([currency, totalCents]) => {
      const portfolioAllocationTotal = model.allocationTotalsByCurrency.get(currency) ?? 0;
      const groupAllocationTotal = allocationTotalsByCurrency.get(currency) ?? 0;
      return {
        currency,
        totalCents,
        allocationPercent:
          portfolioAllocationTotal > 0 ? groupAllocationTotal / portfolioAllocationTotal : null,
      };
    }),
  };
}

function stableHash(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash;
}

export function investmentAllocationChartColor(id: string): string {
  const commonColor = COMMON_TYPE_COLORS[id];
  if (commonColor) {
    return commonColor;
  }
  const hash = stableHash(id);
  const hue = hash % 360;
  const saturation = 56 + ((hash >>> 9) % 18);
  const lightness = 36 + ((hash >>> 16) % 16);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export function assignInvestmentAllocationChartColors(
  ids: readonly string[],
): ReadonlyMap<string, string> {
  return new Map([...new Set(ids)].map((id) => [id, investmentAllocationChartColor(id)]));
}

function aggregateBuckets(
  positions: readonly InvestmentAllocationPosition[],
  dimension: InvestmentAllocationDimension,
): InvestmentAllocationBucket[] {
  const buckets = aggregateInvestmentAllocationBuckets(
    positions.map(allocationPosition),
    dimension,
  );
  const colors = assignInvestmentAllocationChartColors(buckets.map((bucket) => bucket.id));
  return buckets.map((bucket) => ({ ...bucket, color: colors.get(bucket.id) ?? '#64748b' }));
}

function rowsForType(
  positions: readonly InvestmentAllocationPosition[],
  typeId: string,
): InvestmentAllocationPosition[] {
  return positions.filter(
    (position) =>
      investmentAllocationBucketIdentity(allocationPosition(position), 'type').id === typeId,
  );
}

function rowsForSubtype(
  positions: readonly InvestmentAllocationPosition[],
  typeId: string,
  subtypeId: string,
): InvestmentAllocationPosition[] {
  return positions.filter(
    (position) =>
      investmentAllocationBucketIdentity(allocationPosition(position), 'type').id === typeId &&
      investmentAllocationBucketIdentity(allocationPosition(position), 'subtype').id === subtypeId,
  );
}

function selectedBucket(
  buckets: readonly InvestmentAllocationBucket[],
  requestedId: string | null,
  resolveSingleton = true,
): InvestmentAllocationBucket | null {
  if (resolveSingleton && buckets.length === 1) {
    return buckets[0] ?? null;
  }
  return buckets.find((bucket) => bucket.id === requestedId) ?? null;
}

export function resolveInvestmentAllocationSelection({
  types,
  subtypes,
  codes,
  selection,
}: {
  readonly types: readonly InvestmentAllocationBucket[];
  readonly subtypes: readonly InvestmentAllocationBucket[];
  readonly codes: readonly InvestmentAllocationBucket[];
  readonly selection: InvestmentAllocationSelection;
}): ResolvedInvestmentAllocationSelection {
  const type = selectedBucket(types, selection.typeId);
  const subtype = type == null ? null : selectedBucket(subtypes, selection.subtypeId);
  const code = subtype == null ? null : selectedBucket(codes, selection.codeId, false);
  return {
    typeId: type?.id ?? null,
    subtypeId: subtype?.id ?? null,
    codeId: code?.id ?? null,
    type,
    subtype,
    code,
  };
}

function buildCurrencyChart(
  currency: string,
  positions: readonly InvestmentAllocationPosition[],
  selection: InvestmentAllocationSelection,
): InvestmentAllocationCurrencyChart | null {
  const types = aggregateBuckets(positions, 'type');
  if (types.length === 0) {
    return null;
  }
  const selectedType = selectedBucket(types, selection.typeId);
  const subtypes =
    selectedType == null
      ? []
      : aggregateBuckets(rowsForType(positions, selectedType.id), 'subtype');
  const resolvedTypeAndSubtype = resolveInvestmentAllocationSelection({
    types,
    subtypes,
    codes: [],
    selection,
  });
  const resolvedType = resolvedTypeAndSubtype.type;
  const resolvedSubtype = resolvedTypeAndSubtype.subtype;
  const codes =
    resolvedType == null || resolvedSubtype == null
      ? []
      : aggregateBuckets(rowsForSubtype(positions, resolvedType.id, resolvedSubtype.id), 'code');
  const resolvedSelection = resolveInvestmentAllocationSelection({
    types,
    subtypes,
    codes,
    selection,
  });
  return { currency, types, subtypes, codes, selection: resolvedSelection };
}

export function buildInvestmentAllocationCurrencyCharts(
  model: InvestmentAllocationModel,
  selections: Readonly<Record<string, InvestmentAllocationSelection>> = {},
): InvestmentAllocationCurrencyChart[] {
  const charts = [...model.positionsByCurrency.entries()]
    .map(([currency, currencyPositions]) =>
      buildCurrencyChart(
        currency,
        currencyPositions,
        selections[currency] ?? {
          typeId: null,
          subtypeId: null,
          codeId: null,
        },
      ),
    )
    .filter((chart): chart is InvestmentAllocationCurrencyChart => chart != null);
  charts.sort((left, right) => left.currency.localeCompare(right.currency));
  return charts;
}
