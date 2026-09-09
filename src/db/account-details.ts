import { parseAmountToCents, readFieldString, readRecord } from '../openfinance/money.js';

export type BankDataSummary = {
  readonly transferNumber: string | null;
  readonly bankNumber: string | null;
  readonly branch: string | null;
  readonly account: string | null;
};

export type CreditDataSummary = {
  readonly level: string | null;
  readonly brand: string | null;
  readonly balance_close_date: string | null;
  readonly balance_due_date: string | null;
  readonly minimum_payment_cents: number | null;
  readonly available_credit_limit_cents: number | null;
  readonly credit_limit_cents: number | null;
  readonly status: string | null;
};

export type AccountRawDetails = {
  readonly bankData: BankDataSummary | null;
  readonly creditData: CreditDataSummary | null;
};

export function parseTransferNumber(transferNumber: string): BankDataSummary {
  const trimmed = transferNumber.trim();
  const parts = trimmed.split('/');

  if (parts.length >= 3) {
    return {
      transferNumber: trimmed,
      bankNumber: parts[0] ?? null,
      branch: parts[1] ?? null,
      account: parts.slice(2).join('/') || null,
    };
  }

  return {
    transferNumber: trimmed,
    bankNumber: null,
    branch: null,
    account: null,
  };
}

export function parseAccountRawJson(rawJson: string | Record<string, unknown>): AccountRawDetails {
  const record =
    typeof rawJson === 'string'
      ? (readRecord(JSON.parse(rawJson)) ?? {})
      : (readRecord(rawJson) ?? {});

  return {
    bankData: parseBankData(record['bankData']),
    creditData: parseCreditData(record['creditData']),
  };
}

export type AccountDetailColumns = {
  readonly credit_brand: string | null;
  readonly credit_level: string | null;
  readonly credit_limit_cents: number | null;
  readonly credit_available_limit_cents: number | null;
  readonly credit_minimum_payment_cents: number | null;
  readonly credit_balance_close_date: string | null;
  readonly credit_balance_due_date: string | null;
  readonly credit_status: string | null;
  readonly bank_transfer_number: string | null;
  readonly bank_branch: string | null;
  readonly bank_account: string | null;
};

export function parseAccountDetailColumns(record: Record<string, unknown>): AccountDetailColumns {
  const { bankData, creditData } = parseAccountRawJson(record);

  return {
    credit_brand: creditData?.brand ?? null,
    credit_level: creditData?.level ?? null,
    credit_limit_cents: creditData?.credit_limit_cents ?? null,
    credit_available_limit_cents: creditData?.available_credit_limit_cents ?? null,
    credit_minimum_payment_cents: creditData?.minimum_payment_cents ?? null,
    credit_balance_close_date: creditData?.balance_close_date ?? null,
    credit_balance_due_date: creditData?.balance_due_date ?? null,
    credit_status: creditData?.status ?? null,
    bank_transfer_number: bankData?.transferNumber ?? null,
    bank_branch: bankData?.branch ?? null,
    bank_account: bankData?.account ?? null,
  };
}

export function creditDataFromAccountRow(row: Record<string, unknown>): CreditDataSummary | null {
  const stored: CreditDataSummary = {
    brand: readFieldString(row, 'credit_brand'),
    level: readFieldString(row, 'credit_level'),
    credit_limit_cents: readOptionalInteger(row['credit_limit_cents']),
    available_credit_limit_cents: readOptionalInteger(row['credit_available_limit_cents']),
    minimum_payment_cents: readOptionalInteger(row['credit_minimum_payment_cents']),
    balance_close_date: readFieldString(row, 'credit_balance_close_date'),
    balance_due_date: readFieldString(row, 'credit_balance_due_date'),
    status: readFieldString(row, 'credit_status'),
  };

  if (Object.values(stored).some((value) => value !== null)) {
    return stored;
  }

  return parseAccountRawJson(String(row['raw_json'] ?? '{}')).creditData;
}

function readOptionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatCreditCardAccountDetails(
  number: string | null,
  creditData: CreditDataSummary | null,
): string {
  const parts = [creditData?.brand, creditData?.level]
    .filter(Boolean)
    .map((part) => String(part).trim());
  const lastFour = extractCardLastFourDigits(number);
  if (lastFour) {
    parts.push(lastFour);
  } else if (number) {
    parts.push(String(number).trim());
  }

  return parts.length > 0 ? parts.join(' ') : '—';
}

