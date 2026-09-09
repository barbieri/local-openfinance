import type { DatabaseSync } from 'node:sqlite';
import { readFieldString } from '../openfinance/money.js';
import type { CreditDataSummary } from './account-details.js';
import { creditDataFromAccountRow, parseAccountRawJson } from './account-details.js';
import { enrichAccountLinksListRows, getAliasAccountIds } from './account-links.js';
import { resolveConnectionAccountGroup } from './connection-account-group.js';
import {
  enrichListRows,
  resolveAccountDisplayName,
  resolveConnectionDisplayName,
} from './connection-labels.js';
import { parseGroupByFields } from './grouped-list.js';
import { accountsEntity, creditCardsEntity } from './list/entities.js';
import { runListQuery } from './list/query.js';
import type { FieldFilter, ListEntityDefinition, ListQueryResult } from './list/types.js';

export const DEFAULT_ACCOUNT_GROUP_BY = ['account', 'type', 'subtype'] as const;

export const ACCOUNT_GROUP_BY_FIELDS = ['account', 'type', 'subtype'] as const;

export const DEFAULT_CREDIT_CARD_GROUP_BY = ['account', 'subtype'] as const;

export const CREDIT_CARD_GROUP_BY_FIELDS = ['account', 'subtype'] as const;

export type AccountGroupByField = (typeof ACCOUNT_GROUP_BY_FIELDS)[number];

export type CreditCardGroupByField = (typeof CREDIT_CARD_GROUP_BY_FIELDS)[number];

