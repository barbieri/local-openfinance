import type { DatabaseSync } from 'node:sqlite';
import {
  type CategoryPresentation,
  resolveCategoryPresentation,
} from '../openfinance/category-defaults.js';
import { type CategoryLabel, getCategoryLabel } from './category-labels.js';
import type { CategoryRow } from './category-rows.js';
import { loadCategoryRows } from './category-rows.js';

export type { CategoryPresentation } from '../openfinance/category-defaults.js';
export type { CategoryRow } from './category-rows.js';

export type CategoryIndexEntry = CategoryRow & {
  readonly path: string;
  readonly ancestorIds: readonly string[];
  readonly label: CategoryLabel | null;
  readonly presentation: CategoryPresentation;
};

export function resolveUpstreamCategoryDisplayName(
  originalName: string | null,
  translatedName: string | null,
  translate: boolean,
): string | null {
  if (translate) {
    return translatedName ?? originalName;
  }

  return originalName;
}

export type BuildCategoryIndexOptions = {
  readonly translateNames?: boolean | undefined;
};

export function buildCategoryIndex(
  db: DatabaseSync,
  options: BuildCategoryIndexOptions = {},
): Map<string, CategoryIndexEntry> {
  const translateNames = options.translateNames !== false;
  const rows = loadCategoryRows(db);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const index = new Map<string, CategoryIndexEntry>();

  for (const row of rows) {
    const { path, ancestorIds } = resolveCategoryPath(row, byId, translateNames);
    const label = getCategoryLabel(db, row.id);
    index.set(row.id, {
      ...row,
      path,
      ancestorIds,
      label,
      presentation: {
        name:
          label?.name ??
          resolveUpstreamCategoryDisplayName(row.name, row.name_translated, translateNames) ??
          row.name,
        icon: 'MdCategory',
        color: '#64748b',
      },
    });
  }

  for (const id of index.keys()) {
    const entry = index.get(id);
    if (!entry) {
      continue;
    }
    index.set(id, {
      ...entry,
      presentation: resolveCategoryPresentation(id, index, translateNames) ?? entry.presentation,
    });
  }

  return index;
}

export function resolveCategoryPath(
  row: CategoryRow,
  byId: ReadonlyMap<string, CategoryRow>,
  translateNames = true,
): { readonly path: string; readonly ancestorIds: readonly string[] } {
  const segments: string[] = [];
  const ancestorIds: string[] = [];
  let current: CategoryRow | undefined = row;
  const visited = new Set<string>();

  while (current) {
    if (visited.has(current.id)) {
      break;
    }
    visited.add(current.id);

    const displayName =
      resolveUpstreamCategoryDisplayName(current.name, current.name_translated, translateNames) ??
      current.name;
    segments.unshift(displayName);

    if (!current.parent_id) {
      break;
    }

    ancestorIds.unshift(current.parent_id);
    const parent = byId.get(current.parent_id);
    if (parent) {
      current = parent;
      continue;
    }

    if (current.parent_name) {
      segments.unshift(current.parent_name);
    }
    break;
  }

  return {
    path: segments.join(' > '),
    ancestorIds,
  };
}

export function resolveCategoryDisplayLabel(entry: CategoryIndexEntry | undefined): string | null {
  if (!entry) {
    return null;
  }

  if (entry.label?.name) {
    return entry.label.name;
  }

  return entry.path;
}

export function categoryMatchesParentFilter(
  categoryId: string | null,
  parentId: string,
  index: ReadonlyMap<string, CategoryIndexEntry>,
): boolean {
  if (!categoryId) {
    return false;
  }

  if (categoryId === parentId) {
    return true;
  }

  const entry = index.get(categoryId);
  return entry ? entry.ancestorIds.includes(parentId) : false;
}
