import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdChevronRight, MdExpandMore } from 'react-icons/md';
import { matchesSearch } from '../../lib/normalize.js';
import { EditIconButton } from '../ui/EditIconButton.js';
import { MaterialIcon } from '../ui/IconPicker.js';
import { CategoryEditDialog } from './CategoryEditDialog.js';
import {
  buildCategoryTree,
  type CategoryNode,
  type CategoryPresentation,
} from './category-tree-build.js';

type CategoryTreeViewProps = {
  readonly byId: Record<string, Record<string, unknown>>;
};

export function CategoryTreeView({ byId }: CategoryTreeViewProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const tree = useMemo(() => buildCategoryTree(byId), [byId]);
  const filteredTree = useMemo(() => {
    if (!query.trim()) {
      return tree;
    }
    return filterTree(tree, query);
  }, [tree, query]);
  const editCategory =
    editId && byId[editId]
      ? {
          id: editId,
          path: String(byId[editId]?.path ?? ''),
          name: String(byId[editId]?.name ?? ''),
          name_translated:
            typeof byId[editId]?.name_translated === 'string' ? byId[editId].name_translated : null,
          label: (byId[editId]?.label as CategoryNode['label']) ?? null,
          presentation: (byId[editId]?.presentation as CategoryPresentation | undefined) ?? {
            name: String(byId[editId]?.name ?? ''),
            icon: 'MdCategory',
            color: '#64748b',
          },
        }
      : null;

  return (
    <div className="space-y-3">
      <input
        type="search"
        className="w-full max-w-md rounded border border-input bg-background px-3 py-1.5 text-sm"
        placeholder={t('filters.searchCategories')}
        aria-label={t('filters.searchCategories')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="rounded-md border border-border">
        {filteredTree.map((node) => (
          <CategoryTreeNode
            key={node.id}
            node={node}
            depth={0}
            collapsed={collapsed}
            onToggle={(id) => {
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                return next;
              });
            }}
            onEdit={setEditId}
          />
        ))}
      </ul>
      <CategoryEditDialog category={editCategory} onClose={() => setEditId(null)} />
    </div>
  );
}

function CategoryTreeNode({
  node,
  depth,
  collapsed,
  onToggle,
  onEdit,
}: {
  readonly node: CategoryNode;
  readonly depth: number;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onEdit: (id: string) => void;
}) {
  const { t } = useTranslation();
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const displayName = node.presentation.name;
  const color = node.presentation.color;
  const icon = node.presentation.icon;

  return (
    <li className="border-b border-border/50 last:border-b-0">
      <div
        className="flex items-center gap-2 py-1.5 pr-2 hover:bg-accent/30"
        style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            aria-label={displayName}
            onClick={() => onToggle(node.id)}
          >
            {isCollapsed ? (
              <MdChevronRight className="size-4" />
            ) : (
              <MdExpandMore className="size-4" />
            )}
          </button>
        ) : (
          <span className="inline-block w-5" />
        )}
        <span
          className="inline-flex rounded p-0.5"
          style={{ color, backgroundColor: `${color}18` }}
        >
          <MaterialIcon name={icon} className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{displayName}</span>
        <span className="truncate text-xs text-muted-foreground">{node.path}</span>
        <EditIconButton label={t('actions.edit')} onClick={() => onEdit(node.id)} />
      </div>
      {hasChildren && !isCollapsed && (
        <ul>
          {node.children.map((child) => (
            <CategoryTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function filterTree(nodes: CategoryNode[], query: string): CategoryNode[] {
  const result: CategoryNode[] = [];
  for (const node of nodes) {
    const childMatches = filterTree(node.children, query);
    const selfMatch =
      matchesSearch(node.path, query) ||
      matchesSearch(node.name, query) ||
      matchesSearch(node.presentation.name, query) ||
      matchesSearch(node.label?.name ?? '', query);
    if (selfMatch || childMatches.length > 0) {
      result.push({ ...node, children: childMatches.length > 0 ? childMatches : node.children });
    }
  }
  return result;
}
