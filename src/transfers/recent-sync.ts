import type { DatabaseSync } from 'node:sqlite';
import { type DetectTransfersSummary, detectTransferGroups } from './detect.js';
import { DEFAULT_TRANSFER_FEE_TOLERANCE_CENTS, DEFAULT_TRANSFER_WINDOW_HOURS } from './score.js';
import { upsertTransferLinkSuggestion } from './suggestions.js';

export function listRecentSyncTransferCandidateIds(
  db: DatabaseSync,
  syncedAt: string,
): readonly string[] {
  return db
    .prepare(
      `WITH recent AS (
         SELECT MIN(date(occurred_at)) AS first_date
         FROM transactions
         WHERE synced_at = ?
       )
       SELECT id
       FROM transactions
       WHERE synced_at = ?
          OR date(occurred_at) = date((SELECT first_date FROM recent), '-1 day')`,
    )
    .all(syncedAt, syncedAt)
    .map((row) => String((row as Record<string, unknown>)['id']));
}

export function detectRecentSyncedTransfers(
  db: DatabaseSync,
  syncedAt: string,
): Promise<DetectTransfersSummary> {
  return detectTransferGroups(db, {
    windowHours: DEFAULT_TRANSFER_WINDOW_HOURS,
    feeToleranceCents: DEFAULT_TRANSFER_FEE_TOLERANCE_CENTS,
    dryRun: true,
    transactionIds: listRecentSyncTransferCandidateIds(db, syncedAt),
    onProposal: (proposal) => upsertTransferLinkSuggestion(db, proposal),
  });
}
