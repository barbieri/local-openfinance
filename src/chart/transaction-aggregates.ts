import { colorForAmountRank } from './chart-colors.js';

export type ChartCategoryRef = {
  readonly id: string;
  readonly parent_id: string | null;
  readonly name: string;
  readonly color: string;
};

export type ChartLabelRef = {
  readonly id: string;
  readonly parent_id: string | null;
  readonly name: string;
  readonly color: string;
};

export type ChartTransactionRow = {
  readonly amount_cents: number;
  readonly category_id: string | null;
  readonly category_override_id: string | null;
  readonly annotation: {
    readonly labelIds: readonly string[];
  } | null;
};

export type ChartBucket = {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly totalCents: number;
};

const UNCategorized_ID = '__uncategorized__';
const DEFAULT_COLOR = '#64748b';

export const CHART_UNCATEGORIZED_CATEGORY_ID = UNCategorized_ID;

export function resolveEffectiveCategoryId(row: ChartTransactionRow): string | null {
  return row.category_override_id ?? row.category_id;
}

export function resolveRootCategoryId(
  categoryId: string,
  byId: Readonly<Record<string, Pick<ChartCategoryRef, 'parent_id'>>>,
): string {
  let current = categoryId;
  const seen = new Set<string>();

  while (true) {
    if (seen.has(current)) {
      return current;
    }
    seen.add(current);

    const parentId = byId[current]?.parent_id;
    if (!parentId || !byId[parentId]) {
      return current;
    }
    current = parentId;
  }
}

export function isDescendantCategory(
  categoryId: string,
  ancestorId: string,
  byId: Readonly<Record<string, Pick<ChartCategoryRef, 'parent_id'>>>,
): boolean {
  if (categoryId === ancestorId) {
    return true;
  }

  let current = categoryId;
  const seen = new Set<string>();
  while (true) {
    if (seen.has(current)) {
      return false;
    }
    seen.add(current);

    const parentId = byId[current]?.parent_id;
    if (!parentId) {
      return false;
    }
    if (parentId === ancestorId) {
      return true;
    }
    if (!byId[parentId]) {
      return false;
    }
    current = parentId;
  }
}

function absAmountCents(amountCents: number): number {
  return Math.abs(amountCents);
}

function sortBucketsDescending(buckets: ChartBucket[]): ChartBucket[] {
  buckets.sort((left, right) => {
    if (right.totalCents !== left.totalCents) {
      return right.totalCents - left.totalCents;
    }
    return left.name.localeCompare(right.name);
  });
  return buckets;
}

function finalizeBuckets(
  totals: Map<
    string,
    { readonly name: string; readonly color: string; readonly totalCents: number }
  >,
): ChartBucket[] {
  return sortBucketsDescending(
    [...totals.entries()].map(([id, entry]) => ({
      id,
      name: entry.name,
      color: entry.color,
      totalCents: entry.totalCents,
    })),
  ).filter((bucket) => bucket.totalCents > 0);
}

export function aggregateTopLevelCategories(
  rows: readonly ChartTransactionRow[],
  categoryById: Readonly<Record<string, ChartCategoryRef>>,
  uncategorizedName: string,
): ChartBucket[] {
  const totals = new Map<
    string,
    { readonly name: string; readonly color: string; readonly totalCents: number }
  >();

  for (const row of rows) {
    const effectiveId = resolveEffectiveCategoryId(row);
    const amount = absAmountCents(row.amount_cents);
    if (amount === 0) {
      continue;
    }

    if (!effectiveId || !categoryById[effectiveId]) {
      const existing = totals.get(UNCategorized_ID) ?? {
        name: uncategorizedName,
        color: DEFAULT_COLOR,
        totalCents: 0,
      };
      totals.set(UNCategorized_ID, {
        ...existing,
        totalCents: existing.totalCents + amount,
      });
      continue;
    }

    const rootId = resolveRootCategoryId(effectiveId, categoryById);
    const root = categoryById[rootId];
    const existing = totals.get(rootId) ?? {
      name: root?.name ?? rootId,
      color: root?.color ?? DEFAULT_COLOR,
      totalCents: 0,
    };
    totals.set(rootId, {
      ...existing,
      totalCents: existing.totalCents + amount,
    });
  }

  return finalizeBuckets(totals);
}

export function aggregateTopLevelCategoriesFromTotals(
  categoryTotals: Readonly<Record<string, number>>,
  categoryById: Readonly<Record<string, ChartCategoryRef>>,
  uncategorizedName: string,
): ChartBucket[] {
  const totals = new Map<
    string,
    { readonly name: string; readonly color: string; readonly totalCents: number }
  >();

  for (const [categoryId, totalCents] of Object.entries(categoryTotals)) {
    if (totalCents <= 0) {
      continue;
    }

    if (categoryId === UNCategorized_ID) {
      const existing = totals.get(UNCategorized_ID) ?? {
        name: uncategorizedName,
        color: DEFAULT_COLOR,
        totalCents: 0,
      };
      totals.set(UNCategorized_ID, {
        ...existing,
        totalCents: existing.totalCents + totalCents,
      });
      continue;
    }

    if (!categoryById[categoryId]) {
      continue;
    }

    const rootId = resolveRootCategoryId(categoryId, categoryById);
    const root = categoryById[rootId];
    const existing = totals.get(rootId) ?? {
      name: root?.name ?? rootId,
      color: root?.color ?? DEFAULT_COLOR,
      totalCents: 0,
    };
    totals.set(rootId, {
      ...existing,
      totalCents: existing.totalCents + totalCents,
    });
  }

  return finalizeBuckets(totals);
}

