import type { LabelPresentation } from '../components/labels/LabelBadge.js';
import type { LabelRecord } from '../components/labels/LabelEditDialog.js';

export type FilterMultiSelectItem = {
  readonly id: string;
  readonly parentId: string | null;
  readonly path: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
};

export function buildLabelFilterItems(
  byId: Record<string, LabelRecord>,
): readonly FilterMultiSelectItem[] {
  return Object.values(byId).map((row) => ({
    id: row.id,
    parentId: row.parent_id ?? null,
    path: row.path,
    name: row.name,
    icon: row.icon,
    color: row.color,
  }));
}

function resolveAccountFilterIcon(type: string): string {
  if (type === 'CREDIT') {
    return 'MdCreditCard';
  }
  if (type === 'BANK') {
    return 'MdAccountBalance';
  }
  return 'MdAccountBalanceWallet';
}

function resolveAccountFilterColor(type: string): string {
  if (type === 'CREDIT') {
    return '#2563eb';
  }
  if (type === 'BANK') {
    return '#059669';
  }
  return '#64748b';
}

export function buildAccountFilterItems(
  accounts: readonly Record<string, unknown>[],
): readonly FilterMultiSelectItem[] {
  return accounts.map((account) => {
    const type = String(account['type'] ?? '');
    const subtype = typeof account['subtype'] === 'string' ? account['subtype'] : null;
    const name = String(account['display_name'] ?? account['name'] ?? account['id']);
    const typeLabel = subtype ? `${type}/${subtype}` : type;
    return {
      id: String(account['id']),
      parentId: null,
      path: typeLabel.length > 0 ? `${name} · ${typeLabel}` : name,
      name,
      icon: resolveAccountFilterIcon(type),
      color: resolveAccountFilterColor(type),
    };
  });
}

export function buildCategoryFilterItems(
  byId: Record<string, Record<string, unknown>>,
): readonly FilterMultiSelectItem[] {
  return Object.values(byId).map((raw) => {
    const presentation = raw['presentation'] as
      | { readonly name: string; readonly icon: string; readonly color: string }
      | undefined;
    return {
      id: String(raw['id']),
      parentId: typeof raw['parent_id'] === 'string' ? raw['parent_id'] : null,
      path: String(raw['path'] ?? presentation?.name ?? raw['id']),
      name: presentation?.name ?? String(raw['name_translated'] ?? raw['name'] ?? raw['id']),
      icon: presentation?.icon ?? 'MdCategory',
      color: presentation?.color ?? '#64748b',
    };
  });
}

export function toLabelPresentation(item: FilterMultiSelectItem): LabelPresentation {
  return {
    id: item.id,
    name: item.name,
    icon: item.icon,
    color: item.color,
    path: item.path,
  };
}
