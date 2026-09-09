import type { LabelRecord } from './LabelEditDialog.js';

export type LabelNode = LabelRecord & {
  readonly children: LabelNode[];
};

export function buildLabelTree(byId: Record<string, LabelRecord>): LabelNode[] {
  const nodes = new Map<string, LabelNode>();
  for (const raw of Object.values(byId)) {
    nodes.set(raw.id, { ...raw, children: [] });
  }

  const roots: LabelNode[] = [];
  for (const node of nodes.values()) {
    if (node.parent_id && nodes.has(node.parent_id)) {
      nodes.get(node.parent_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (list: LabelNode[]): void => {
    list.sort((a, b) => a.path.localeCompare(b.path));
    for (const node of list) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);
  return roots;
}
