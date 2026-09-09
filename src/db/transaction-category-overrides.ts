import type { DatabaseSync } from 'node:sqlite';
import { resolveStoredCategorySelectId } from './category-select-id.js';
import { runSql } from './sqlite-query.js';

export function getTransactionCategoryOverride(
  db: DatabaseSync,
  transactionId: string,
): string | null {
  const row = db
    .prepare('SELECT category_id FROM transaction_category_overrides WHERE transaction_id = ?')
    .get(transactionId) as { readonly category_id: string } | undefined;
  return row?.category_id ?? null;
}

export function upsertTransactionCategoryOverride(
  db: DatabaseSync,
  transactionId: string,
  categoryId: string,
): void {
  const storedCategoryId = resolveStoredCategorySelectId(categoryId);
  if (!storedCategoryId) {
    throw new Error('Category override requires a category id');
  }
  const now = new Date().toISOString();
  runSql(
    db,
    `INSERT INTO transaction_category_overrides (transaction_id, category_id, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(transaction_id) DO UPDATE SET
       category_id = excluded.category_id,
       updated_at = excluded.updated_at`,
    transactionId,
    storedCategoryId,
    now,
  );
}

export function clearTransactionCategoryOverride(db: DatabaseSync, transactionId: string): void {
  db.prepare('DELETE FROM transaction_category_overrides WHERE transaction_id = ?').run(
    transactionId,
  );
}
