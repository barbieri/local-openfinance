import type { DatabaseSync } from 'node:sqlite';
import { readRecord } from '../openfinance/money.js';
import {
  extractTransactionDocumentKeys,
  extractTransactionDocumentKeysFromRawJson,
  type TransactionDocumentKeys,
} from '../openfinance/payment-document.js';

export type { TransactionDocumentKeys } from '../openfinance/payment-document.js';

export {
  collectCounterpartyDocumentKeys,
  collectPeerDocumentKeys,
  extractTransactionDocumentKeys,
  extractTransactionDocumentKeysFromRawJson,
  formatDocumentKey,
  formatPaymentDocumentKey,
  resolveStrongSharedPeerDocumentKey,
} from '../openfinance/payment-document.js';

export function resolveTransactionDocumentKeys(
  rawJson: string | Record<string, unknown>,
): TransactionDocumentKeys {
  if (typeof rawJson === 'string') {
    return extractTransactionDocumentKeysFromRawJson(rawJson);
  }
  return extractTransactionDocumentKeys(rawJson);
}

export function updateTransactionDocumentKeys(
  db: DatabaseSync,
  transactionId: string,
  keys: TransactionDocumentKeys,
): void {
  db.prepare(
    `UPDATE transactions
     SET payer_document_key = ?,
         receiver_document_key = ?,
         merchant_document_key = ?
     WHERE id = ?`,
  ).run(keys.payerDocumentKey, keys.receiverDocumentKey, keys.merchantDocumentKey, transactionId);
}

/**
 * Backfill searchable CPF/CNPJ columns from raw_json for rows still missing keys.
 * Safe to run repeatedly: only rows with all three keys NULL are processed.
 */
export function backfillTransactionDocumentKeys(db: DatabaseSync): number {
  const rows = db
    .prepare(
      `SELECT id, raw_json
       FROM transactions
       WHERE payer_document_key IS NULL
         AND receiver_document_key IS NULL
         AND merchant_document_key IS NULL`,
    )
    .all() as { readonly id: string; readonly raw_json: string }[];

  if (rows.length === 0) {
    return 0;
  }

  const update = db.prepare(
    `UPDATE transactions
     SET payer_document_key = ?,
         receiver_document_key = ?,
         merchant_document_key = ?
     WHERE id = ?`,
  );

  let updated = 0;
  for (const row of rows) {
    const record = readRecord(JSON.parse(row.raw_json));
    const keys = record
      ? extractTransactionDocumentKeys(record)
      : { payerDocumentKey: null, receiverDocumentKey: null, merchantDocumentKey: null };
    // Write empty string when no document so the row is not re-selected forever.
    update.run(
      keys.payerDocumentKey ?? '',
      keys.receiverDocumentKey ?? '',
      keys.merchantDocumentKey ?? '',
      row.id,
    );
    updated += 1;
  }

  return updated;
}

/** Normalize stored key: treat blank as null for matching. */
export function normalizeStoredDocumentKey(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
