import type { DatabaseSync } from 'node:sqlite';
import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../../schemas/openfinance-category-defaults.schema.json' with { type: 'json' };
import categoryDefaultsDocument from '../data/openfinance-category-defaults.json' with {
  type: 'json',
};
import { applyCategoryDefaultLabel, type CategoryLabel } from '../db/category-labels.js';
import { loadCategoryRows } from '../db/category-rows.js';

export type CategoryDefaultEntry = {
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
};

export type CategoryDefaultsDocument = {
  readonly version: number;
  readonly categories: Readonly<Record<string, CategoryDefaultEntry>>;
};

const ajv = new Ajv2020({ allErrors: true });
const validateDefaults = ajv.compile(schema);

let cachedDefaults: CategoryDefaultsDocument | null = null;

export function loadOpenFinanceCategoryDefaults(): CategoryDefaultsDocument {
  if (cachedDefaults) {
    return cachedDefaults;
  }

  if (!validateDefaults(categoryDefaultsDocument)) {
    throw new Error(
      `Invalid openfinance-category-defaults.json: ${ajv.errorsText(validateDefaults.errors)}`,
    );
  }

  cachedDefaults = categoryDefaultsDocument as CategoryDefaultsDocument;
  return cachedDefaults;
}

export function applyOpenFinanceCategoryDefaults(db: DatabaseSync): number {
  const defaults = loadOpenFinanceCategoryDefaults();
  let applied = 0;

  for (const row of loadCategoryRows(db)) {
    const entry = defaults.categories[row.name];
    if (!entry) {
      continue;
    }

    const updated = applyCategoryDefaultLabel(db, row.id, entry);
    if (updated) {
      applied += 1;
    }
  }

  return applied;
}

export function listCategoryDefaultNames(): readonly string[] {
  return Object.keys(loadOpenFinanceCategoryDefaults().categories);
}

export type CategoryPresentation = {
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly path?: string;
};

function resolveCategoryDisplayName(
  entry: {
    readonly name: string;
    readonly name_translated: string | null;
    readonly label: CategoryLabel | null;
  },
  translateNames: boolean,
): string {
  if (entry.label?.name) {
    return entry.label.name;
  }
  if (translateNames) {
    return entry.name_translated ?? entry.name;
  }
  return entry.name;
}

export function resolveCategoryPresentation(
  categoryId: string,
  byId: ReadonlyMap<
    string,
    {
      readonly id: string;
      readonly name: string;
      readonly name_translated: string | null;
      readonly parent_id: string | null;
      readonly label: CategoryLabel | null;
    }
  >,
  translateNames = true,
): CategoryPresentation | null {
  const entry = byId.get(categoryId);
  if (!entry) {
    return null;
  }

  const chain = collectCategoryChain(entry, byId);
  const name = resolveCategoryDisplayName(entry, translateNames);
  const { icon, color } = resolveInheritedCategoryStyle(chain);

  return {
    name,
    icon: icon ?? 'MdCategory',
    color: color ?? '#64748b',
  };
}

function resolveInheritedCategoryStyle(
  chain: readonly { readonly label: CategoryLabel | null }[],
): { readonly icon: string | null; readonly color: string | null } {
  let icon: string | null = null;
  let color: string | null = null;

  for (const node of chain) {
    if (!icon && node.label?.icon) {
      icon = node.label.icon;
    }
    if (!color && node.label?.color) {
      color = node.label.color;
    }
    if (icon && color) {
      break;
    }
  }

  return { icon, color };
}

function collectCategoryChain(
  entry: {
    readonly id: string;
    readonly parent_id: string | null;
    readonly label: CategoryLabel | null;
  },
  byId: ReadonlyMap<
    string,
    {
      readonly id: string;
      readonly parent_id: string | null;
      readonly label: CategoryLabel | null;
    }
  >,
): Array<{ readonly label: CategoryLabel | null }> {
  const chain: Array<{ readonly label: CategoryLabel | null }> = [{ label: entry.label }];
  let parentId = entry.parent_id;
  const visited = new Set<string>([entry.id]);

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) {
      break;
    }
    chain.push({ label: parent.label });
    parentId = parent.parent_id;
  }

  return chain;
}