export type AccountRow = {
  readonly id: string;
  readonly connection_item_id: string;
  readonly type: string;
  readonly subtype: string | null;
  readonly name: string | null;
  readonly number: string | null;
  readonly owner: string | null;
  readonly balance_cents: number | null;
  readonly currency: string;
  readonly raw_json: string;
  readonly synced_at: string;
  readonly connector_name: string | null;
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

export type EnrichedAccount = AccountRow & {
  readonly display_name: string;
  readonly connection_display_name: string | null;
  readonly account_group_key: string;
  readonly account_group_label: string;
  readonly branch: string | null;
  readonly account: string | null;
  readonly transfer_number: string | null;
  readonly credit_data: CreditDataSummary | null;
  readonly merged_account_ids: readonly string[];
};

export function parseAccountGroupBy(value: string | undefined): AccountGroupByField[] {
  return parseGroupByFields(value, ACCOUNT_GROUP_BY_FIELDS, DEFAULT_ACCOUNT_GROUP_BY);
}

export function parseCreditCardGroupBy(value: string | undefined): CreditCardGroupByField[] {
  return parseGroupByFields(value, CREDIT_CARD_GROUP_BY_FIELDS, DEFAULT_CREDIT_CARD_GROUP_BY);
}

export function listEnrichedAccounts(
  db: DatabaseSync,
  options: {
    readonly filters?: readonly FieldFilter[] | undefined;
    readonly limit?: number | undefined;
    readonly offset?: number | undefined;
    readonly entity?: ListEntityDefinition | undefined;
  } = {},
): { readonly query: ListQueryResult; readonly accounts: readonly EnrichedAccount[] } {
  const entity = options.entity ?? accountsEntity;
  const query = runListQuery(db, {
    entity,
    filters: options.filters ?? [],
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
  });

  return {
    query,
    accounts: mapEnrichedAccountRows(db, query.rows, entity.name),
  };
}

export function listEnrichedCreditCards(
  db: DatabaseSync,
  options: {
    readonly filters?: readonly FieldFilter[] | undefined;
    readonly limit?: number | undefined;
    readonly offset?: number | undefined;
  } = {},
): { readonly query: ListQueryResult; readonly creditCards: readonly EnrichedAccount[] } {
  const result = listEnrichedAccounts(db, { ...options, entity: creditCardsEntity });
  return {
    query: result.query,
    creditCards: result.accounts,
  };
}

export function mapEnrichedAccountRows(
  db: DatabaseSync,
  rows: readonly Record<string, unknown>[],
  entityName: string = accountsEntity.name,
): EnrichedAccount[] {
  const enriched = enrichAccountLinksListRows(db, entityName, enrichListRows(db, entityName, rows));

  return enriched.map((row) => toEnrichedAccount(db, row));
}

export function enrichAccountRow(db: DatabaseSync, row: AccountRow): EnrichedAccount {
  return toEnrichedAccount(
    db,
    enrichListRows(db, accountsEntity.name, [row as unknown as Record<string, unknown>])[0] ??
      (row as unknown as Record<string, unknown>),
  );
}

function toEnrichedAccount(db: DatabaseSync, row: Record<string, unknown>): EnrichedAccount {
  const accountRow = readAccountRow(row);
  const accountGroup = resolveConnectionAccountGroup(db, accountRow.connection_item_id);
  const rawJson = accountRow.raw_json;
  const details = parseAccountRawJson(rawJson);
  const creditData = creditDataFromAccountRow(row);
  const mergedAccountIds = Array.isArray(row['merged_account_ids'])
    ? row['merged_account_ids'].map((value) => String(value))
    : getAliasAccountIds(db, accountRow.id);

  return {
    ...accountRow,
    display_name: resolveAccountDisplayName(db, accountRow.id),
    connection_display_name: resolveConnectionDisplayName(db, accountRow.connection_item_id),
    account_group_key: accountGroup.key,
    account_group_label: accountGroup.label,
    branch:
      typeof row['branch'] === 'string'
        ? row['branch']
        : (readFieldString(row, 'bank_branch') ?? details.bankData?.branch ?? null),
    account:
      typeof row['account'] === 'string'
        ? row['account']
        : (readFieldString(row, 'bank_account') ?? details.bankData?.account ?? null),
    transfer_number:
      typeof row['transfer_number'] === 'string'
        ? row['transfer_number']
        : (readFieldString(row, 'bank_transfer_number') ??
          details.bankData?.transferNumber ??
          null),
    credit_data: creditData,
    merged_account_ids: mergedAccountIds,
  };
}

function readAccountRow(row: Record<string, unknown>): AccountRow {
  return {
    id: String(row['id']),
    connection_item_id: String(row['connection_item_id']),
    type: String(row['type'] ?? 'UNKNOWN'),
    subtype: readFieldString(row, 'subtype'),
    name: readFieldString(row, 'name'),
    number: readFieldString(row, 'number'),
    owner: readFieldString(row, 'owner'),
    balance_cents: typeof row['balance_cents'] === 'number' ? row['balance_cents'] : null,
    currency: String(row['currency'] ?? 'BRL'),
    raw_json: typeof row['raw_json'] === 'string' ? row['raw_json'] : '{}',
    synced_at: String(row['synced_at'] ?? ''),
    connector_name: readFieldString(row, 'connector_name'),
    credit_brand: readFieldString(row, 'credit_brand'),
    credit_level: readFieldString(row, 'credit_level'),
    credit_limit_cents:
      typeof row['credit_limit_cents'] === 'number' ? row['credit_limit_cents'] : null,
    credit_available_limit_cents:
      typeof row['credit_available_limit_cents'] === 'number'
        ? row['credit_available_limit_cents']
        : null,
    credit_minimum_payment_cents:
      typeof row['credit_minimum_payment_cents'] === 'number'
        ? row['credit_minimum_payment_cents']
        : null,
    credit_balance_close_date: readFieldString(row, 'credit_balance_close_date'),
    credit_balance_due_date: readFieldString(row, 'credit_balance_due_date'),
    credit_status: readFieldString(row, 'credit_status'),
    bank_transfer_number: readFieldString(row, 'bank_transfer_number'),
    bank_branch: readFieldString(row, 'bank_branch'),
    bank_account: readFieldString(row, 'bank_account'),
  };
}

export function resolveAccountGroupKey(
  account: EnrichedAccount,
  field: AccountGroupByField | CreditCardGroupByField,
): { readonly key: string; readonly label: string } {
  switch (field) {
    case 'account':
      return {
        key: account.account_group_key,
        label: account.account_group_label,
      };
    case 'type':
      return {
        key: account.type,
        label: account.type,
      };
    case 'subtype':
      return {
        key: account.subtype ?? 'UNKNOWN',
        label: account.subtype ?? 'UNKNOWN',
      };
    default:
      return { key: 'UNKNOWN', label: 'UNKNOWN' };
  }
}

export function resolveCreditCardGroupKey(
  creditCard: EnrichedAccount,
  field: CreditCardGroupByField,
): { readonly key: string; readonly label: string } {
  return resolveAccountGroupKey(creditCard, field);
}
