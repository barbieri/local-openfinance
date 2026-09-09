type LabelHierarchyRow = {
  readonly id: string;
  readonly parentId?: string | null;
  readonly parent_id?: string | null;
};

function resolveParentId(row: LabelHierarchyRow): string | null {
  return row.parentId ?? row.parent_id ?? null;
}

export function collectDescendantLabelIds(
  labelId: string,
  rows: readonly LabelHierarchyRow[],
): readonly string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    const parentId = resolveParentId(row);
    if (!parentId) {
      continue;
    }
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(row.id);
    childrenByParent.set(parentId, siblings);
  }

  const descendants: string[] = [];
  const queue = [...(childrenByParent.get(labelId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) {
      continue;
    }
    descendants.push(id);
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return descendants;
}
