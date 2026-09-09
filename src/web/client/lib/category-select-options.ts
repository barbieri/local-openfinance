import type { CategoryPresentation } from '../components/categories/category-badge-presentation.js';
import {
  buildCategoryTree,
  type CategoryNode,
} from '../components/categories/category-tree-build.js';

export type HierarchicalSelectOption = {
  readonly value: string;
  readonly label: string;
  readonly depth: number;
  readonly presentation?: CategoryPresentation;
};

type TreeItem = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly label?: string | null;
};

export function buildOpenFinanceCategoryOptions(
  byId: Record<string, Record<string, unknown>>,
): HierarchicalSelectOption[] {
  const tree = buildCategoryTree(byId);
  return buildCategoryTreeOptions(tree);
}

export function buildAnnotationCategoryOptions(
  rows: readonly { readonly id: string; readonly name: string; readonly parentId: string | null }[],
): HierarchicalSelectOption[] {
  const byId = new Map<string, TreeItem & { children: TreeItem[] }>();
  for (const row of rows) {
    byId.set(row.id, { ...row, label: row.name, children: [] });
  }
  const roots: (TreeItem & { children: TreeItem[] })[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (nodes: (TreeItem & { children: TreeItem[] })[]): void => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const node of nodes) {
      sortNodes(node.children as (TreeItem & { children: TreeItem[] })[]);
    }
  };
  sortNodes(roots);

  return buildGenericTreeOptions(roots);
}

function buildCategoryTreeOptions(tree: readonly CategoryNode[]): HierarchicalSelectOption[] {
  const options: HierarchicalSelectOption[] = [];
  const walk = (nodes: readonly CategoryNode[], depth: number): void => {
    for (const node of nodes) {
      const label = node.presentation.name;
      const presentation = {
        ...node.presentation,
        path: node.path,
      };
      options.push({ value: node.id, label, depth, presentation });
      if (node.children.length > 0) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(tree, 0);
  return options;
}

function buildGenericTreeOptions(
  nodes: readonly (TreeItem & { children: TreeItem[] })[],
  depth = 0,
  parentPath = '',
): HierarchicalSelectOption[] {
  const options: HierarchicalSelectOption[] = [];
  for (const node of nodes) {
    const label = node.label ?? node.name;
    const path = parentPath ? `${parentPath} > ${label}` : label;
    const presentation = {
      name: label,
      icon: 'MdCategory',
      color: '#64748b',
      path,
    };
    options.push({ value: node.id, label, depth, presentation });
    const children = node.children as (TreeItem & { children: TreeItem[] })[];
    if (children.length > 0) {
      options.push(...buildGenericTreeOptions(children, depth + 1, path));
    }
  }
  return options;
}

export function indentOptionLabel(option: HierarchicalSelectOption): string {
  const prefix = option.depth > 0 ? `${'-'.repeat(option.depth)} ` : '';
  return `${prefix}${option.label}`;
}
