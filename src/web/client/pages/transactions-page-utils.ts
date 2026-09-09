import type { TransactionRow } from '../components/transactions/transactions-page-types.js';

export function isUnclassifiedTransaction(row: TransactionRow): boolean {
  if (row.category_override_id) {
    return false;
  }
  const annotation = row.annotation;
  if (!annotation) {
    return true;
  }
  return (
    !annotation.categoryId &&
    !annotation.subCategoryId &&
    annotation.labelIds.length === 0 &&
    !annotation.notes?.trim()
  );
}
