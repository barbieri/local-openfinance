import {
  formatInvestmentIssuerLabel,
  formatInvestmentRateLabel,
} from '../../../../openfinance/investment-display.js';
import { matchesSearch } from '../../lib/normalize.js';

export const INVESTMENT_COLUMN_KEYS = [
  'connection',
  'account',
  'name',
  'code',
  'type',
  'subtype',
  'status',
  'total',
  'quantity',
  'unitPrice',
  'isin',
  'rate',
  'issuer',
  'purchaseDate',
  'dueDate',
  'taxes',
  'taxes2',
  'allocation',
] as const;
export type InvestmentColumnKey = (typeof INVESTMENT_COLUMN_KEYS)[number];

export type InvestmentGroupBy =
  | 'none'
  | 'connection'
  | 'account'
  | 'type'
  | 'subtype'
  | 'status'
  | 'name';

export const GROUP_BY_COLUMN: Partial<Record<InvestmentGroupBy, InvestmentColumnKey>> = {
  connection: 'connection',
  account: 'account',
  type: 'type',
  subtype: 'subtype',
  status: 'status',
  name: 'name',
};

export function isSingleStatusFilter(statusFilter: string): boolean {
  return statusFilter !== 'all' && !statusFilter.includes(',');
}

export function defaultInvestmentVisibleColumns(
  singleStatus: boolean,
): ReadonlySet<InvestmentColumnKey> {
  return new Set(
    INVESTMENT_COLUMN_KEYS.filter(
      (key) => key !== 'connection' && !(singleStatus && key === 'status'),
    ),
  );
}

export function investmentAmountCents(row: Record<string, unknown>): number {
  return Number(row.total_cents ?? row.balance_cents ?? 0);
}

export function investmentAllocationCents(row: Record<string, unknown>): number {
  return Math.abs(investmentAmountCents(row));
}

export function investmentRateLabel(row: Record<string, unknown>): string | null {
  const cached = row.rate_label;
  if (typeof cached === 'string' && cached.length > 0) {
    return cached;
  }
  const rate = row.rate;
  return formatInvestmentRateLabel(
    typeof rate === 'number' ? rate : null,
    typeof row.rate_type === 'string' ? row.rate_type : null,
  );
}

export function investmentIssuerLabel(row: Record<string, unknown>): string | null {
  const cached = row.issuer_label;
  if (typeof cached === 'string' && cached.length > 0) {
    return cached;
  }
  return formatInvestmentIssuerLabel(
    typeof row.issuer === 'string' ? row.issuer : null,
    typeof row.issuer_cnpj === 'string' ? row.issuer_cnpj : null,
  );
}

export function investmentAccountLabel(row: Record<string, unknown>): string {
  return String(row.account_group_label ?? '—');
}

export function investmentGroupConnectionLabel(row: Record<string, unknown>): string {
  return String(row.connection_display_name ?? row.connector_name ?? row.connection_item_id ?? '—');
}

export function investmentGroupKey(
  row: Record<string, unknown>,
  groupBy: InvestmentGroupBy,
): string {
  switch (groupBy) {
    case 'connection':
      return String(row.connection_item_id ?? investmentGroupConnectionLabel(row));
    case 'account':
      return String(row.account_group_key ?? investmentAccountLabel(row));
    case 'name':
      return String(row.display_name ?? row.name ?? '—');
    default:
      return String(row[groupBy] ?? '—');
  }
}

export function investmentGroupLabel(
  row: Record<string, unknown>,
  groupBy: InvestmentGroupBy,
): string {
  switch (groupBy) {
    case 'connection':
      return investmentGroupConnectionLabel(row);
    case 'account':
      return investmentAccountLabel(row);
    case 'name':
      return String(row.display_name ?? row.name ?? '—');
    default:
      return String(row[groupBy] ?? '—');
  }
}

export function matchesInvestmentStatusFilter(
  row: Record<string, unknown>,
  statusFilter: string,
): boolean {
  if (!statusFilter || statusFilter === 'all') {
    return true;
  }
  const allowed = statusFilter.split(',').map((part) => part.trim().toUpperCase());
  const status = String(row.status ?? 'UNKNOWN').toUpperCase();
  return allowed.includes(status);
}

export function filterInvestmentRows(
  rows: readonly Record<string, unknown>[],
  search: string,
  statusFilter: string,
): Record<string, unknown>[] {
  let list = rows.filter((row) => matchesInvestmentStatusFilter(row, statusFilter));
  if (search.trim()) {
    list = list.filter(
      (row) =>
        matchesSearch(String(row.display_name ?? row.name ?? ''), search) ||
        matchesSearch(String(row.code ?? ''), search) ||
        matchesSearch(String(row.type ?? ''), search) ||
        matchesSearch(String(row.subtype ?? ''), search) ||
        matchesSearch(String(row.isin ?? ''), search) ||
        matchesSearch(String(investmentRateLabel(row) ?? ''), search) ||
        matchesSearch(String(investmentIssuerLabel(row) ?? row.issuer ?? ''), search) ||
        matchesSearch(investmentGroupConnectionLabel(row), search) ||
        matchesSearch(investmentAccountLabel(row), search),
    );
  }
  return list;
}
