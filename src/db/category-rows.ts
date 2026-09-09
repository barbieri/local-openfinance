import type { DatabaseSync } from 'node:sqlite';

export type CategoryRow = {
  readonly id: string;
  readonly name: string;
  readonly name_translated: string | null;
  readonly parent_id: string | null;
  readonly parent_name: string | null;
};

export function loadCategoryRows(db: DatabaseSync): CategoryRow[] {
  return db
    .prepare(
      `SELECT id, name, name_translated, parent_id, parent_name FROM categories ORDER BY name ASC`,
    )
    .all()
    .map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: String(record['id']),
        name: String(record['name']),
        name_translated:
          typeof record['name_translated'] === 'string' ? record['name_translated'] : null,
        parent_id: typeof record['parent_id'] === 'string' ? record['parent_id'] : null,
        parent_name: typeof record['parent_name'] === 'string' ? record['parent_name'] : null,
      };
    });
}
