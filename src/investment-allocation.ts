export const INVESTMENT_ALLOCATION_DIMENSIONS = ['type', 'subtype', 'code'] as const;

export type InvestmentAllocationDimension = (typeof INVESTMENT_ALLOCATION_DIMENSIONS)[number];

export type InvestmentAllocationPosition = {
  readonly id: string;
  readonly currency: string;
  readonly type: string | null;
  readonly subtype: string | null;
  readonly code: string | null;
  readonly displayName: string | null;
  readonly cents: number;
};

export type InvestmentAllocationBucket = {
  readonly id: string;
  readonly label: string;
  readonly cents: number;
  readonly count: number;
};

const UNKNOWN = 'Unknown';

function readableValue(value: string | null, fallback: string): string {
  return value ?? fallback;
}

export function investmentAllocationBucketIdentity(
  position: InvestmentAllocationPosition,
  dimension: InvestmentAllocationDimension,
): Pick<InvestmentAllocationBucket, 'id' | 'label'> {
  const type = readableValue(position.type, UNKNOWN);
  const subtype = `${type} / ${readableValue(position.subtype, UNKNOWN)}`;
  if (dimension === 'type') return { id: type, label: type };
  if (dimension === 'subtype') return { id: subtype, label: subtype };
  const codeIdentity =
    position.code === null ? `investment:${position.id}` : `code:${position.code}`;
  return {
    id: `${subtype} / ${codeIdentity}`,
    label: position.code ?? readableValue(position.displayName, position.id),
  };
}

export function investmentAllocationCents(position: InvestmentAllocationPosition): number {
  return Number.isFinite(position.cents) ? Math.abs(position.cents) : 0;
}

export function aggregateInvestmentAllocationBuckets(
  positions: readonly InvestmentAllocationPosition[],
  dimension: InvestmentAllocationDimension,
): readonly InvestmentAllocationBucket[] {
  const totals = new Map<string, InvestmentAllocationBucket>();
  for (const position of positions) {
    const cents = investmentAllocationCents(position);
    if (cents <= 0) continue;
    const bucket = investmentAllocationBucketIdentity(position, dimension);
    const previous = totals.get(bucket.id);
    totals.set(bucket.id, {
      ...bucket,
      cents: cents + (previous?.cents ?? 0),
      count: 1 + (previous?.count ?? 0),
    });
  }
  return [...totals.values()].toSorted(compareInvestmentAllocationBuckets);
}

export function compareInvestmentAllocationBuckets(
  left: InvestmentAllocationBucket,
  right: InvestmentAllocationBucket,
): number {
  return (
    right.cents - left.cents ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id)
  );
}
