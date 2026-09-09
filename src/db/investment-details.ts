import type { DatabaseSync } from 'node:sqlite';
import { parseAmountToCents, readFieldString, readRecord } from '../openfinance/money.js';
import {
  matchesListStatusFilter,
  parseListStatusFilter,
  resolveConnectionAccountGroup,
} from './connection-account-group.js';
import { resolveConnectionDisplayName } from './connection-labels.js';
import { parseGroupByFields } from './grouped-list.js';

export const DEFAULT_INVESTMENT_GROUP_BY = ['account', 'type', 'subtype', 'name'] as const;

export const INVESTMENT_GROUP_BY_FIELDS = ['account', 'type', 'subtype', 'name'] as const;

export type InvestmentGroupByField = (typeof INVESTMENT_GROUP_BY_FIELDS)[number];

export type InvestmentDetails = {
  readonly isin: string | null;
  readonly status: string | null;
  /** Unit price from raw `value` (e.g. per-share quote). */
  readonly unit_price_cents: number | null;
  /** Position total from `amountWithdrawal`, `amount`, or `balance`. */
  readonly total_cents: number | null;
  readonly quantity: number | null;
  readonly amount_cents: number | null;
  readonly amount_withdrawal_cents: number | null;
  readonly issuer: string | null;
  readonly issuer_cnpj: string | null;
  readonly rate: number | null;
  readonly rate_type: string | null;
  readonly purchase_date: string | null;
  readonly due_date: string | null;
  readonly taxes_cents: number | null;
  readonly taxes2_cents: number | null;
};

export type InvestmentRow = {
  readonly id: string;
  readonly connection_item_id: string;
  readonly type: string | null;
  readonly subtype: string | null;
  readonly name: string | null;
  readonly code: string | null;
  readonly balance_cents: number | null;
  readonly currency: string;
  readonly raw_json: string;
  readonly synced_at: string;
  readonly connector_name: string | null;
} & InvestmentDetails;

export type EnrichedInvestment = InvestmentRow & {
  readonly display_name: string;
  readonly connection_display_name: string | null;
  readonly account_group_key: string;
  readonly account_group_label: string;
};

export function parseInvestmentGroupBy(value: string | undefined): InvestmentGroupByField[] {
  return parseGroupByFields(value, INVESTMENT_GROUP_BY_FIELDS, DEFAULT_INVESTMENT_GROUP_BY);
}

export function parseInvestmentStatusFilter(value: string | undefined): readonly string[] | 'all' {
  return parseListStatusFilter(value);
}

export function parseInvestmentDetails(
  rawJson: string | Record<string, unknown>,
): InvestmentDetails {
  const record =
    typeof rawJson === 'string'
      ? (readRecord(JSON.parse(rawJson)) ?? {})
      : (readRecord(rawJson) ?? {});

  const sources = collectInvestmentDetailSources(record);
  const quantity = readFirstNumber(sources, 'quantity', 'quotaQuantity', 'shares');
  const total_cents = resolveInvestmentTotalCents(record);
  let unit_price_cents = readFirstAmount(
    sources,
    'value',
    'unitPrice',
    'price',
    'remunerationRate',
  );
  if (unit_price_cents === null && total_cents !== null && quantity !== null && quantity > 0) {
    unit_price_cents = Math.round(total_cents / quantity);
  }

  return {
    isin: readFirstFieldString(sources, 'isin', 'isinCode', 'isin_code'),
    status: readFieldString(record, 'status')?.toUpperCase() ?? null,
    unit_price_cents,
    total_cents,
    quantity,
    amount_cents: readFirstAmount(sources, 'amount', 'grossAmount'),
    amount_withdrawal_cents: readFirstAmount(
      sources,
      'amountWithdrawal',
      'netAmount',
      'withdrawalAmount',
    ),
    issuer: readFirstFieldString(sources, 'issuer', 'issuerName', 'issuerInstitutionName'),
    issuer_cnpj: readFirstFieldString(sources, 'issuerCNPJ', 'issuer_cnpj'),
    rate: readFirstNumber(sources, 'rate'),
    rate_type: readFirstFieldString(sources, 'rateType', 'rate_type'),
    purchase_date: readFirstFieldString(
      sources,
      'purchaseDate',
      'purchase_date',
      'issueDate',
      'issue_date',
    ),
    due_date: readFirstFieldString(sources, 'dueDate', 'due_date', 'maturityDate', 'maturity_date'),
    taxes_cents: readFirstAmount(sources, 'taxes', 'incomeTax', 'financialTransactionTax', 'iof'),
    taxes2_cents: readFirstAmount(sources, 'taxes2', 'incomeTaxProvisions', 'transactionTax'),
  };
}

