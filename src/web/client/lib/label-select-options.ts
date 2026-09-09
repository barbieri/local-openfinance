import type { HierarchicalSelectOption } from './category-select-options.js';
import { indentOptionLabel } from './category-select-options.js';

type LabelRow = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly path?: string;
};

type LabelNode = LabelRow & {
  readonly children: LabelNode[];
};

export function buildAnnotationLabelOptions(rows: readonly LabelRow[]): HierarchicalSelectOption[] {
  const byId = new Map<string, LabelNode>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }
  const roots: LabelNode[] = [];

  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: LabelNode[]): void => {
    nodes.sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name));
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);

  const options: HierarchicalSelectOption[] = [];
  const walk = (nodes: readonly LabelNode[], depth: number): void => {
    for (const node of nodes) {
      options.push({
        value: node.id,
        label: node.path ?? node.name,
        depth,
      });
      walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);
  return options;
}

export function formatLabelOptionLabel(option: HierarchicalSelectOption): string {
  return indentOptionLabel(option);
}
