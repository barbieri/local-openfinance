import type { DatabaseSync } from 'node:sqlite';
import { readFieldString } from '../openfinance/money.js';
import { parseAccountRawJson, resolveAccountDisplayNameFromRow } from './account-details.js';
import { getAccountLabel } from './account-labels.js';
import { formatCurrency } from './terminal-format.js';
import {
  isForeignCurrencyTransaction,
  TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL,
} from './transaction-foreign-amount.js';

export type ConnectionLabel = {
  readonly itemId: string;
  readonly branch: string | null;
  readonly account: string | null;
  readonly name: string | null;
  readonly updatedAt: string;
};

export type ConnectionLabelInput = {
  readonly branch?: string | undefined;
  readonly account?: string | undefined;
  readonly name?: string | undefined;
};

export type LabeledConnectionRow = {
  readonly itemId: string;
  readonly connectorId: string | null;
  readonly connectorName: string | null;
  readonly status: string | null;
  readonly label: ConnectionLabel | null;
  readonly accountSummary: string | null;
};

export type ConnectionRecentTransaction = {
  readonly occurredAt: string;
  readonly amountCents: number;
  readonly amountInAccountCurrencyCents: number;
  readonly currency: string;
  readonly accountCurrency: string;
  readonly description: string | null;
  readonly accountName: string | null;
};

const DEFAULT_RECENT_TRANSACTION_LIMIT = 5;

function readLabelRow(row: Record<string, unknown> | undefined): ConnectionLabel | null {
  if (!row || typeof row['item_id'] !== 'string') {
    return null;
  }
  if (row['updated_at'] === null || row['updated_at'] === undefined) {
    return null;
  }

  return {
    itemId: row['item_id'],
    branch: typeof row['branch'] === 'string' ? row['branch'] : null,
    account: typeof row['account'] === 'string' ? row['account'] : null,
    name: typeof row['name'] === 'string' ? row['name'] : null,
    updatedAt: String(row['updated_at']),
  };
}

export function getConnectionLabel(db: DatabaseSync, itemId: string): ConnectionLabel | null {
  const row = db
    .prepare(
      `SELECT item_id, branch, account, name, updated_at
       FROM connection_labels
       WHERE item_id = ?`,
    )
    .get(itemId) as Record<string, unknown> | undefined;

  return readLabelRow(row);
}

export function upsertConnectionLabel(
  db: DatabaseSync,
  itemId: string,
  input: ConnectionLabelInput,
): ConnectionLabel {
  const existing = getConnectionLabel(db, itemId);
  const now = new Date().toISOString();
  const branch =
    input.branch !== undefined ? normalizeOptionalText(input.branch) : (existing?.branch ?? null);
  const account =
    input.account !== undefined
      ? normalizeOptionalText(input.account)
      : (existing?.account ?? null);
  const name =
    input.name !== undefined ? normalizeOptionalText(input.name) : (existing?.name ?? null);

  db.prepare(
    `INSERT INTO connection_labels (item_id, branch, account, name, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       branch = excluded.branch,
       account = excluded.account,
       name = excluded.name,
       updated_at = excluded.updated_at`,
  ).run(itemId, branch, account, name, now);

  return getConnectionLabel(db, itemId) ?? { itemId, branch, account, name, updatedAt: now };
}

export function deleteConnectionLabel(db: DatabaseSync, itemId: string): boolean {
  const result = db.prepare('DELETE FROM connection_labels WHERE item_id = ?').run(itemId);
  return result.changes > 0;
}

export function listLabeledConnections(db: DatabaseSync): LabeledConnectionRow[] {
  return db
    .prepare(
      `SELECT c.item_id, c.connector_id, c.connector_name, c.status,
              cl.branch, cl.account, cl.name, cl.updated_at,
              (
                SELECT GROUP_CONCAT(a.name, ' · ')
                FROM accounts a
                WHERE a.connection_item_id = c.item_id AND a.name IS NOT NULL
              ) AS account_summary
       FROM connections c
       LEFT JOIN connection_labels cl ON cl.item_id = c.item_id
       ORDER BY COALESCE(cl.name, c.connector_name, c.item_id), c.item_id`,
    )
    .all()
    .map((row) => {
      const record = row as Record<string, unknown>;
      const itemId = String(record['item_id']);
      return {
        itemId,
        connectorId: typeof record['connector_id'] === 'string' ? record['connector_id'] : null,
        connectorName:
          typeof record['connector_name'] === 'string' ? record['connector_name'] : null,
        status: typeof record['status'] === 'string' ? record['status'] : null,
        label: readLabelRow(record),
        accountSummary:
          typeof record['account_summary'] === 'string' ? record['account_summary'] : null,
      };
    });
}

