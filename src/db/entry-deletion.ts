import type { DatabaseSync } from 'node:sqlite';

export const DELETED_VISIBILITIES = ['all', 'hide', 'only'] as const;

export type DeletedVisibility = (typeof DELETED_VISIBILITIES)[number];

export type DeletionMetadata = {
  readonly deleted_at: string | null;
  readonly delete_reason: string | null;
};

export type SoftDeleteResult = {
  readonly requestedIds: readonly string[];
  readonly newlyDeletedIds: readonly string[];
  readonly alreadyDeletedIds: readonly string[];
};

export type SoftDeleteTransactionsInput = {
  readonly transactionId: string;
  readonly additionalTransactionIds?: readonly string[] | undefined;
  readonly deleteReason?: string | null | undefined;
  readonly deletedAt?: string | undefined;
};

export type SoftDeleteInvestmentInput = {
  readonly investmentId: string;
  readonly deleteReason?: string | null | undefined;
  readonly deletedAt?: string | undefined;
};

export class SoftDeleteTargetNotFoundError extends Error {
  readonly missingIds: readonly string[];

  constructor(entryType: 'transaction' | 'investment', missingIds: readonly string[]) {
    super(`${entryType === 'transaction' ? 'Transaction' : 'Investment'} not found`);
    this.name = 'SoftDeleteTargetNotFoundError';
    this.missingIds = missingIds;
  }
}

export function normalizeDeleteReason(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function appendDeletedVisibilityPredicate(
  parts: string[],
  qualifiedDeletedAt: `${string}.deleted_at`,
  visibility: DeletedVisibility,
): void {
  if (visibility === 'hide') {
    parts.push(`${qualifiedDeletedAt} IS NULL`);
  }
  if (visibility === 'only') {
    parts.push(`${qualifiedDeletedAt} IS NOT NULL`);
  }
}

export function softDeleteTransactions(
  db: DatabaseSync,
  input: SoftDeleteTransactionsInput,
): SoftDeleteResult {
  return softDeleteEntries(
    db,
    'transactions',
    'transaction',
    [
      requireNonBlankAnchorId('transaction', input.transactionId),
      ...(input.additionalTransactionIds ?? []),
    ],
    input.deleteReason,
    input.deletedAt,
  );
}

export function softDeleteInvestment(
  db: DatabaseSync,
  input: SoftDeleteInvestmentInput,
): SoftDeleteResult {
  return softDeleteEntries(
    db,
    'investments',
    'investment',
    [requireNonBlankAnchorId('investment', input.investmentId)],
    input.deleteReason,
    input.deletedAt,
  );
}

function softDeleteEntries(
  db: DatabaseSync,
  table: 'transactions' | 'investments',
  entryType: 'transaction' | 'investment',
  candidateIds: readonly string[],
  deleteReason: string | null | undefined,
  deletedAt: string | undefined,
): SoftDeleteResult {
  const requestedIds = uniqueNonBlankIds(candidateIds);
  const now = deletedAt ?? new Date().toISOString();
  const reason = normalizeDeleteReason(deleteReason);

  db.exec('BEGIN IMMEDIATE');
  try {
    const rows = db
      .prepare(
        `SELECT id, deleted_at FROM ${table} WHERE id IN (${requestedIds.map(() => '?').join(', ')})`,
      )
      .all(...requestedIds) as Array<{ readonly id: string; readonly deleted_at: string | null }>;
    const foundIds = new Set(rows.map((row) => row.id));
    const missingIds = requestedIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new SoftDeleteTargetNotFoundError(entryType, missingIds);
    }

    const alreadyDeleted = new Set(
      rows.filter((row) => row.deleted_at !== null).map((row) => row.id),
    );
    const alreadyDeletedIds = requestedIds.filter((id) => alreadyDeleted.has(id));
    const update = db.prepare(
      `UPDATE ${table}
       SET deleted_at = ?, delete_reason = ?
       WHERE id = ? AND deleted_at IS NULL`,
    );
    const newlyDeletedIds: string[] = [];
    for (const id of requestedIds) {
      if (update.run(now, reason, id).changes > 0) {
        newlyDeletedIds.push(id);
      }
    }

    db.exec('COMMIT');
    return { requestedIds, newlyDeletedIds, alreadyDeletedIds };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function requireNonBlankAnchorId(
  entryType: 'transaction' | 'investment',
  candidateId: string,
): string {
  const normalized = candidateId.trim();
  if (!normalized) {
    throw new SoftDeleteTargetNotFoundError(entryType, [candidateId]);
  }
  return normalized;
}

function uniqueNonBlankIds(ids: readonly string[]): string[] {
  const uniqueIds = new Set<string>();
  for (const id of ids) {
    const normalized = id.trim();
    if (normalized) {
      uniqueIds.add(normalized);
    }
  }
  return [...uniqueIds];
}