export function extractCardLastFourDigits(cardNumber: string | null): string | null {
  if (!cardNumber) {
    return null;
  }

  const trimmed = cardNumber.trim();
  if (/^\d{4}$/u.test(trimmed)) {
    return trimmed;
  }

  const trailingMatch = trimmed.match(/(\d{4})\s*$/u);
  if (trailingMatch?.[1]) {
    return trailingMatch[1];
  }

  const digitRunMatch = trimmed.match(/(\d{4,})$/u);
  if (digitRunMatch?.[1]) {
    return digitRunMatch[1].slice(-4);
  }

  return null;
}

export function formatCreditCardDisplayName(
  brand: string | null,
  level: string | null,
  cardNumber: string | null,
): string | null {
  const brandLabel = brand ?? 'Card';
  const lastFour = extractCardLastFourDigits(cardNumber);

  if (lastFour) {
    return `${brandLabel} (${lastFour})`;
  }

  if (brand && level) {
    return `${brand} (${level})`;
  }

  return brand ?? level ?? null;
}

export function resolveDefaultAccountDisplayName(
  type: string,
  upstreamName: string | null,
  subtype: string | null,
  accountId: string,
  accountNumber: string | null,
  details: AccountRawDetails,
): string {
  if (type === 'BANK') {
    const transferNumber = details.bankData?.transferNumber;
    if (transferNumber) {
      return transferNumber;
    }
  }

  if (type === 'CREDIT') {
    const formatted = formatCreditCardDisplayName(
      details.creditData?.brand ?? null,
      details.creditData?.level ?? null,
      accountNumber,
    );
    if (formatted) {
      return formatted;
    }
  }

  if (upstreamName) {
    return upstreamName;
  }

  if (subtype) {
    return subtype;
  }

  return type.length > 0 ? type : accountId;
}

export function formatAccountTypeSubtype(type: string, subtype: string | null): string {
  if (subtype) {
    return `${type}/${subtype}`;
  }

  return type;
}

export function resolveAccountDisplayNameFromRow(row: Record<string, unknown>): string {
  const accountId = String(row['id']);
  const type = String(row['type'] ?? 'UNKNOWN');
  const upstreamName =
    typeof row['name'] === 'string' && row['name'].length > 0 ? row['name'] : null;
  const subtype = typeof row['subtype'] === 'string' ? row['subtype'] : null;
  const rawJson = typeof row['raw_json'] === 'string' ? row['raw_json'] : '{}';
  const rawRecord = readRecord(JSON.parse(rawJson));
  const accountNumber =
    (typeof row['number'] === 'string' && row['number'].length > 0 ? row['number'] : null) ??
    readFieldString(rawRecord ?? {}, 'number');

  return resolveDefaultAccountDisplayName(
    type,
    upstreamName,
    subtype,
    accountId,
    accountNumber,
    parseAccountRawJson(rawJson),
  );
}

function parseBankData(value: unknown): BankDataSummary | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const transferNumber = readFieldString(record, 'transferNumber');
  if (!transferNumber) {
    return {
      transferNumber: null,
      bankNumber: null,
      branch: null,
      account: null,
    };
  }

  return parseTransferNumber(transferNumber);
}

function parseCreditData(value: unknown): CreditDataSummary | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const summary: CreditDataSummary = {
    level: readFieldString(record, 'level'),
    brand: readFieldString(record, 'brand'),
    balance_close_date: readCreditDate(record, 'balanceCloseDate'),
    balance_due_date: readCreditDate(record, 'balanceDueDate'),
    minimum_payment_cents: readCreditAmountCents(record, 'minimumPayment'),
    available_credit_limit_cents: readCreditAmountCents(record, 'availableCreditLimit'),
    credit_limit_cents: readCreditAmountCents(record, 'creditLimit'),
    status: readFieldString(record, 'status'),
  };

  if (Object.values(summary).every((value) => value === null)) {
    return null;
  }

  return summary;
}

function readCreditDate(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  return null;
}

function readCreditAmountCents(record: Record<string, unknown>, key: string): number | null {
  const direct = parseAmountToCents(record[key]);
  if (direct !== null) {
    return direct;
  }

  const nested = readRecord(record[key]);
  if (!nested) {
    return null;
  }

  return parseAmountToCents(nested['amount']) ?? parseAmountToCents(nested['value']);
}
