import type { DatabaseSync } from 'node:sqlite';

export type CompactTransferGroup = {
  readonly id: string;
  readonly kind: string;
  readonly relatedEntryIds: readonly string[];
};

export function lookupTransferGroup(
  db: DatabaseSync,
  entryType: string,
  entryId: string,
): CompactTransferGroup | undefined {
  const groupRow = db
    .prepare(
      `SELECT tg.id, tg.kind
       FROM transfer_groups tg
       JOIN transfer_group_members tgm ON tgm.group_id = tg.id
       WHERE tgm.entry_type = ? AND tgm.entry_id = ?
       LIMIT 1`,
    )
    .get(entryType, entryId) as Record<string, unknown> | undefined;

  if (!groupRow) {
    return undefined;
  }

  const groupId = String(groupRow['id']);
  const members = db
    .prepare(
      `SELECT entry_id FROM transfer_group_members
       WHERE group_id = ? AND NOT (entry_type = ? AND entry_id = ?)`,
    )
    .all(groupId, entryType, entryId) as Record<string, unknown>[];

  return {
    id: groupId,
    kind: String(groupRow['kind']),
    relatedEntryIds: members.map((row) => String(row['entry_id'])),
  };
}

export function loadEntryAnnotationSummary(
  db: DatabaseSync,
  entryType: string,
  entryId: string,
):
  | {
      readonly category: string | undefined;
      readonly subCategory: string | undefined;
      readonly notes: string | undefined;
      readonly labels: readonly string[];
    }
  | undefined {
  const row = db
    .prepare(
      `SELECT ea.notes, c.name AS category_name, sc.name AS sub_category_name
       FROM entry_annotations ea
       LEFT JOIN annotation_categories c ON c.id = ea.category_id
       LEFT JOIN annotation_categories sc ON sc.id = ea.sub_category_id
       WHERE ea.entry_type = ? AND ea.entry_id = ?`,
    )
    .get(entryType, entryId) as Record<string, unknown> | undefined;

  if (!row) {
    return undefined;
  }

  const labels = db
    .prepare(
      `SELECT al.id
       FROM entry_annotation_labels eal
       JOIN annotation_labels al ON al.id = eal.label_id
       JOIN entry_annotations ea ON ea.id = eal.annotation_id
       WHERE ea.entry_type = ? AND ea.entry_id = ?
       ORDER BY al.name ASC`,
    )
    .all(entryType, entryId)
    .map((labelRow) => String((labelRow as Record<string, unknown>)['id']));

  return {
    category: typeof row['category_name'] === 'string' ? row['category_name'] : undefined,
    subCategory:
      typeof row['sub_category_name'] === 'string' ? row['sub_category_name'] : undefined,
    notes: typeof row['notes'] === 'string' ? row['notes'] : undefined,
    labels,
  };
}
