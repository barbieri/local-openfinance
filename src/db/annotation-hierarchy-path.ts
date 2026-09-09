export type AnnotationHierarchyPathNode = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
};

export function buildAnnotationHierarchyPathIndex<T extends AnnotationHierarchyPathNode>(
  nodes: readonly T[],
): Map<string, string> {
  const byId = new Map<string, T>(nodes.map((node) => [node.id, node]));
  return new Map(nodes.map((node) => [node.id, resolveAnnotationHierarchyPath(node, byId)]));
}

export function resolveAnnotationHierarchyPath<T extends AnnotationHierarchyPathNode>(
  node: T,
  byId: ReadonlyMap<string, T>,
): string {
  const segments: string[] = [];
  const visited = new Set<string>();
  let current: T | undefined = node;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    segments.unshift(current.name);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }

  return segments.join(' > ');
}
