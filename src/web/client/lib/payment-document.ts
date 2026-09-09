export {
  type ParsedPaymentDocuments,
  type PaymentDocument,
  readPaymentDocument,
  readPaymentDocumentsFromRawJson,
} from '../../../openfinance/payment-document.js';

export function formatPaymentDocumentValue(type: string, value: string): string {
  const digits = value.replace(/\D/g, '');
  const normalizedType = type.trim().toUpperCase();

  if (normalizedType === 'CPF' && digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }

  if (normalizedType === 'CNPJ' && digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }

  return value.trim();
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readTransactionCardNumber(
  rawJson: string,
  account?: Record<string, unknown> | null,
): string | null {
  try {
    const record = JSON.parse(rawJson) as Record<string, unknown>;
    const metadata = readRecord(record['creditCardMetadata']);
    const fromMetadata =
      readString(metadata?.['cardNumber']) ?? readString(metadata?.['cardLastFour']);
    if (fromMetadata) {
      return fromMetadata;
    }
    const topLevel = readString(record['cardNumber']);
    if (topLevel) {
      return topLevel;
    }
  } catch {
    // ignore invalid raw_json
  }

  if (account?.['type'] === 'CREDIT') {
    return readString(account['number']);
  }

  return null;
}