export function formatConnectionLabel(label: ConnectionLabel | null): string | null {
  if (!label?.name) {
    return null;
  }

  const parts = [label.name];
  if (label.branch) {
    parts.push(`ag ${label.branch}`);
  }
  if (label.account) {
    parts.push(`cc ${label.account}`);
  }
  return parts.join(' · ');
}

export function listConnectionRecentTransactions(
  db: DatabaseSync,
  itemId: string,
  limit = DEFAULT_RECENT_TRANSACTION_LIMIT,
): ConnectionRecentTransaction[] {
  return db
    .prepare(
      `SELECT t.occurred_at, t.amount_cents, t.currency,
              ${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL} AS amount_in_account_currency_cents,
              a.currency AS account_currency, t.description, a.name AS account_name
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE a.connection_item_id = ?
       ORDER BY t.occurred_at DESC
       LIMIT ?`,
    )
    .all(itemId, limit)
    .map(mapRecentTransactionRow);
}

export function listAccountRecentTransactions(
  db: DatabaseSync,
  accountId: string,
  limit = DEFAULT_RECENT_TRANSACTION_LIMIT,
): ConnectionRecentTransaction[] {
  return db
    .prepare(
      `SELECT t.occurred_at, t.amount_cents, t.currency,
              ${TRANSACTION_ACCOUNT_AMOUNT_CENTS_SQL} AS amount_in_account_currency_cents,
              a.currency AS account_currency, t.description, a.name AS account_name
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.account_id = ?
       ORDER BY t.occurred_at DESC
       LIMIT ?`,
    )
    .all(accountId, limit)
    .map(mapRecentTransactionRow);
}

function mapRecentTransactionRow(row: unknown): ConnectionRecentTransaction {
  const record = row as Record<string, unknown>;
  return {
    occurredAt: String(record['occurred_at']),
    amountCents: Number(record['amount_cents']),
    amountInAccountCurrencyCents: Number(record['amount_in_account_currency_cents']),
    currency: String(record['currency']),
    accountCurrency: String(record['account_currency'] ?? record['currency']),
    description: typeof record['description'] === 'string' ? record['description'] : null,
    accountName: typeof record['account_name'] === 'string' ? record['account_name'] : null,
  };
}

export function formatConnectionRecentTransaction(
  transaction: ConnectionRecentTransaction,
): string {
  const date = transaction.occurredAt.slice(0, 10);
  const amountLabel = isForeignCurrencyTransaction(
    transaction.currency,
    transaction.accountCurrency,
  )
    ? `${formatCurrency(transaction.amountCents, transaction.currency)} (${formatCurrency(
        transaction.amountInAccountCurrencyCents,
        transaction.accountCurrency,
      )})`
    : formatCurrency(transaction.amountInAccountCurrencyCents, transaction.accountCurrency);
  const description = truncateText(transaction.description ?? '(no description)', 48);
  const accountPrefix = transaction.accountName ? `${transaction.accountName}: ` : '';
  return `${date} · ${amountLabel} · ${accountPrefix}${description}`;
}

export function formatConnectionRecentTransactions(
  transactions: readonly ConnectionRecentTransaction[],
  emptyMessage = 'No recent transactions',
): string {
  if (transactions.length === 0) {
    return emptyMessage;
  }

  return transactions.map(formatConnectionRecentTransaction).join('\n');
}

