export type CategoryPresentation = {
  readonly name: string;
  readonly icon: string;
  readonly color: string;
};

export type CategoryNode = {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly name_translated: string | null;
  readonly parent_id: string | null;
  readonly label: {
    readonly name?: string;
    readonly icon?: string;
    readonly color?: string;
    readonly nameManual?: boolean;
    readonly iconManual?: boolean;
    readonly colorManual?: boolean;
  } | null;
  readonly presentation: CategoryPresentation;
  readonly children: CategoryNode[];
};

export function buildCategoryTree(byId: Record<string, Record<string, unknown>>): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();

  for (const raw of Object.values(byId)) {
    const presentation = (raw['presentation'] as CategoryPresentation | undefined) ?? {
      name: String(raw['name_translated'] ?? raw['name'] ?? ''),
      icon: 'MdCategory',
      color: '#64748b',
    };
    nodes.set(String(raw['id']), {
      id: String(raw['id']),
      path: String(raw['path'] ?? raw['name'] ?? raw['id']),
      name: String(raw['name'] ?? ''),
      name_translated: typeof raw['name_translated'] === 'string' ? raw['name_translated'] : null,
      parent_id: typeof raw['parent_id'] === 'string' ? raw['parent_id'] : null,
      label: (raw['label'] as CategoryNode['label']) ?? null,
      presentation,
      children: [],
    });
  }

  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    if (node.parent_id && nodes.has(node.parent_id)) {
      nodes.get(node.parent_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (list: CategoryNode[]): void => {
    list.sort((a, b) => a.path.localeCompare(b.path));
    for (const n of list) {
      sortNodes(n.children);
    }
  };
  sortNodes(roots);
  return roots;
}
