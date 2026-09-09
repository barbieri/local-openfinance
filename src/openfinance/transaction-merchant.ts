import { readFieldString, readRecord, readString } from './money.js';
import { resolveUpstreamMerchantLabel } from './transaction-metadata.js';

export type ResolvedTransactionText = {
  readonly merchantName: string | null;
  readonly description: string | null;
};

/** Merchant object from upstream Open Finance / Pluggy transaction payloads. */
export function readTransactionMerchant(record: Record<string, unknown>): string | null {
  const upstream = resolveUpstreamMerchantLabel(record);
  if (upstream) {
    return upstream;
  }

  const merchant = record['merchant'];
  if (typeof merchant === 'string') {
    return readString(merchant);
  }

  const merchantRecord = readRecord(merchant);
  if (!merchantRecord) {
    return null;
  }

  return readFieldString(merchantRecord, 'name') ?? readFieldString(merchantRecord, 'businessName');
}

export function resolveTransactionMerchantAndDescription(
  record: Record<string, unknown>,
): ResolvedTransactionText {
  const rawDescription = readFieldString(record, 'description');
  const paymentData = readRecord(record['paymentData']);
  const creditCardMetadata = readRecord(record['creditCardMetadata']);

  const rawMerchantName = readTransactionMerchant(record);
  if (rawMerchantName) {
    return {
      merchantName: normalizeMerchantName(rawMerchantName, creditCardMetadata),
      description: rawDescription,
    };
  }

  const pixParsed =
    parseSicoobPixEmitido(rawDescription) ??
    parseSicoobPixRecebido(rawDescription) ??
    parseItauPixEnviado(rawDescription, paymentData) ??
    parseItauPixQrCode(rawDescription, paymentData);
  if (pixParsed) {
    return pixParsed;
  }

  const merchantName = normalizeMerchantName(
    readFieldString(paymentData ?? {}, 'receiver') ?? rawDescription,
    creditCardMetadata,
  );

  return {
    merchantName,
    description: rawDescription,
  };
}

function normalizeMerchantName(
  merchantName: string | null,
  creditCardMetadata: Record<string, unknown> | null,
): string | null {
  if (!merchantName) {
    return null;
  }

  if (creditCardMetadata) {
    return stripCreditCardInstallmentSuffix(merchantName, creditCardMetadata) || null;
  }

  return stripTrailingInstallmentPattern(merchantName) || null;
}

/** Strip trailing installment markers such as `01/06` from credit-card descriptions. */
export function stripTrailingInstallmentPattern(text: string): string {
  return text.replace(/0?\d{1,2}\/\d{1,2}\s*$/u, '').trim();
}

/** Sicoob outbound PIX: pipe-delimited description encodes counterparty CPF and free-text details. */
function parseSicoobPixEmitido(description: string | null): ResolvedTransactionText | null {
  const prefix = 'PIX EMITIDO OUTRA IF - Pagamento Pix|';
  if (!description?.startsWith(prefix)) {
    return null;
  }

  const parts = description.split('|');
  const merchantName = stripAtPrefix(parts[1] ?? '');
  const parsedParts: string[] = [];
  for (const part of parts.slice(2)) {
    const stripped = stripAtPrefix(part);
    if (stripped.length > 0) {
      parsedParts.push(stripped);
    }
  }
  const parsedDescription = parsedParts.join('');

  return {
    merchantName: merchantName || null,
    description: parsedDescription || description,
  };
}

/** Sicoob inbound PIX: pipe-delimited description encodes payer name, masked CPF, and memo text. */
function parseSicoobPixRecebido(description: string | null): ResolvedTransactionText | null {
  const prefix = 'PIX RECEBIDO - OUTRA IF - Recebimento Pix|';
  if (!description?.startsWith(prefix)) {
    return null;
  }

  const parts = description.split('|');
  const receiverName = stripAtPrefix(parts[1] ?? '');
  const maskedCpf = stripAtPrefix(parts[2] ?? '');
  const merchantName =
    receiverName && maskedCpf
      ? `${receiverName} (${maskedCpf})`
      : receiverName || maskedCpf || null;
  const parsedParts: string[] = [];
  for (const part of parts.slice(3)) {
    const stripped = stripAtPrefix(part);
    if (stripped.length > 0) {
      parsedParts.push(stripped);
    }
  }
  const parsedDescription = parsedParts.join('');

  return {
    merchantName,
    description: parsedDescription || description,
  };
}

/** Itau outbound PIX: merchant follows the prefix and is also present in paymentData.receiver. */
function parseItauPixEnviado(
  description: string | null,
  paymentData: Record<string, unknown> | null,
): ResolvedTransactionText | null {
  if (!description?.startsWith('Pix enviado')) {
    return null;
  }

  const receiver = readFieldString(paymentData ?? {}, 'receiver');
  const suffix = description.replace(/^Pix enviado\s*/i, '').trim();

  return {
    merchantName: receiver ?? (suffix || null),
    description,
  };
}

/** Itau PIX QR code payment: merchant name follows the prefix; receiver may be absent. */
function parseItauPixQrCode(
  description: string | null,
  paymentData: Record<string, unknown> | null,
): ResolvedTransactionText | null {
  const prefix = 'Pagamento de Pix QR Code';
  if (!description?.startsWith(prefix)) {
    return null;
  }

  const fromDescription = description.slice(prefix.length).trim();
  const merchantName = fromDescription || readFieldString(paymentData ?? {}, 'receiver');

  return {
    merchantName: merchantName ?? null,
    description,
  };
}

function installmentRegexSegment(value: number): string {
  if (value >= 10) {
    return String(value);
  }
  return `0?${value}`;
}

export function stripCreditCardInstallmentSuffix(
  text: string,
  metadata: Record<string, unknown>,
): string {
  const installmentNumber = readInteger(metadata['installmentNumber']);
  const totalInstallments = readInteger(metadata['totalInstallments']);
  if (installmentNumber === null || totalInstallments === null) {
    return text;
  }

  const pattern = new RegExp(
    `\\s*${installmentRegexSegment(installmentNumber)}/${installmentRegexSegment(totalInstallments)}\\s*$`,
  );
  return text.replace(pattern, '').trim();
}

export function parseCreditCardInstallmentMetadata(rawJson: string | Record<string, unknown>): {
  readonly installmentNumber: number | null;
  readonly totalInstallments: number | null;
} {
  const record =
    typeof rawJson === 'string'
      ? (readRecord(JSON.parse(rawJson)) ?? {})
      : (readRecord(rawJson) ?? {});
  const metadata = readRecord(record['creditCardMetadata']);

  return {
    installmentNumber: readInteger(metadata?.['installmentNumber']),
    totalInstallments: readInteger(metadata?.['totalInstallments']),
  };
}

function stripAtPrefix(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('@') ? trimmed.slice(1).trim() : trimmed;
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
