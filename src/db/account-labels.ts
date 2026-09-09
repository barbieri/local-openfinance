import type { DatabaseSync } from 'node:sqlite';

export type AccountLabel = {
  readonly accountId: string;
  readonly name: string;
  readonly updatedAt: string;
};

export type LabelableAccountRow = {
  readonly id: string;
  readonly connectionItemId: string;
  readonly type: string;
  readonly subtype: string | null;
  readonly connectorName: string | null;
  readonly label: AccountLabel | null;
};

function readLabelRow(row: Record<string, unknown> | undefined): AccountLabel | null {
  if (!row || typeof row['account_id'] !== 'string') {
    return null;
  }
  if (typeof row['name'] !== 'string' || row['name'].length === 0) {
    return null;
  }
  if (row['updated_at'] === null || row['updated_at'] === undefined) {
    return null;
  }

  return {
    accountId: row['account_id'],
    name: row['name'],
    updatedAt: String(row['updated_at']),
  };
}

function normalizeName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error('Account name cannot be empty');
  }

  return trimmed;
}

export function getAccountLabel(db: DatabaseSync, accountId: string): AccountLabel | null {
  const row = db
    .prepare(
      `SELECT account_id, name, updated_at
       FROM account_labels
       WHERE account_id = ?`,
    )
    .get(accountId) as Record<string, unknown> | undefined;

  return readLabelRow(row);
}

export function upsertAccountLabel(
  db: DatabaseSync,
  accountId: string,
  name: string,
): AccountLabel {
  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId) as
    | Record<string, unknown>
    | undefined;
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  const normalizedName = normalizeName(name);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO account_labels (account_id, name, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       name = excluded.name,
       updated_at = excluded.updated_at`,
  ).run(accountId, normalizedName, now);

  return (
    getAccountLabel(db, accountId) ?? {
      accountId,
      name: normalizedName,
      updatedAt: now,
    }
  );
}

export function deleteAccountLabel(db: DatabaseSync, accountId: string): boolean {
  const result = db.prepare('DELETE FROM account_labels WHERE account_id = ?').run(accountId);
  return result.changes > 0;
}

export function listLabelableAccounts(db: DatabaseSync): LabelableAccountRow[] {
  return db
    .prepare(
      `SELECT a.id, a.connection_item_id, a.type, a.subtype,
              c.connector_name,
              al.account_id, al.name, al.updated_at
       FROM accounts a
       JOIN connections c ON c.item_id = a.connection_item_id
       LEFT JOIN account_labels al ON al.account_id = a.id
       LEFT JOIN account_group_members agm ON agm.account_id = a.id
       WHERE agm.is_canonical IS NULL OR agm.is_canonical = 1
       ORDER BY a.type ASC, COALESCE(al.name, a.name, a.id), a.id ASC`,
    )
    .all()
    .map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: String(record['id']),
        connectionItemId: String(record['connection_item_id']),
        type: String(record['type'] ?? 'UNKNOWN'),
        subtype: typeof record['subtype'] === 'string' ? record['subtype'] : null,
        connectorName:
          typeof record['connector_name'] === 'string' ? record['connector_name'] : null,
        label: readLabelRow(record),
      };
    });
}