export function formatConnectionSelectionHeadline(
  db: DatabaseSync,
  connection: LabeledConnectionRow,
): string {
  const displayName =
    formatConnectionLabel(connection.label) ?? resolveConnectionDisplayName(db, connection.itemId);
  if (displayName) {
    return displayName;
  }

  const connector = connection.connectorName ?? 'unknown bank';
  const connectorId = connection.connectorId ? ` (${connection.connectorId})` : '';
  return `${connector}${connectorId}`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

export function resolveConnectionDisplayName(db: DatabaseSync, itemId: string): string | null {
  const formatted = formatConnectionLabel(getConnectionLabel(db, itemId));
  if (formatted) {
    return formatted;
  }

  const accounts = db
    .prepare(
      `SELECT id, name, type, subtype, number, raw_json
       FROM accounts
       WHERE connection_item_id = ?
       ORDER BY type ASC, COALESCE(name, id), id ASC`,
    )
    .all(itemId) as Record<string, unknown>[];

  if (accounts.length === 0) {
    return null;
  }

  const names = [
    ...new Set(accounts.map((row) => resolveAccountDisplayName(db, String(row['id'])))),
  ];

  return names.length > 0 ? names.join(' · ') : null;
}

export function resolveAccountDisplayName(db: DatabaseSync, accountId: string): string {
  const label = getAccountLabel(db, accountId);
  if (label) {
    return label.name;
  }

  const row = db
    .prepare(
      `SELECT a.id, a.name, a.type, a.subtype, a.number, a.connection_item_id, a.raw_json
       FROM accounts a
       WHERE a.id = ?`,
    )
    .get(accountId) as Record<string, unknown> | undefined;

  if (!row) {
    return accountId;
  }

  return resolveAccountDisplayNameFromRow(row);
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function enrichListRows(
  db: DatabaseSync,
  entityName: string,
  rows: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((row) => enrichListRow(db, entityName, row));
}

function enrichListRow(
  db: DatabaseSync,
  entityName: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  switch (entityName) {
    case 'connections':
      return enrichConnectionRow(db, row);
    case 'accounts':
    case 'credit-cards':
      return enrichAccountRow(db, row);
    case 'transactions':
    case 'credit-card-bills':
      return enrichAccountReferenceRow(db, row);
    case 'investments':
    case 'loans':
      return enrichConnectionReferenceRow(db, row);
    default:
      return row;
  }
}

function enrichConnectionRow(
  db: DatabaseSync,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const itemId = String(row['item_id']);
  const label = getConnectionLabel(db, itemId);
  const displayName = resolveConnectionDisplayName(db, itemId);
  const upstreamConnectorId = readFieldString(row, 'connector_id');
  const upstreamConnectorName = readFieldString(row, 'connector_name');

  return {
    ...row,
    upstream_connector_id: upstreamConnectorId,
    upstream_connector_name: upstreamConnectorName,
    label_name: label?.name ?? null,
    branch: label?.branch ?? null,
    account: label?.account ?? null,
    display_name: displayName,
    ...(label?.name
      ? {
          name: label.name,
          connector_name: label.name,
        }
      : {}),
  };
}

function enrichAccountRow(db: DatabaseSync, row: Record<string, unknown>): Record<string, unknown> {
  const accountId = String(row['id']);
  const connectionItemId = String(row['connection_item_id']);
  const accountType = String(row['type'] ?? 'UNKNOWN');
  const label = getConnectionLabel(db, connectionItemId);
  const rawJson = typeof row['raw_json'] === 'string' ? row['raw_json'] : '{}';
  const details = parseAccountRawJson(rawJson);
  const displayName = resolveAccountDisplayName(db, accountId);
  const connectionDisplayName = resolveConnectionDisplayName(db, connectionItemId);
  const branch =
    accountType === 'BANK' ? (details.bankData?.branch ?? label?.branch ?? null) : null;
  const account =
    accountType === 'BANK' ? (details.bankData?.account ?? label?.account ?? null) : null;

  return {
    ...row,
    branch,
    account,
    display_name: displayName,
    connection_display_name: connectionDisplayName,
    connection_item_id: connectionItemId,
    ...(details.creditData ? { credit_data: details.creditData } : {}),
    ...(details.bankData?.transferNumber
      ? { transfer_number: details.bankData.transferNumber }
      : {}),
  };
}

function enrichAccountReferenceRow(
  db: DatabaseSync,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const accountId = typeof row['account_id'] === 'string' ? row['account_id'] : null;
  if (!accountId) {
    return row;
  }

  return {
    ...row,
    account_display_name: resolveAccountDisplayName(db, accountId),
    account_id: accountId,
  };
}

function enrichConnectionReferenceRow(
  db: DatabaseSync,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const itemId = typeof row['connection_item_id'] === 'string' ? row['connection_item_id'] : null;
  if (!itemId) {
    return row;
  }

  return {
    ...row,
    connection_display_name: resolveConnectionDisplayName(db, itemId),
    connection_item_id: itemId,
  };
}
