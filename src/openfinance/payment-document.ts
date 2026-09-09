import type { PeerDocumentKeys } from '../peer-policy.js';
import { readFieldString, readRecord } from './money.js';
import { parseTransactionMerchantDetail } from './transaction-metadata.js';

export type {
  StrongPeerAmountSign,
  StrongPeerCandidateField,
  StrongPeerDocumentField,
  StrongPeerPolicyTerm,
} from '../peer-policy.js';
export {
  createStrongPeerPolicy,
  resolveStrongSharedPeerDocumentKey,
} from '../peer-policy.js';

export type PaymentDocument = {
  readonly type: string;
  readonly value: string;
};

export type ParsedPaymentDocuments = {
  readonly payer: PaymentDocument | null;
  readonly receiver: PaymentDocument | null;
  readonly receiverName: string | null;
};

export type TransactionDocumentKeys = PeerDocumentKeys;

export function normalizeDocumentDigits(value: string): string {
  return value.replace(/\D/gu, '');
}

/**
 * Build a stable searchable document key: lowercase type + digits-only value.
 * Returns null when type or digits are missing (e.g. installment noise like "DISTRIBUIDOR02").
 */
export function formatDocumentKey(type: string, value: string): string | null {
  const normalizedType = type.trim().toLowerCase();
  const digits = normalizeDocumentDigits(value);
  if (!normalizedType || digits.length < 8) {
    return null;
  }
  return `${normalizedType}:${digits}`;
}

export function formatPaymentDocumentKey(document: PaymentDocument | null): string | null {
  if (!document) {
    return null;
  }
  return formatDocumentKey(document.type, document.value);
}

export function readPaymentDocument(value: unknown): PaymentDocument | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const nested = readRecord(record['documentNumber']);
  const type =
    readFieldString(record, 'type') ??
    readFieldString(record, 'documentType') ??
    readFieldString(nested ?? {}, 'type') ??
    readFieldString(nested ?? {}, 'documentType');
  const rawValue =
    readFieldString(record, 'value') ??
    readFieldString(record, 'documentNumber') ??
    readFieldString(nested ?? {}, 'value');

  if (!type || !rawValue) {
    return null;
  }

  return { type, value: rawValue };
}

export function readPaymentReceiverName(
  paymentData: Record<string, unknown> | null,
): string | null {
  if (!paymentData) {
    return null;
  }
  return readFieldString(paymentData, 'receiver');
}

export function readPaymentDocumentsFromRecord(
  record: Record<string, unknown>,
): ParsedPaymentDocuments {
  const paymentData = readRecord(record['paymentData']);
  if (!paymentData) {
    return { payer: null, receiver: null, receiverName: null };
  }

  const receiverField = paymentData['receiver'];
  const receiverDocument =
    receiverField !== undefined && typeof receiverField !== 'string'
      ? readPaymentDocument(receiverField)
      : null;

  return {
    payer: readPaymentDocument(paymentData['payer']),
    receiver: receiverDocument,
    receiverName: readPaymentReceiverName(paymentData),
  };
}

export function readPaymentDocumentsFromRawJson(rawJson: string): ParsedPaymentDocuments {
  try {
    const record = JSON.parse(rawJson) as Record<string, unknown>;
    return readPaymentDocumentsFromRecord(record);
  } catch {
    return { payer: null, receiver: null, receiverName: null };
  }
}

export function extractTransactionDocumentKeys(
  record: Record<string, unknown>,
): TransactionDocumentKeys {
  const paymentDocuments = readPaymentDocumentsFromRecord(record);
  const merchantDetail = parseTransactionMerchantDetail(record);
  return {
    payerDocumentKey: formatPaymentDocumentKey(paymentDocuments.payer),
    receiverDocumentKey: formatPaymentDocumentKey(paymentDocuments.receiver),
    merchantDocumentKey: merchantDetail.cnpj
      ? formatDocumentKey('CNPJ', merchantDetail.cnpj)
      : null,
  };
}

export function extractTransactionDocumentKeysFromRawJson(
  rawJson: string,
): TransactionDocumentKeys {
  try {
    const record = JSON.parse(rawJson) as Record<string, unknown>;
    return extractTransactionDocumentKeys(record);
  } catch {
    return { payerDocumentKey: null, receiverDocumentKey: null, merchantDocumentKey: null };
  }
}

function uniqueDocumentKeys(values: readonly (string | null | undefined)[]): readonly string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

/** All non-null document keys (payer + receiver + merchant). Prefer counterparty keys for matching. */
export function collectPeerDocumentKeys(keys: TransactionDocumentKeys): readonly string[] {
  return uniqueDocumentKeys([
    keys.payerDocumentKey,
    keys.receiverDocumentKey,
    keys.merchantDocumentKey,
  ]);
}

/**
 * Keys that identify the other party for a given flow direction.
 * Merchant is always included when present.
 * - debit (amount < 0): receiver is the counterparty; payer is usually the account holder
 * - credit (amount > 0): payer is the counterparty; receiver is usually the account holder
 * - zero: merchant only
 *
 * Used only to decide whether a shared document is a *strong* peer signal — storage and
 * feature text still keep payer + receiver + merchant.
 */
export function collectCounterpartyDocumentKeys(
  keys: TransactionDocumentKeys,
  amountCents: number,
): readonly string[] {
  if (amountCents < 0) {
    return uniqueDocumentKeys([keys.merchantDocumentKey, keys.receiverDocumentKey]);
  }
  if (amountCents > 0) {
    return uniqueDocumentKeys([keys.merchantDocumentKey, keys.payerDocumentKey]);
  }
  return uniqueDocumentKeys([keys.merchantDocumentKey]);
}