export function aggregateCategoryBreakdownFromTotals(
  categoryTotals: Readonly<Record<string, number>>,
  categoryById: Readonly<Record<string, ChartCategoryRef>>,
  rootCategoryId: string,
): ChartBucket[] {
  const root = categoryById[rootCategoryId];
  const baseColor = root?.color ?? DEFAULT_COLOR;
  const buckets: ChartBucket[] = [];

  for (const [categoryId, totalCents] of Object.entries(categoryTotals)) {
    if (totalCents <= 0 || categoryId === UNCategorized_ID || !categoryById[categoryId]) {
      continue;
    }
    if (!isDescendantCategory(categoryId, rootCategoryId, categoryById)) {
      continue;
    }

    const category = categoryById[categoryId];
    buckets.push({
      id: categoryId,
      name: category?.name ?? categoryId,
      color: baseColor,
      totalCents,
    });
  }

  const sorted = sortBucketsDescending(buckets);
  return sorted.map((bucket, index) => ({
    ...bucket,
    color: colorForAmountRank(baseColor, index, sorted.length),
  }));
}

export function aggregateCategoryBreakdown(
  rows: readonly ChartTransactionRow[],
  categoryById: Readonly<Record<string, ChartCategoryRef>>,
  rootCategoryId: string,
): ChartBucket[] {
  const root = categoryById[rootCategoryId];
  const baseColor = root?.color ?? DEFAULT_COLOR;
  const totals = new Map<string, number>();

  for (const row of rows) {
    const effectiveId = resolveEffectiveCategoryId(row);
    if (!effectiveId || !categoryById[effectiveId]) {
      continue;
    }
    if (!isDescendantCategory(effectiveId, rootCategoryId, categoryById)) {
      continue;
    }

    const amount = absAmountCents(row.amount_cents);
    if (amount === 0) {
      continue;
    }

    totals.set(effectiveId, (totals.get(effectiveId) ?? 0) + amount);
  }

  const sorted = sortBucketsDescending(
    [...totals.entries()].map(([id, totalCents]) => {
      const category = categoryById[id];
      return {
        id,
        name: category?.name ?? id,
        color: baseColor,
        totalCents,
      };
    }),
  );

  return sorted.map((bucket, index) => ({
    ...bucket,
    color: colorForAmountRank(baseColor, index, sorted.length),
  }));
}

export function isDescendantLabel(
  labelId: string,
  ancestorId: string,
  byId: Readonly<Record<string, Pick<ChartLabelRef, 'parent_id'>>>,
): boolean {
  return isDescendantCategory(labelId, ancestorId, byId);
}

function resolveDeepestMatchingLabelId(
  labelIds: readonly string[],
  ancestorId: string,
  labelById: Readonly<Record<string, ChartLabelRef>>,
): string | null {
  const matches = labelIds.filter((labelId) => isDescendantLabel(labelId, ancestorId, labelById));
  if (matches.length === 0) {
    return null;
  }

  let deepest: string | null = null;
  let deepestDepth = -1;
  for (const labelId of matches) {
    let depth = 0;
    let current = labelId;
    const seen = new Set<string>();
    while (byIdHasParent(current, labelById)) {
      if (seen.has(current)) {
        break;
      }
      seen.add(current);
      depth += 1;
      const parentId = labelById[current]?.parent_id;
      if (!parentId) {
        break;
      }
      current = parentId;
    }
    if (depth > deepestDepth) {
      deepestDepth = depth;
      deepest = labelId;
    }
  }

  return deepest;
}

function byIdHasParent(
  labelId: string,
  labelById: Readonly<Record<string, ChartLabelRef>>,
): boolean {
  return Boolean(labelById[labelId]?.parent_id);
}

export function aggregateTopLevelLabels(
  rows: readonly ChartTransactionRow[],
  labelById: Readonly<Record<string, ChartLabelRef>>,
): ChartBucket[] {
  const totals = new Map<
    string,
    { readonly name: string; readonly color: string; readonly totalCents: number }
  >();

  for (const row of rows) {
    const amount = absAmountCents(row.amount_cents);
    if (amount === 0) {
      continue;
    }

    const labelIds = row.annotation?.labelIds ?? [];
    const topLevelIds = new Set<string>();
    for (const labelId of labelIds) {
      const rootId = resolveRootCategoryId(labelId, labelById);
      if (labelById[rootId]) {
        topLevelIds.add(rootId);
      }
    }

    for (const rootId of topLevelIds) {
      const label = labelById[rootId];
      if (!label) {
        continue;
      }
      const existing = totals.get(rootId) ?? {
        name: label.name,
        color: label.color,
        totalCents: 0,
      };
      totals.set(rootId, {
        ...existing,
        totalCents: existing.totalCents + amount,
      });
    }
  }

  return finalizeBuckets(totals);
}

