import type { DatabaseSync } from 'node:sqlite';

export class TransactionNotActiveError extends Error {
  readonly transactionIds: readonly string[];

  constructor(transactionIds: readonly string[]) {
    super('Transaction not found');
    this.name = 'TransactionNotActiveError';
    this.transactionIds = transactionIds;
  }
}

export function withActiveTransactionWrite(
  db: DatabaseSync,
  transactionIds: readonly string[],
  write: () => undefined,
): void {
  const uniqueIdSet = new Set<string>();
  for (const transactionId of transactionIds) {
    const normalized = transactionId.trim();
    if (normalized) {
      uniqueIdSet.add(normalized);
    }
  }
  const uniqueIds = [...uniqueIdSet];
  if (uniqueIds.length === 0) {
    throw new TransactionNotActiveError([]);
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT id
         FROM transactions
         WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      )
      .all(...uniqueIds) as Array<{ readonly id: string }>;
    const activeIds = new Set(rows.map((row) => row.id));
    const inactiveIds = uniqueIds.filter((id) => !activeIds.has(id));
    if (inactiveIds.length > 0) {
      throw new TransactionNotActiveError(inactiveIds);
    }

    write();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
