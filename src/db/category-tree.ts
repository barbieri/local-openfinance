export type CategoryTreeNode = {
  readonly id: string;
  readonly path: string;
  readonly children: CategoryTreeNode[];
};

export type CategoryTreeSource = {
  readonly id: string;
  readonly parent_id: string | null;
  readonly path: string;
};

export function buildCategoryTree(entries: Iterable<CategoryTreeSource>): CategoryTreeNode[] {
  const nodes = new Map<string, CategoryTreeNode>();

  for (const entry of entries) {
    nodes.set(entry.id, { id: entry.id, path: entry.path, children: [] });
  }

  const roots: CategoryTreeNode[] = [];
  for (const entry of entries) {
    const node = nodes.get(entry.id);
    if (!node) {
      continue;
    }
    if (entry.parent_id && nodes.has(entry.parent_id)) {
      nodes.get(entry.parent_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
