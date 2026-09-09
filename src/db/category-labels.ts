import type { DatabaseSync } from 'node:sqlite';

export type CategoryLabel = {
  readonly categoryId: string;
  readonly name: string | null;
  readonly icon: string | null;
  readonly color: string | null;
  readonly nameManual: boolean;
  readonly iconManual: boolean;
  readonly colorManual: boolean;
  readonly updatedAt: string;
};

export type CategoryLabelInput = {
  readonly name?: string | null | undefined;
  readonly icon?: string | null | undefined;
  readonly color?: string | null | undefined;
};

export type CategoryLabelWriteOptions = {
  readonly markManual?: boolean | undefined;
};

export function getCategoryLabel(db: DatabaseSync, categoryId: string): CategoryLabel | null {
  const row = db
    .prepare(
      `SELECT category_id, name, icon, color, name_manual, icon_manual, color_manual, updated_at
       FROM category_labels WHERE category_id = ?`,
    )
    .get(categoryId) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  return mapCategoryLabelRow(row);
}

export function listCategoryLabels(db: DatabaseSync): CategoryLabel[] {
  return db
    .prepare(
      `SELECT category_id, name, icon, color, name_manual, icon_manual, color_manual, updated_at
       FROM category_labels ORDER BY category_id ASC`,
    )
    .all()
    .map((row) => mapCategoryLabelRow(row as Record<string, unknown>));
}

function resolveManualFlags(
  fields: CategoryLabelInput,
  existing: CategoryLabel | null,
  markManual: boolean,
): {
  readonly nameManual: boolean;
  readonly iconManual: boolean;
  readonly colorManual: boolean;
} {
  return {
    nameManual: fields.name !== undefined && markManual ? true : (existing?.nameManual ?? false),
    iconManual: fields.icon !== undefined && markManual ? true : (existing?.iconManual ?? false),
    colorManual: fields.color !== undefined && markManual ? true : (existing?.colorManual ?? false),
  };
}

export function upsertCategoryLabel(
  db: DatabaseSync,
  categoryId: string,
  fields: CategoryLabelInput,
  options: CategoryLabelWriteOptions = { markManual: true },
): CategoryLabel {
  const existing = getCategoryLabel(db, categoryId);
  const now = new Date().toISOString();
  const markManual = options.markManual !== false;

  const name = fields.name !== undefined ? fields.name : (existing?.name ?? null);
  const icon = fields.icon !== undefined ? fields.icon : (existing?.icon ?? null);
  const color = fields.color !== undefined ? fields.color : (existing?.color ?? null);
  const manualFlags = resolveManualFlags(fields, existing, markManual);

  db.prepare(
    `INSERT INTO category_labels (
       category_id, name, icon, color, name_manual, icon_manual, color_manual, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(category_id) DO UPDATE SET
       name = excluded.name,
       icon = excluded.icon,
       color = excluded.color,
       name_manual = excluded.name_manual,
       icon_manual = excluded.icon_manual,
       color_manual = excluded.color_manual,
       updated_at = excluded.updated_at`,
  ).run(
    categoryId,
    name,
    icon,
    color,
    manualFlags.nameManual ? 1 : 0,
    manualFlags.iconManual ? 1 : 0,
    manualFlags.colorManual ? 1 : 0,
    now,
  );

  return getCategoryLabel(db, categoryId) as CategoryLabel;
}

export function applyCategoryDefaultLabel(
  db: DatabaseSync,
  categoryId: string,
  defaults: { readonly icon?: string | undefined; readonly color?: string | undefined },
): boolean {
  if (!defaults.icon && !defaults.color) {
    return false;
  }

  const existing = getCategoryLabel(db, categoryId);
  const fields: {
    icon?: string;
    color?: string;
  } = {};

  if (defaults.icon && !(existing?.iconManual ?? false)) {
    fields.icon = defaults.icon;
  }
  if (defaults.color && !(existing?.colorManual ?? false)) {
    fields.color = defaults.color;
  }

  if (!fields.icon && !fields.color) {
    return false;
  }

  upsertCategoryLabel(db, categoryId, fields, { markManual: false });
  return true;
}

export function deleteCategoryLabel(db: DatabaseSync, categoryId: string): boolean {
  const result = db.prepare(`DELETE FROM category_labels WHERE category_id = ?`).run(categoryId);
  return result.changes > 0;
}

function mapCategoryLabelRow(row: Record<string, unknown>): CategoryLabel {
  return {
    categoryId: String(row['category_id']),
    name: typeof row['name'] === 'string' ? row['name'] : null,
    icon: typeof row['icon'] === 'string' ? row['icon'] : null,
    color: typeof row['color'] === 'string' ? row['color'] : null,
    nameManual: row['name_manual'] === 1,
    iconManual: row['icon_manual'] === 1,
    colorManual: row['color_manual'] === 1,
    updatedAt: String(row['updated_at']),
  };
}
