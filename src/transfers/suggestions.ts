import type { DatabaseSync } from 'node:sqlite';
import type { TransferPairProposal } from './detect.js';

export function upsertTransferLinkSuggestion(
  db: DatabaseSync,
  proposal: TransferPairProposal,
): void {
  db.prepare(
    `INSERT INTO transfer_link_suggestions (
       source_entry_id, destination_entry_id, kind, confidence,
       amount_confidence, time_confidence, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_entry_id, destination_entry_id) DO UPDATE SET
       kind = excluded.kind,
       confidence = excluded.confidence,
       amount_confidence = excluded.amount_confidence,
       time_confidence = excluded.time_confidence,
       created_at = excluded.created_at`,
  ).run(
    proposal.source.id,
    proposal.destination.id,
    proposal.kind,
    proposal.confidence,
    proposal.amountConfidence,
    proposal.timeConfidence,
    new Date().toISOString(),
  );
}
