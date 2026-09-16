import type { TransactionColumnKey } from '../components/transactions/transactions-page-column-keys.js';

export function resolveTransactionVisibleColumns(
  visibleColumns: ReadonlySet<TransactionColumnKey>,
  filters: Readonly<Record<string, string | string[]>>,
): Set<TransactionColumnKey> {
  const hiddenColumns = new Set<TransactionColumnKey>();
  if (filters['transfers'] === 'hide') {
    hiddenColumns.add('transfer');
  }
  if (filters['installments'] === 'hide') {
    hiddenColumns.add('installments');
  }

  const visible = new Set<TransactionColumnKey>();
  for (const key of visibleColumns) {
    if (!hiddenColumns.has(key)) {
      visible.add(key);
    }
  }
  if (visible.size === 0) {
    visible.add('select');
  }
  return visible;
}
