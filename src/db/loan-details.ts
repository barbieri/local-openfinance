import type { DatabaseSync } from 'node:sqlite';
import { parseAmountToCents, readFieldString, readRecord } from '../openfinance/money.js';
import { resolveConnectionAccountGroup } from './connection-account-group.js';
import { resolveConnectionDisplayName } from './connection-labels.js';
import { parseGroupByFields } from './grouped-list.js';

export const DEFAULT_LOAN_GROUP_BY = ['account', 'type', 'name'] as const;

export const LOAN_GROUP_BY_FIELDS = ['account', 'type', 'name'] as const;

export type LoanGroupByField = (typeof LOAN_GROUP_BY_FIELDS)[number];

export type LoanDetails = {
  readonly name: string | null;
  readonly contract_amount_cents: number | null;
  readonly due_date: string | null;
  readonly outstanding_balance_cents: number | null;
  readonly installment_cents: number | null;
  readonly paid_installments: number | null;
  readonly total_installments: number | null;
  readonly contracted_date: string | null;
  readonly interest_rate: number | null;
  readonly creditor: string | null;
};

export type LoanRow = {
  readonly id: string;
  readonly connection_item_id: string;
  readonly type: string | null;
  readonly contract_number: string | null;
  readonly currency: string;
  readonly raw_json: string;
  readonly synced_at: string;
  readonly connector_name: string | null;
} & LoanDetails;

export type EnrichedLoan = LoanRow & {
  readonly display_name: string;
  readonly connection_display_name: string | null;
  readonly account_group_key: string;
  readonly account_group_label: string;
};

export function parseLoanGroupBy(value: string | undefined): LoanGroupByField[] {
  return parseGroupByFields(value, LOAN_GROUP_BY_FIELDS, DEFAULT_LOAN_GROUP_BY);
}

export function parseLoanDetails(
  rawJson: string | Record<string, unknown>,
  row?: Pick<LoanRow, 'contract_amount_cents' | 'due_date' | 'contract_number' | 'type'>,
): LoanDetails {
  const record =
    typeof rawJson === 'string'
      ? (readRecord(JSON.parse(rawJson)) ?? {})
      : (readRecord(rawJson) ?? {});

  return {
    name:
      readFieldString(record, 'productName') ??
      readFieldString(record, 'name') ??
      readFieldString(record, 'description'),
    contract_amount_cents:
      parseAmountToCents(record['contractAmount']) ?? row?.contract_amount_cents ?? null,
    due_date:
      readFieldString(record, 'dueDate') ??
      readFieldString(record, 'finalDueDate') ??
      row?.due_date ??
      null,
    outstanding_balance_cents: resolveLoanOutstandingBalanceCents(record),
    installment_cents:
      readAmountField(record, 'installmentAmount') ??
      readAmountField(record, 'nextInstallmentAmount'),
    paid_installments: readInteger(record['paidInstallments']),
    total_installments:
      readInteger(record['totalNumberOfInstallments']) ?? readInteger(record['totalInstallments']),
    contracted_date:
      readFieldString(record, 'contractDate') ?? readFieldString(record, 'contractedDate'),
    interest_rate: readInterestRate(record),
    creditor:
      readFieldString(record, 'companyName') ??
      readFieldString(record, 'creditor') ??
      readFieldString(record, 'institutionName'),
  };
}

export function resolveLoanOutstandingBalanceCents(record: Record<string, unknown>): number | null {
  return (
    readAmountField(record, 'outstandingBalance') ??
    readAmountField(record, 'balance') ??
    readAmountField(record, 'amountRemaining') ??
    readAmountField(record, 'currentDebtAmount')
  );
}

export function loadLoans(db: DatabaseSync): LoanRow[] {
  return db
    .prepare(
      `SELECT l.id, l.connection_item_id, l.type, l.contract_amount_cents, l.due_date,
              l.contract_number, l.currency, l.raw_json, l.synced_at, l.name,
              l.outstanding_balance_cents, l.installment_cents, l.paid_installments,
              l.total_installments, l.contracted_date, l.interest_rate, l.creditor,
              c.connector_name
       FROM loans l
       JOIN connections c ON c.item_id = l.connection_item_id
       ORDER BY c.connector_name ASC, l.type ASC, l.contract_number ASC, l.id ASC`,
    )
    .all()
    .map((row) => readLoanRow(row as Record<string, unknown>));
}