export function resolveInvestmentTotalCents(record: Record<string, unknown>): number | null {
  const sources = collectInvestmentDetailSources(record);
  return readFirstAmount(
    sources,
    'amountWithdrawal',
    'amount',
    'balance',
    'grossAmount',
    'netAmount',
    'withdrawalAmount',
  );
}

export function loadInvestments(db: DatabaseSync): InvestmentRow[] {
  return db
    .prepare(
      `SELECT i.id, i.connection_item_id, i.type, i.subtype, i.name, i.code, i.balance_cents,
              i.currency, i.raw_json, i.synced_at, i.status, i.isin, i.quantity, i.unit_price_cents,
              i.total_cents, i.amount_cents, i.amount_withdrawal_cents, i.issuer, i.issuer_cnpj,
              i.rate, i.rate_type, i.purchase_date, i.due_date, i.taxes_cents, i.taxes2_cents,
              c.connector_name
       FROM investments i
       JOIN connections c ON c.item_id = i.connection_item_id
       ORDER BY c.connector_name ASC, i.type ASC, i.subtype ASC, i.name ASC, i.id ASC`,
    )
    .all()
    .map((row) => readInvestmentRow(row as Record<string, unknown>));
}

export function readInvestmentRow(record: Record<string, unknown>): InvestmentRow {
  const stored = readStoredInvestmentDetails(record);
  const parsed = parseInvestmentDetails(String(record['raw_json'] ?? '{}'));

  return {
    id: String(record['id']),
    connection_item_id: String(record['connection_item_id']),
    type: readFieldString(record, 'type'),
    subtype: readFieldString(record, 'subtype'),
    name: readFieldString(record, 'name'),
    code: readFieldString(record, 'code'),
    balance_cents: readOptionalInteger(record['balance_cents']),
    currency: String(record['currency'] ?? 'BRL'),
    raw_json: String(record['raw_json'] ?? '{}'),
    synced_at: String(record['synced_at'] ?? ''),
    connector_name: typeof record['connector_name'] === 'string' ? record['connector_name'] : null,
    ...mergeInvestmentDetails(stored, parsed),
  };
}

export function enrichInvestmentRow(db: DatabaseSync, row: InvestmentRow): EnrichedInvestment {
  const accountGroup = resolveConnectionAccountGroup(db, row.connection_item_id);
  const displayName = row.name ?? row.code ?? row.id;

  return {
    ...row,
    display_name: displayName,
    connection_display_name: resolveConnectionDisplayName(db, row.connection_item_id),
    account_group_key: accountGroup.key,
    account_group_label: accountGroup.label,
  };
}

export function listEnrichedInvestments(
  db: DatabaseSync,
  statusFilter: readonly string[] | 'all',
): EnrichedInvestment[] {
  const enriched: EnrichedInvestment[] = [];
  for (const row of loadInvestments(db)) {
    const item = enrichInvestmentRow(db, row);
    if (matchesListStatusFilter(item.status, statusFilter)) {
      enriched.push(item);
    }
  }
  return enriched;
}

export function investmentMatchesStatusFilter(
  status: string | null,
  statusFilter: readonly string[] | 'all',
): boolean {
  return matchesListStatusFilter(status, statusFilter);
}

export {
  formatInvestmentIssuerLabel,
  formatInvestmentRateLabel,
} from '../openfinance/investment-display.js';

