import { formatGroupHeading } from './terminal-format.js';

export function parseGroupByFields<T extends string>(
  value: string | undefined,
  allowedFields: readonly T[],
  defaultFields: readonly T[],
): T[] {
  if (!value || value.trim().length === 0) {
    return [...defaultFields];
  }

  const fields = value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  if (fields.length === 0) {
    return [...defaultFields];
  }

  const allowedFieldSet = new Set(allowedFields);
  const invalid = fields.filter((field) => !allowedFieldSet.has(field as T));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid --group-by field(s): ${invalid.join(', ')}. Allowed: ${allowedFields.join(', ')}`,
    );
  }

  return fields as T[];
}

type GroupNode<T> = {
  readonly key: string;
  readonly label: string;
  readonly children: Map<string, GroupNode<T>>;
  readonly items: readonly T[];
};

type GroupSortEntry = {
  readonly key: string;
  readonly label: string;
};

function collectGroupItems<T>(group: GroupNode<T>): readonly T[] {
  if (group.items.length > 0) {
    return group.items;
  }

  const items: T[] = [];
  for (const child of group.children.values()) {
    items.push(...collectGroupItems(child));
  }

  return items;
}

export function renderGroupedList<T>(options: {
  readonly items: readonly T[];
  readonly groupBy: readonly string[];
  readonly resolveGroupKey: (
    item: T,
    field: string,
  ) => { readonly key: string; readonly label: string };
  readonly formatLine: (item: T, nameWidth: number) => string;
  readonly formatLabel: (item: T) => string;
  readonly hiddenHeaderFields?: readonly string[] | undefined;
  readonly sortGroupChildren?: (
    field: string,
    left: GroupSortEntry,
    right: GroupSortEntry,
  ) => number;
  readonly formatGroupHeader?: (
    field: string,
    label: string,
    items: readonly T[],
    depth: number,
  ) => string;
  readonly emptyMessage: string;
}): string {
  if (options.items.length === 0) {
    return options.emptyMessage;
  }

  const root = buildGroup(options.items, options.groupBy, 0, options.resolveGroupKey);
  const lines: string[] = [];
  renderGroup(root, options.groupBy, 0, lines, options);
  return `${lines.join('\n')}\n`;
}

function buildGroup<T>(
  items: readonly T[],
  groupBy: readonly string[],
  depth: number,
  resolveGroupKey: (item: T, field: string) => { readonly key: string; readonly label: string },
): GroupNode<T> {
  if (depth >= groupBy.length) {
    return {
      key: 'leaf',
      label: 'leaf',
      children: new Map(),
      items,
    };
  }

  const field = groupBy[depth] as string;
  const buckets = new Map<
    string,
    { readonly key: string; readonly label: string; readonly items: T[] }
  >();

  for (const item of items) {
    const { key, label } = resolveGroupKey(item, field);
    const existing = buckets.get(key);
    buckets.set(key, {
      key,
      label,
      items: existing ? [...existing.items, item] : [item],
    });
  }

  const children = new Map<string, GroupNode<T>>();
  for (const bucket of buckets.values()) {
    const nested = buildGroup(bucket.items, groupBy, depth + 1, resolveGroupKey);
    children.set(bucket.key, {
      key: bucket.key,
      label: bucket.label,
      children: nested.children,
      items: nested.items,
    });
  }

  return {
    key: 'root',
    label: 'root',
    children,
    items: [],
  };
}

function renderGroup<T>(
  group: GroupNode<T>,
  groupBy: readonly string[],
  depth: number,
  lines: string[],
  options: {
    readonly groupBy: readonly string[];
    readonly formatLine: (item: T, nameWidth: number) => string;
    readonly formatLabel: (item: T) => string;
    readonly hiddenHeaderFields?: readonly string[] | undefined;
    readonly sortGroupChildren?: (
      field: string,
      left: GroupSortEntry,
      right: GroupSortEntry,
    ) => number;
    readonly formatGroupHeader?: (
      field: string,
      label: string,
      items: readonly T[],
      depth: number,
    ) => string;
  },
): void {
  if (depth >= groupBy.length) {
    const nameWidth = Math.max(8, ...group.items.map((item) => options.formatLabel(item).length));

    for (const item of group.items) {
      lines.push(`${' '.repeat(depth * 2)}${options.formatLine(item, nameWidth)}`);
    }
    return;
  }

  const field = groupBy[depth] as string;
  const hiddenHeaders = new Set(options.hiddenHeaderFields ?? []);
  const sortedChildren = [...group.children.values()];
  sortedChildren.sort((left, right) => {
    if (options.sortGroupChildren) {
      return options.sortGroupChildren(field, left, right);
    }

    return left.label.localeCompare(right.label);
  });

  for (const child of sortedChildren) {
    if (!hiddenHeaders.has(field)) {
      const groupItems = collectGroupItems(child);
      const heading = options.formatGroupHeader
        ? options.formatGroupHeader(field, child.label, groupItems, depth)
        : formatGroupHeading(depth, child.label);
      lines.push(`${' '.repeat(depth * 2)}${heading}`);
    }
    renderGroup(child, groupBy, depth + 1, lines, options);
  }
}
