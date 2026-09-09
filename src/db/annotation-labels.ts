import type { DatabaseSync } from 'node:sqlite';
import { buildNestedAnnotationId } from '../annotation/nested-annotation-id.js';
import { resolveAnnotationHierarchyPath } from './annotation-hierarchy-path.js';

export type AnnotationLabelRow = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly icon: string | null;
  readonly color: string | null;
  readonly sortOrder: number | null;
  readonly createdAt: string;
};

export type AnnotationLabelPresentation = {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly path: string;
  readonly parentId: string | null;
};

export type AnnotationLabelResolutionContext = {
  readonly rows: readonly AnnotationLabelRow[];
  readonly index: Map<string, AnnotationLabelPresentation>;
};

const DEFAULT_LABEL_ICON = 'MdLabel';
const DEFAULT_LABEL_COLOR = '#64748b';

export function listAnnotationLabelRows(db: DatabaseSync): AnnotationLabelRow[] {
  return db
    .prepare(
      `SELECT id, name, parent_id, icon, color, sort_order, created_at
       FROM annotation_labels
       ORDER BY COALESCE(sort_order, 999999), name ASC`,
    )
    .all()
    .map(mapAnnotationLabelRow);
}

export function getAnnotationLabelRow(
  db: DatabaseSync,
  labelId: string,
): AnnotationLabelRow | null {
  const row = db
    .prepare(
      `SELECT id, name, parent_id, icon, color, sort_order, created_at
       FROM annotation_labels WHERE id = ?`,
    )
    .get(labelId);
  return row ? mapAnnotationLabelRow(row) : null;
}

export function buildAnnotationLabelIndex(
  db: DatabaseSync,
): Map<string, AnnotationLabelPresentation> {
  return loadAnnotationLabelResolutionContext(db).index;
}

export function loadAnnotationLabelResolutionContext(
  db: DatabaseSync,
): AnnotationLabelResolutionContext {
  const rows = listAnnotationLabelRows(db);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const index = new Map<string, AnnotationLabelPresentation>();

  for (const row of rows) {
    index.set(row.id, resolveAnnotationLabelPresentation(row, byId));
  }

  return { rows, index };
}

export function resolveAnnotationLabelPresentation(
  row: AnnotationLabelRow,
  byId: ReadonlyMap<string, AnnotationLabelRow>,
): AnnotationLabelPresentation {
  return {
    id: row.id,
    name: row.name,
    icon: resolveInheritedLabelIcon(row, byId),
    color: resolveInheritedLabelColor(row, byId),
    path: resolveAnnotationLabelPath(row, byId),
    parentId: row.parentId,
  };
}

export function resolveInheritedLabelIcon(
  row: AnnotationLabelRow,
  byId: ReadonlyMap<string, AnnotationLabelRow>,
): string {
  let current: AnnotationLabelRow | undefined = row;
  const visited = new Set<string>();

  while (current) {
    if (visited.has(current.id)) {
      break;
    }
    visited.add(current.id);
    if (current.icon) {
      return current.icon;
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return DEFAULT_LABEL_ICON;
}

export function resolveInheritedLabelColor(
  row: AnnotationLabelRow,
  byId: ReadonlyMap<string, AnnotationLabelRow>,
): string {
  let current: AnnotationLabelRow | undefined = row;
  const visited = new Set<string>();

  while (current) {
    if (visited.has(current.id)) {
      break;
    }
    visited.add(current.id);
    if (current.color) {
      return current.color;
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return DEFAULT_LABEL_COLOR;
}

export function resolveAnnotationLabelPath(
  row: AnnotationLabelRow,
  byId: ReadonlyMap<string, AnnotationLabelRow>,
): string {
  return resolveAnnotationHierarchyPath(row, byId);
}

export function countAnnotationLabelUsage(db: DatabaseSync, labelId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM entry_annotation_labels WHERE label_id = ?`)
    .get(labelId) as { readonly count: number };
  return Number(row.count);
}

export function countAnnotationLabelChildren(db: DatabaseSync, labelId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM annotation_labels WHERE parent_id = ?`)
    .get(labelId) as { readonly count: number };
  return Number(row.count);
}

export type UpsertAnnotationLabelInput = {
  readonly name: string;
  readonly parentId?: string | null | undefined;
  readonly icon?: string | null | undefined;
  readonly color?: string | null | undefined;
  readonly sortOrder?: number | null | undefined;
};

export function findAnnotationLabelByParentAndName(
  db: DatabaseSync,
  name: string,
  parentId: string | null,
): AnnotationLabelRow | null {
  const row = db
    .prepare(
      `SELECT id, name, parent_id, icon, color, sort_order, created_at
       FROM annotation_labels
       WHERE name = ? AND COALESCE(parent_id, '') = ?`,
    )
    .get(name.trim(), parentId ?? '');
  return row ? mapAnnotationLabelRow(row) : null;
}

export function createAnnotationLabel(
  db: DatabaseSync,
  input: UpsertAnnotationLabelInput,
): AnnotationLabelRow {
  const trimmed = input.name.trim();
  const parentId = input.parentId ?? null;
  const existing = findAnnotationLabelByParentAndName(db, trimmed, parentId);
  if (existing) {
    throw new Error(`Label "${trimmed}" already exists under this parent`);
  }

  const id = buildNestedAnnotationId(trimmed, parentId);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO annotation_labels (id, name, parent_id, icon, color, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name.trim(),
    input.parentId ?? null,
    input.icon ?? null,
    input.color ?? null,
    input.sortOrder ?? null,
    now,
  );
  const created = getAnnotationLabelRow(db, id);
  if (!created) {
    throw new Error(`Failed to create annotation label ${id}`);
  }
  return created;
}

export function updateAnnotationLabel(
  db: DatabaseSync,
  labelId: string,
  input: UpsertAnnotationLabelInput,
): AnnotationLabelRow {
  if (input.parentId === labelId) {
    throw new Error('Label cannot be its own parent');
  }
  db.prepare(
    `UPDATE annotation_labels
     SET name = ?, parent_id = ?, icon = ?, color = ?, sort_order = ?
     WHERE id = ?`,
  ).run(
    input.name.trim(),
    input.parentId ?? null,
    input.icon ?? null,
    input.color ?? null,
    input.sortOrder ?? null,
    labelId,
  );
  const updated = getAnnotationLabelRow(db, labelId);
  if (!updated) {
    throw new Error(`Annotation label not found: ${labelId}`);
  }
  return updated;
}

export function deleteAnnotationLabel(db: DatabaseSync, labelId: string): void {
  if (countAnnotationLabelUsage(db, labelId) > 0) {
    throw new Error('Cannot delete a label that is assigned to transactions');
  }
  if (countAnnotationLabelChildren(db, labelId) > 0) {
    throw new Error('Cannot delete a label that has child labels');
  }
  db.prepare(`DELETE FROM annotation_labels WHERE id = ?`).run(labelId);
}

function mapAnnotationLabelRow(row: unknown): AnnotationLabelRow {
  const record = row as Record<string, unknown>;
  return {
    id: String(record['id']),
    name: String(record['name']),
    parentId: typeof record['parent_id'] === 'string' ? record['parent_id'] : null,
    icon: typeof record['icon'] === 'string' ? record['icon'] : null,
    color: typeof record['color'] === 'string' ? record['color'] : null,
    sortOrder:
      typeof record['sort_order'] === 'number' && Number.isFinite(record['sort_order'])
        ? record['sort_order']
        : null,
    createdAt: String(record['created_at']),
  };
}