export function readLoanRow(record: Record<string, unknown>): LoanRow {
  const stored = readStoredLoanDetails(record);
  const parsed = parseLoanDetails(String(record['raw_json'] ?? '{}'), {
    contract_amount_cents: stored.contract_amount_cents,
    due_date: stored.due_date,
    contract_number: readFieldString(record, 'contract_number'),
    type: readFieldString(record, 'type'),
  });

  return {
    id: String(record['id']),
    connection_item_id: String(record['connection_item_id']),
    type: readFieldString(record, 'type'),
    contract_number: readFieldString(record, 'contract_number'),
    currency: String(record['currency'] ?? 'BRL'),
    raw_json: String(record['raw_json'] ?? '{}'),
    synced_at: String(record['synced_at'] ?? ''),
    connector_name: typeof record['connector_name'] === 'string' ? record['connector_name'] : null,
    ...mergeLoanDetails(stored, parsed),
  };
}

export function enrichLoanRow(db: DatabaseSync, row: LoanRow): EnrichedLoan {
  const accountGroup = resolveConnectionAccountGroup(db, row.connection_item_id);
  const displayName = row.contract_number ?? row.name ?? row.id;

  return {
    ...row,
    display_name: displayName,
    connection_display_name: resolveConnectionDisplayName(db, row.connection_item_id),
    account_group_key: accountGroup.key,
    account_group_label: accountGroup.label,
  };
}

export function listEnrichedLoans(db: DatabaseSync): EnrichedLoan[] {
  return loadLoans(db).map((row) => enrichLoanRow(db, row));
}

export function resolveLoanGroupKey(
  loan: EnrichedLoan,
  field: LoanGroupByField,
): { readonly key: string; readonly label: string } {
  switch (field) {
    case 'account':
      return {
        key: loan.account_group_key,
        label: loan.account_group_label,
      };
    case 'type':
      return {
        key: loan.type ?? 'UNKNOWN',
        label: loan.type ?? 'UNKNOWN',
      };
    case 'name':
      return {
        key: loan.display_name,
        label: loan.display_name,
      };
    default:
      return { key: 'UNKNOWN', label: 'UNKNOWN' };
  }
}

function readStoredLoanDetails(record: Record<string, unknown>): LoanDetails {
  return {
    name: readFieldString(record, 'name'),
    contract_amount_cents: readOptionalInteger(record['contract_amount_cents']),
    due_date: readFieldString(record, 'due_date'),
    outstanding_balance_cents: readOptionalInteger(record['outstanding_balance_cents']),
    installment_cents: readOptionalInteger(record['installment_cents']),
    paid_installments: readOptionalInteger(record['paid_installments']),
    total_installments: readOptionalInteger(record['total_installments']),
    contracted_date: readFieldString(record, 'contracted_date'),
    interest_rate: readOptionalNumber(record['interest_rate']),
    creditor: readFieldString(record, 'creditor'),
  };
}

function mergeLoanDetails(stored: LoanDetails, parsed: LoanDetails): LoanDetails {
  return {
    name: stored.name ?? parsed.name,
    contract_amount_cents: stored.contract_amount_cents ?? parsed.contract_amount_cents,
    due_date: stored.due_date ?? parsed.due_date,
    outstanding_balance_cents: stored.outstanding_balance_cents ?? parsed.outstanding_balance_cents,
    installment_cents: stored.installment_cents ?? parsed.installment_cents,
    paid_installments: stored.paid_installments ?? parsed.paid_installments,
    total_installments: stored.total_installments ?? parsed.total_installments,
    contracted_date: stored.contracted_date ?? parsed.contracted_date,
    interest_rate: stored.interest_rate ?? parsed.interest_rate,
    creditor: stored.creditor ?? parsed.creditor,
  };
}

function readOptionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function readInterestRate(record: Record<string, unknown>): number | null {
  const direct = readNumber(record['interestRate']);
  if (direct !== null) {
    return direct;
  }

  const rates = record['interestRates'];
  if (!Array.isArray(rates) || rates.length === 0) {
    return null;
  }

  const first = readRecord(rates[0]);
  if (!first) {
    return null;
  }

  return (
    readNumber(first['preFixedRate']) ??
    readNumber(first['postFixedRate']) ??
    readNumber(first['tax']) ??
    readNumber(first['value'])
  );
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.replace(',', '.').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readAmountField(record: Record<string, unknown>, key: string): number | null {
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
