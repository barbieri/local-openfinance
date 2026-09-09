import type { DatabaseSync } from 'node:sqlite';
import { readFieldString } from '../openfinance/money.js';
import {
  enrichListRows,
  resolveAccountDisplayName,
  resolveConnectionDisplayName,
} from './connection-labels.js';
import { parseGroupByFields } from './grouped-list.js';
import { creditCardBillsEntity } from './list/entities.js';
import { runListQuery } from './list/query.js';
import type { FieldFilter, ListQueryResult } from './list/types.js';
import { formatShortDate } from './terminal-format.js';

export const DEFAULT_CREDIT_CARD_BILL_GROUP_BY = ['account', 'payment_status'] as const;

export const CREDIT_CARD_BILL_GROUP_BY_FIELDS = ['account', 'payment_status', 'due_date'] as const;

export type CreditCardBillGroupByField = (typeof CREDIT_CARD_BILL_GROUP_BY_FIELDS)[number];

export type CreditCardBillRow = {
  readonly id: string;
  readonly account_id: string;
  readonly due_date: string | null;
  readonly total_amount_cents: number | null;
  readonly minimum_payment_cents: number | null;
  readonly payment_status: string | null;
  readonly currency: string;
  readonly raw_json: string;
  readonly synced_at: string;
};

export type EnrichedCreditCardBill = CreditCardBillRow & {
  readonly account_display_name: string;
  readonly connection_display_name: string | null;
  readonly account_group_key: string;
  readonly account_group_label: string;
  readonly bill_label: string;
};

export function parseCreditCardBillGroupBy(
  value: string | undefined,
): CreditCardBillGroupByField[] {
  return parseGroupByFields(
    value,
    CREDIT_CARD_BILL_GROUP_BY_FIELDS,
    DEFAULT_CREDIT_CARD_BILL_GROUP_BY,
  );
}

export function listEnrichedCreditCardBills(
  db: DatabaseSync,
  options: {
    readonly filters?: readonly FieldFilter[] | undefined;
    readonly limit?: number | undefined;
    readonly offset?: number | undefined;
  } = {},
): {
  readonly query: ListQueryResult;
  readonly bills: readonly EnrichedCreditCardBill[];
} {
  const query = runListQuery(db, {
    entity: creditCardBillsEntity,
    filters: options.filters ?? [],
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
  });

  return {
    query,
    bills: mapEnrichedCreditCardBillRows(db, query.rows),
  };
}

export function mapEnrichedCreditCardBillRows(
  db: DatabaseSync,
  rows: readonly Record<string, unknown>[],
): EnrichedCreditCardBill[] {
  return enrichListRows(db, creditCardBillsEntity.name, rows).map((row) =>
    toEnrichedCreditCardBill(db, row),
  );
}

function toEnrichedCreditCardBill(
  db: DatabaseSync,
  row: Record<string, unknown>,
): EnrichedCreditCardBill {
  const billRow = readCreditCardBillRow(row);
  const accountId = billRow.account_id;
  const account = db
    .prepare('SELECT connection_item_id FROM accounts WHERE id = ?')
    .get(accountId) as { readonly connection_item_id: string } | undefined;
  const connectionItemId = account?.connection_item_id ?? accountId;
  const accountDisplayName =
    typeof row['account_display_name'] === 'string'
      ? row['account_display_name']
      : resolveAccountDisplayName(db, accountId);

  return {
    ...billRow,
    account_display_name: accountDisplayName,
    connection_display_name: resolveConnectionDisplayName(db, connectionItemId),
    account_group_key: accountId,
    account_group_label: accountDisplayName,
    bill_label: resolveBillLabel(billRow),
  };
}

function readCreditCardBillRow(row: Record<string, unknown>): CreditCardBillRow {
  return {
    id: String(row['id']),
    account_id: String(row['account_id']),
    due_date: readFieldString(row, 'due_date'),
    total_amount_cents:
      typeof row['total_amount_cents'] === 'number' ? row['total_amount_cents'] : null,
    minimum_payment_cents:
      typeof row['minimum_payment_cents'] === 'number' ? row['minimum_payment_cents'] : null,
    payment_status: readFieldString(row, 'payment_status'),
    currency: String(row['currency'] ?? 'BRL'),
    raw_json: typeof row['raw_json'] === 'string' ? row['raw_json'] : '{}',
    synced_at: String(row['synced_at'] ?? ''),
  };
}

function resolveBillLabel(bill: CreditCardBillRow): string {
  if (bill.due_date) {
    return formatShortDate(bill.due_date);
  }

  return bill.id;
}

export function resolveCreditCardBillGroupKey(
  bill: EnrichedCreditCardBill,
  field: CreditCardBillGroupByField,
): { readonly key: string; readonly label: string } {
  switch (field) {
    case 'account':
      return {
        key: bill.account_group_key,
        label: bill.account_group_label,
      };
    case 'payment_status':
      return {
        key: bill.payment_status ?? 'UNKNOWN',
        label: bill.payment_status ?? 'UNKNOWN',
      };
    case 'due_date': {
      const label = bill.due_date ? formatShortDate(bill.due_date) : 'No due date';
      return {
        key: label,
        label,
      };
    }
    default:
      return { key: 'UNKNOWN', label: 'UNKNOWN' };
  }
}
