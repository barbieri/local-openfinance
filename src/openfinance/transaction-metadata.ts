import { resolveMccName } from '../data/mcc-codes.js';
import { parseAmountToCents, readFieldString, readRecord } from '../openfinance/money.js';

export type ParsedTransactionMerchantDetail = {
  readonly business_name: string | null;
  readonly cnpj: string | null;
  readonly cnae: string | null;
  readonly category: string | null;
};

export type ParsedTransactionCreditCardMetadata = {
  readonly bill_id: string | null;
  readonly purchase_date: string | null;
  readonly purchase_total_cents: number | null;
  readonly payee_mcc: number | null;
  readonly installment_number: number | null;
  readonly total_installments: number | null;
};

export function readCreditCardMetadataRecord(
  record: Record<string, unknown>,
): Record<string, unknown> | null {
  return readRecord(record['creditCardMetadata']);
}

export function parseTransactionCreditCardMetadata(
  rawJson: string | Record<string, unknown>,
): ParsedTransactionCreditCardMetadata {
  const record =
    typeof rawJson === 'string'
      ? (readRecord(JSON.parse(rawJson)) ?? {})
      : (readRecord(rawJson) ?? {});
  const metadata = readCreditCardMetadataRecord(record);
  const installmentNumber = readInteger(metadata?.['installmentNumber']);
  const totalInstallments = readInteger(metadata?.['totalInstallments']);

  return {
    bill_id: readFieldString(metadata ?? {}, 'billId'),
    purchase_date: readFieldString(metadata ?? {}, 'purchaseDate'),
    purchase_total_cents: readCreditAmountCents(metadata, 'totalAmount'),
    payee_mcc: readInteger(metadata?.['payeeMCC']),
    installment_number: installmentNumber,
    total_installments: totalInstallments,
  };
}

export function parseTransactionMerchantDetail(
  record: Record<string, unknown>,
): ParsedTransactionMerchantDetail {
  const merchantRecord = readRecord(record['merchant']);
  const merchantInfo = readRecord(record['merchantInfo']);

  const businessName =
    readFieldString(merchantRecord ?? {}, 'businessName') ??
    readFieldString(merchantInfo ?? {}, 'businessName') ??
    null;
  const cnpj =
    readFieldString(merchantRecord ?? {}, 'cnpj') ??
    readFieldString(merchantInfo ?? {}, 'cnpj') ??
    null;
  const cnae = readFieldString(merchantRecord ?? {}, 'cnae');
  const category = readFieldString(merchantRecord ?? {}, 'category');

  return {
    business_name: businessName,
    cnpj,
    cnae,
    category,
  };
}

export function resolveUpstreamMerchantLabel(record: Record<string, unknown>): string | null {
  const merchantDetail = parseTransactionMerchantDetail(record);
  if (merchantDetail.business_name) {
    return merchantDetail.business_name;
  }

  const merchant = record['merchant'];
  if (typeof merchant === 'string' && merchant.trim().length > 0) {
    return merchant.trim();
  }

  const merchantRecord = readRecord(merchant);
  if (merchantRecord) {
    return (
      readFieldString(merchantRecord, 'name') ??
      readFieldString(merchantRecord, 'businessName') ??
      null
    );
  }

  const merchantInfo = readRecord(record['merchantInfo']);
  if (merchantInfo) {
    return readFieldString(merchantInfo, 'businessName');
  }

  return null;
}

export function resolvePayeeMccName(
  payeeMcc: number | null,
  locale: string | undefined,
  merchantCategory: string | null,
): string | null {
  if (merchantCategory?.trim()) {
    return merchantCategory.trim();
  }
  if (payeeMcc === null) {
    return null;
  }
  return resolveMccName(payeeMcc, locale);
}

function readCreditAmountCents(
  metadata: Record<string, unknown> | null,
  key: string,
): number | null {
  if (!metadata) {
    return null;
  }
  return parseAmountToCents(metadata[key]);
}

function readInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