function collectInvestmentDetailSources(
  record: Record<string, unknown>,
): Record<string, unknown>[] {
  const sources: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();
  const queue: Record<string, unknown>[] = [];

  const enqueue = (candidate: Record<string, unknown> | null | undefined): void => {
    if (!candidate || seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    sources.push(candidate);
    queue.push(candidate);
  };

  enqueue(record);
  enqueue(readRecord(record['data']));

  const type = readFieldString(record, 'type');
  if (type) {
    for (const key of [type, type.toLowerCase(), type.toUpperCase()]) {
      enqueue(readRecord(record[key]));
    }
  }

  for (const nested of [
    readNestedInvestmentRecord(record, ['fixedIncome', 'fixedIncomeData', 'fixed_income']),
    readNestedInvestmentRecord(record, ['stock', 'equity', 'stockData', 'variableIncome']),
    readNestedInvestmentRecord(record, ['details', 'investmentDetails', 'data']),
    readNestedInvestmentRecord(record, ['remuneration', 'issueRemunerationRate', 'index']),
    readNestedInvestmentRecord(record, ['participant']),
  ]) {
    enqueue(nested);
  }

  appendNestedInvestmentSources(queue, seen, (nested) => {
    sources.push(nested);
  });
  return sources;
}

function appendNestedInvestmentSources(
  queue: Record<string, unknown>[],
  seen: Set<Record<string, unknown>>,
  onNested: (nested: Record<string, unknown>) => void,
): void {
  const enqueue = (candidate: Record<string, unknown> | null | undefined): void => {
    if (!candidate || seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    onNested(candidate);
    queue.push(candidate);
  };

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    for (const value of Object.values(current)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          enqueue(readRecord(item));
        }
        continue;
      }
      enqueue(readRecord(value));
    }
  }
}

function readFirstFieldString(
  sources: readonly Record<string, unknown>[],
  ...keys: string[]
): string | null {
  for (const source of sources) {
    for (const key of keys) {
      const value = readFieldString(source, key);
      if (value) {
        return value;
      }
    }
  }

  return null;
}

function readFirstAmount(
  sources: readonly Record<string, unknown>[],
  ...keys: string[]
): number | null {
  for (const source of sources) {
    for (const key of keys) {
      const value = readAmountField(source, key);
      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

function readFirstNumber(
  sources: readonly Record<string, unknown>[],
  ...keys: string[]
): number | null {
  for (const source of sources) {
    for (const key of keys) {
      const value = readNumber(source[key]);
      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

function readStoredInvestmentDetails(record: Record<string, unknown>): InvestmentDetails {
  return {
    isin: readFieldString(record, 'isin'),
    status: readFieldString(record, 'status')?.toUpperCase() ?? null,
    unit_price_cents: readOptionalInteger(record['unit_price_cents']),
    total_cents: readOptionalInteger(record['total_cents']),
    quantity: readOptionalNumber(record['quantity']),
    amount_cents: readOptionalInteger(record['amount_cents']),
    amount_withdrawal_cents: readOptionalInteger(record['amount_withdrawal_cents']),
    issuer: readFieldString(record, 'issuer'),
    issuer_cnpj: readFieldString(record, 'issuer_cnpj'),
    rate: readOptionalNumber(record['rate']),
    rate_type: readFieldString(record, 'rate_type'),
    purchase_date: readFieldString(record, 'purchase_date'),
    due_date: readFieldString(record, 'due_date'),
    taxes_cents: readOptionalInteger(record['taxes_cents']),
    taxes2_cents: readOptionalInteger(record['taxes2_cents']),
  };
}

function mergeInvestmentDetails(
  stored: InvestmentDetails,
  parsed: InvestmentDetails,
): InvestmentDetails {
  return {
    isin: stored.isin ?? parsed.isin,
    status: stored.status ?? parsed.status,
    unit_price_cents: stored.unit_price_cents ?? parsed.unit_price_cents,
    total_cents: stored.total_cents ?? parsed.total_cents,
    quantity: stored.quantity ?? parsed.quantity,
    amount_cents: stored.amount_cents ?? parsed.amount_cents,
    amount_withdrawal_cents: stored.amount_withdrawal_cents ?? parsed.amount_withdrawal_cents,
    issuer: stored.issuer ?? parsed.issuer,
    issuer_cnpj: stored.issuer_cnpj ?? parsed.issuer_cnpj,
    rate: stored.rate ?? parsed.rate,
    rate_type: stored.rate_type ?? parsed.rate_type,
    purchase_date: stored.purchase_date ?? parsed.purchase_date,
    due_date: stored.due_date ?? parsed.due_date,
    taxes_cents: stored.taxes_cents ?? parsed.taxes_cents,
    taxes2_cents: stored.taxes2_cents ?? parsed.taxes2_cents,
  };
}

function readOptionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNestedInvestmentRecord(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const nested = readRecord(record[key]);
    if (nested) {
      return nested;
    }
  }

  return null;
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
