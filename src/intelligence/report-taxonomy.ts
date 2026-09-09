import type { DatabaseSync } from 'node:sqlite';
import { listAnnotationCategories } from '../annotation/store.js';
import type { AnnotationLabelPresentation } from '../db/annotation-labels.js';
import { buildCategoryIndex } from '../db/category-display.js';
import type { EnrichedTransaction } from '../db/transaction-details.js';

export type ReportTaxonomyKind = 'category' | 'label';

export type ReportTaxonomy = {
  readonly kind: ReportTaxonomyKind;
  readonly id: string;
  readonly path: string;
  readonly depth: number;
};

export type ReportCategoryEntry = {
  readonly id: string;
  readonly path: string;
  readonly ancestorIds: readonly string[];
};

export type ReportTaxonomyIndexes = {
  readonly categories: ReadonlyMap<string, ReportCategoryEntry>;
  readonly labels: ReadonlyMap<string, AnnotationLabelPresentation>;
};

export function transactionTaxonomies(
  row: EnrichedTransaction,
  indexes: ReportTaxonomyIndexes,
): readonly ReportTaxonomy[] {
  const result: ReportTaxonomy[] = [];
  const categoryId =
    row.annotation?.subCategoryId ??
    row.annotation?.categoryId ??
    row.category_override_id ??
    row.category_id;
  if (categoryId) {
    result.push(...categoryLevels(categoryId, indexes.categories));
  }
  for (const label of row.annotation?.labelPresentations ?? []) {
    result.push(...labelLevels(label.id, indexes.labels));
  }
  return uniqueTaxonomies(result);
}

export function categoryLevels(
  id: string,
  index: ReadonlyMap<string, ReportCategoryEntry>,
): readonly ReportTaxonomy[] {
  const entry = index.get(id);
  if (!entry) {
    return [{ kind: 'category', id, path: id, depth: 1 }];
  }
  const ids = [...entry.ancestorIds, id];
  return ids.map((levelId, levelIndex) => {
    const level = index.get(levelId);
    return {
      kind: 'category' as const,
      id: levelId,
      path:
        level?.path ??
        entry.path
          .split(' > ')
          .slice(0, levelIndex + 1)
          .join(' > '),
      depth: levelIndex + 1,
    };
  });
}

export function buildReportCategoryIndex(
  db: DatabaseSync,
  options: { readonly translateNames?: boolean | undefined } = {},
): Map<string, ReportCategoryEntry> {
  const result = new Map<string, ReportCategoryEntry>();
  for (const entry of buildCategoryIndex(db, options).values()) {
    result.set(entry.id, {
      id: entry.id,
      path: entry.path,
      ancestorIds: entry.ancestorIds,
    });
  }

  const local = listAnnotationCategories(db);
  const localById = new Map(local.map((entry) => [entry.id, entry]));
  for (const entry of local) {
    const lineage = resolveLocalCategoryLineage(entry.id, localById);
    result.set(entry.id, {
      id: entry.id,
      path: lineage.map((level) => level.name).join(' > '),
      ancestorIds: lineage.slice(0, -1).map((level) => level.id),
    });
  }
  return result;
}

function resolveLocalCategoryLineage(
  id: string,
  index: ReadonlyMap<string, ReturnType<typeof listAnnotationCategories>[number]>,
): readonly ReturnType<typeof listAnnotationCategories>[number][] {
  const lineage: ReturnType<typeof listAnnotationCategories>[number][] = [];
  const visited = new Set<string>();
  let current = index.get(id);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    lineage.unshift(current);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }
  return lineage;
}

export function labelLevels(
  id: string,
  index: ReadonlyMap<string, AnnotationLabelPresentation>,
): readonly ReportTaxonomy[] {
  const ids: string[] = [];
  const visited = new Set<string>();
  let current = index.get(id);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    ids.unshift(current.id);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }
  if (ids.length === 0) {
    return [{ kind: 'label', id, path: id, depth: 1 }];
  }
  return ids.map((levelId, levelIndex) => {
    const level = index.get(levelId);
    return {
      kind: 'label' as const,
      id: levelId,
      path: level?.path ?? levelId,
      depth: levelIndex + 1,
    };
  });
}

function uniqueTaxonomies(values: readonly ReportTaxonomy[]): readonly ReportTaxonomy[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.kind}:${value.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