export function aggregateTopLevelLabelsFromTotals(
  labelTotals: Readonly<Record<string, number>>,
  labelById: Readonly<Record<string, ChartLabelRef>>,
): ChartBucket[] {
  const totals = new Map<
    string,
    { readonly name: string; readonly color: string; readonly totalCents: number }
  >();

  for (const [labelId, totalCents] of Object.entries(labelTotals)) {
    if (totalCents <= 0 || !labelById[labelId]) {
      continue;
    }

    const rootId = resolveRootCategoryId(labelId, labelById);
    const label = labelById[rootId];
    if (!label) {
      continue;
    }

    const existing = totals.get(rootId) ?? {
      name: label.name,
      color: label.color,
      totalCents: 0,
    };
    totals.set(rootId, {
      ...existing,
      totalCents: existing.totalCents + totalCents,
    });
  }

  return finalizeBuckets(totals);
}

export function aggregateLabelBreakdownFromTotals(
  labelTotals: Readonly<Record<string, number>>,
  labelById: Readonly<Record<string, ChartLabelRef>>,
  rootLabelId: string,
): ChartBucket[] {
  const root = labelById[rootLabelId];
  const baseColor = root?.color ?? DEFAULT_COLOR;
  const buckets: ChartBucket[] = [];

  for (const [labelId, totalCents] of Object.entries(labelTotals)) {
    if (totalCents <= 0 || !labelById[labelId]) {
      continue;
    }
    if (!isDescendantLabel(labelId, rootLabelId, labelById)) {
      continue;
    }

    const label = labelById[labelId];
    buckets.push({
      id: labelId,
      name: label?.name ?? labelId,
      color: baseColor,
      totalCents,
    });
  }

  const sorted = sortBucketsDescending(buckets);
  return sorted.map((bucket, index) => ({
    ...bucket,
    color: colorForAmountRank(baseColor, index, sorted.length),
  }));
}

export function aggregateLabelBreakdown(
  rows: readonly ChartTransactionRow[],
  labelById: Readonly<Record<string, ChartLabelRef>>,
  rootLabelId: string,
): ChartBucket[] {
  const root = labelById[rootLabelId];
  const baseColor = root?.color ?? DEFAULT_COLOR;
  const totals = new Map<string, number>();

  for (const row of rows) {
    const amount = absAmountCents(row.amount_cents);
    if (amount === 0) {
      continue;
    }

    const labelIds = row.annotation?.labelIds ?? [];
    const bucketId = resolveDeepestMatchingLabelId(labelIds, rootLabelId, labelById);
    if (!bucketId) {
      continue;
    }

    totals.set(bucketId, (totals.get(bucketId) ?? 0) + amount);
  }

  const sorted = sortBucketsDescending(
    [...totals.entries()].map(([id, totalCents]) => {
      const label = labelById[id];
      return {
        id,
        name: label?.name ?? id,
        color: baseColor,
        totalCents,
      };
    }),
  );

  return sorted.map((bucket, index) => ({
    ...bucket,
    color: colorForAmountRank(baseColor, index, sorted.length),
  }));
}

export function categoryHasSubcategoryBreakdownFromTotals(
  categoryTotals: Readonly<Record<string, number>>,
  categoryById: Readonly<Record<string, ChartCategoryRef>>,
  rootCategoryId: string,
): boolean {
  const breakdown = aggregateCategoryBreakdownFromTotals(
    categoryTotals,
    categoryById,
    rootCategoryId,
  );
  return breakdown.length > 1 || (breakdown.length === 1 && breakdown[0]?.id !== rootCategoryId);
}

export function labelHasSubLabelBreakdownFromTotals(
  labelTotals: Readonly<Record<string, number>>,
  labelById: Readonly<Record<string, ChartLabelRef>>,
  rootLabelId: string,
): boolean {
  const breakdown = aggregateLabelBreakdownFromTotals(labelTotals, labelById, rootLabelId);
  return breakdown.length > 1 || (breakdown.length === 1 && breakdown[0]?.id !== rootLabelId);
}

export function categoryHasSubcategoryBreakdown(
  rows: readonly ChartTransactionRow[],
  categoryById: Readonly<Record<string, ChartCategoryRef>>,
  rootCategoryId: string,
): boolean {
  const breakdown = aggregateCategoryBreakdown(rows, categoryById, rootCategoryId);
  return breakdown.length > 1 || (breakdown.length === 1 && breakdown[0]?.id !== rootCategoryId);
}

export function labelHasSubLabelBreakdown(
  rows: readonly ChartTransactionRow[],
  labelById: Readonly<Record<string, ChartLabelRef>>,
  rootLabelId: string,
): boolean {
  const breakdown = aggregateLabelBreakdown(rows, labelById, rootLabelId);
  return breakdown.length > 1 || (breakdown.length === 1 && breakdown[0]?.id !== rootLabelId);
}
