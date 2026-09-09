import type { DatabaseSync } from 'node:sqlite';
import { buildNestedAnnotationId } from './nested-annotation-id.js';

export function insertAnnotationLabelRecord(
  db: DatabaseSync,
  name: string,
  parentId: string | null,
): string {
  const id = buildNestedAnnotationId(name, parentId);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO annotation_labels (id, name, parent_id, icon, color, created_at)
     VALUES (?, ?, ?, 'MdLabel', '#64748b', ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       parent_id = excluded.parent_id`,
  ).run(id, name, parentId, now);
  return id;
}
