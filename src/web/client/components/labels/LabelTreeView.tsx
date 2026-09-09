import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdChevronRight, MdExpandMore, MdSubdirectoryArrowRight } from 'react-icons/md';
import { matchesSearch } from '../../lib/normalize.js';
import { ActionIconButton, EditIconButton } from '../ui/EditIconButton.js';
import { MaterialIcon } from '../ui/IconPicker.js';
import { LabelEditDialog, type LabelRecord } from './LabelEditDialog.js';
import { buildLabelTree, type LabelNode } from './label-tree-build.js';

export function LabelTreeView({ byId }: { readonly byId: Record<string, LabelRecord> }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [createState, setCreateState] = useState<{ readonly parentId: string | null } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const tree = useMemo(() => buildLabelTree(byId), [byId]);
  const filteredTree = useMemo(() => {
    if (!query.trim()) {
      return tree;
    }
    return filterTree(tree, query);
  }, [tree, query]);
  const editLabel = editId ? (byId[editId] ?? null) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="min-w-[12rem] flex-1 rounded border border-input bg-background px-3 py-1.5 text-sm"
          placeholder={t('filters.searchLabels')}
          aria-label={t('filters.searchLabels')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          onClick={() => setCreateState({ parentId: null })}
        >
          {t('labels.create')}
        </button>
      </div>
      <ul className="rounded-md border border-border">
        {filteredTree.map((node) => (
          <LabelTreeNode
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
            onCreateSub={(parentId) => {
              setCollapsed((prev) => {
                const next = new Set(prev);
                next.delete(parentId);
                return next;
              });
              setCreateState({ parentId });
            }}
          />
        ))}
      </ul>
      <LabelEditDialog label={editLabel} mode="edit" byId={byId} onClose={() => setEditId(null)} />
      {createState && (
        <LabelEditDialog
          label={null}
          mode="create"
          initialParentId={createState.parentId}
          byId={byId}
          onClose={() => setCreateState(null)}
        />
      )}
    </div>
  );
}

function LabelTreeNode({
  node,
  depth,
  collapsed,
  onToggle,
  onEdit,
  onCreateSub,
}: {
  readonly node: LabelNode;
  readonly depth: number;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onEdit: (id: string) => void;
  readonly onCreateSub: (parentId: string) => void;
}) {
  const { t } = useTranslation();
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);

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
            aria-label={node.name}
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
          style={{ color: node.color, backgroundColor: `${node.color}18` }}
        >
          <MaterialIcon name={node.icon} className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{node.name}</span>
        <span className="truncate text-xs text-muted-foreground">{node.path}</span>
        {node.usageCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('labels.usageCount', { count: node.usageCount })}
          </span>
        )}
        <ActionIconButton label={t('labels.createSub')} onClick={() => onCreateSub(node.id)}>
          <MdSubdirectoryArrowRight className="size-4" />
        </ActionIconButton>
        <EditIconButton label={t('actions.edit')} onClick={() => onEdit(node.id)} />
      </div>
      {hasChildren && !isCollapsed && (
        <ul>
          {node.children.map((child) => (
            <LabelTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              onEdit={onEdit}
              onCreateSub={onCreateSub}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function filterTree(nodes: LabelNode[], query: string): LabelNode[] {
  const result: LabelNode[] = [];
  for (const node of nodes) {
    const childMatches = filterTree(node.children, query);
    const selfMatch =
      matchesSearch(node.path, query) ||
      matchesSearch(node.name, query) ||
      matchesSearch(node.id, query);
    if (selfMatch || childMatches.length > 0) {
      result.push({ ...node, children: childMatches.length > 0 ? childMatches : node.children });
    }
  }
  return result;
}
