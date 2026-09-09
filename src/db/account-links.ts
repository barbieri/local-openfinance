import type { DatabaseSync } from 'node:sqlite';
import { parseAccountRawJson } from './account-details.js';
import {
  formatConnectionRecentTransactions,
  listAccountRecentTransactions,
  resolveAccountDisplayName,
} from './connection-labels.js';

export type AccountGroupMember = {
  readonly accountId: string;
  readonly isCanonical: boolean;
};

export type AccountGroup = {
  readonly canonicalAccountId: string;
  readonly members: readonly AccountGroupMember[];
  readonly createdAt: string;
};

export type LinkableAccountRow = {
  readonly id: string;
  readonly connectionItemId: string;
  readonly type: string;
  readonly subtype: string | null;
  readonly transferNumber: string | null;
  readonly name: string | null;
  readonly number: string | null;
  readonly canonicalAccountId: string | null;
  readonly isCanonical: boolean;
  readonly isAlias: boolean;
};

export type AccountIdentity = {
  readonly type: string;
  readonly subtype: string | null;
  readonly transferNumber: string | null;
  readonly name: string | null;
  readonly number: string | null;
};

export type SuggestedDuplicateGroup = AccountIdentity & {
  readonly identityKey: string;
  readonly accounts: readonly LinkableAccountRow[];
};

export type LinkedAccountGroupSummary = {
  readonly canonicalAccountId: string;
  readonly aliasAccountIds: readonly string[];
  readonly members: readonly AccountGroupMember[];
};

export const VISIBLE_ACCOUNTS_WHERE = `id NOT IN (
  SELECT account_id FROM account_group_members WHERE is_canonical = 0
)`;

export const VISIBLE_ACCOUNT_TRANSACTIONS_WHERE = `account_id NOT IN (
  SELECT account_id FROM account_group_members WHERE is_canonical = 0
)`;

export function isMergedAlias(db: DatabaseSync, accountId: string): boolean {
  const row = db
    .prepare('SELECT is_canonical FROM account_group_members WHERE account_id = ?')
    .get(accountId) as { readonly is_canonical: number } | undefined;

  return row?.is_canonical === 0;
}

export function resolveCanonicalAccountId(db: DatabaseSync, accountId: string): string {
  const row = db
    .prepare('SELECT group_id FROM account_group_members WHERE account_id = ?')
    .get(accountId) as { readonly group_id: string } | undefined;

  return row?.group_id ?? accountId;
}

export function getAccountGroup(db: DatabaseSync, canonicalAccountId: string): AccountGroup | null {
  const group = db
    .prepare(
      'SELECT canonical_account_id, created_at FROM account_groups WHERE canonical_account_id = ?',
    )
    .get(canonicalAccountId) as Record<string, unknown> | undefined;

  if (!group) {
    return null;
  }

  const members = db
    .prepare(
      `SELECT account_id, is_canonical
       FROM account_group_members
       WHERE group_id = ?
       ORDER BY is_canonical DESC, account_id ASC`,
    )
    .all(canonicalAccountId)
    .map((row) => {
      const record = row as Record<string, unknown>;
      return {
        accountId: String(record['account_id']),
        isCanonical: Number(record['is_canonical']) === 1,
      };
    });

  return {
    canonicalAccountId,
    members,
    createdAt: String(group['created_at']),
  };
}

export function getAliasAccountIds(db: DatabaseSync, canonicalAccountId: string): string[] {
  return db
    .prepare(
      `SELECT account_id FROM account_group_members
       WHERE group_id = ? AND is_canonical = 0
       ORDER BY account_id ASC`,
    )
    .all(canonicalAccountId)
    .map((row) => String((row as Record<string, unknown>)['account_id']));
}

export function listLinkableAccounts(db: DatabaseSync): LinkableAccountRow[] {
  return db
    .prepare(
      `SELECT a.id, a.connection_item_id, a.type, a.subtype, a.name, a.number, a.raw_json,
              agm.group_id, agm.is_canonical
       FROM accounts a
       LEFT JOIN account_group_members agm ON agm.account_id = a.id
       ORDER BY a.type ASC, COALESCE(a.name, a.number, a.id), a.id ASC`,
    )
    .all()
    .map((row) => {
      const record = row as Record<string, unknown>;
      const rawCanonical = record['is_canonical'];
      const isCanonical =
        rawCanonical !== null && rawCanonical !== undefined && Number(rawCanonical) === 1;
      const isAlias =
        rawCanonical !== null && rawCanonical !== undefined && Number(rawCanonical) === 0;
      const type = String(record['type']);
      const subtype = typeof record['subtype'] === 'string' ? record['subtype'] : null;
      const rawJson = typeof record['raw_json'] === 'string' ? record['raw_json'] : '{}';
      const identity = resolveAccountIdentity(type, subtype, rawJson);

      return {
        id: String(record['id']),
        connectionItemId: String(record['connection_item_id']),
        type: identity.type,
        subtype: identity.subtype,
        transferNumber: identity.transferNumber,
        name: typeof record['name'] === 'string' ? record['name'] : null,
        number: typeof record['number'] === 'string' ? record['number'] : null,
        canonicalAccountId: typeof record['group_id'] === 'string' ? record['group_id'] : null,
        isCanonical,
        isAlias,
      };
    });
}

export function resolveAccountIdentity(
  type: string,
  subtype: string | null,
  rawJson: string,
): AccountIdentity {
  const details = parseAccountRawJson(rawJson);

  return {
    type,
    subtype,
    transferNumber: details.bankData?.transferNumber ?? null,
    name: null,
    number: null,
  };
}

export function buildAccountIdentityKey(identity: AccountIdentity): string {
  return [
    identity.type,
    identity.subtype ?? '',
    identity.transferNumber ?? '',
    identity.number ?? '',
    identity.name ?? '',
  ].join('|');
}

export function findSuggestedDuplicateGroups(db: DatabaseSync): SuggestedDuplicateGroup[] {
  const accounts = listLinkableAccounts(db).filter((account) => !account.isAlias);
  const buckets = new Map<string, LinkableAccountRow[]>();

  for (const account of accounts) {
    const key = buildAccountIdentityKey(account);
    const existing = buckets.get(key);
    buckets.set(key, existing ? [...existing, account] : [account]);
  }

  const suggestions: SuggestedDuplicateGroup[] = [];

  for (const [identityKey, groupAccounts] of buckets) {
    if (groupAccounts.length < 2) {
      continue;
    }

    const connectionIds = new Set(groupAccounts.map((account) => account.connectionItemId));
    if (connectionIds.size < 2) {
      continue;
    }

    if (isFullyLinkedDuplicateGroup(groupAccounts)) {
      continue;
    }

    const [first] = groupAccounts;
    if (!first) {
      continue;
    }

    suggestions.push({
      identityKey,
      type: first.type,
      subtype: first.subtype,
      transferNumber: first.transferNumber,
      name: first.name,
      number: first.number,
      accounts: groupAccounts.toSorted((left, right) => left.id.localeCompare(right.id)),
    });
  }

  return suggestions.sort((left, right) => left.identityKey.localeCompare(right.identityKey));
}

export function listLinkedAccountGroups(db: DatabaseSync): LinkedAccountGroupSummary[] {
  const summaries: LinkedAccountGroupSummary[] = [];

  for (const row of db
    .prepare('SELECT canonical_account_id FROM account_groups ORDER BY canonical_account_id ASC')
    .all()) {
    const canonicalAccountId = String((row as Record<string, unknown>)['canonical_account_id']);
    const group = getAccountGroup(db, canonicalAccountId);
    if (!group) {
      continue;
    }

    summaries.push({
      canonicalAccountId,
      aliasAccountIds: getAliasAccountIds(db, canonicalAccountId),
      members: group.members,
    });
  }

  return summaries;
}

export function formatAccountIdentitySummary(identity: AccountIdentity): string {
  return [identity.type, identity.subtype, identity.transferNumber, identity.number, identity.name]
    .filter(Boolean)
    .join(' · ');
}

export function linkAccounts(
  db: DatabaseSync,
  canonicalAccountId: string,
  aliasAccountIds: readonly string[],
): AccountGroup {
  assertAccountExists(db, canonicalAccountId);
  const uniqueAliases = [...new Set(aliasAccountIds.filter((id) => id !== canonicalAccountId))];

  for (const aliasId of uniqueAliases) {
    assertAccountExists(db, aliasId);
    assertCanJoinGroup(db, aliasId, canonicalAccountId);
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO account_groups (canonical_account_id, created_at)
     VALUES (?, ?)
     ON CONFLICT(canonical_account_id) DO NOTHING`,
  ).run(canonicalAccountId, now);

  db.prepare(
    `INSERT INTO account_group_members (group_id, account_id, is_canonical, created_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       group_id = excluded.group_id,
       is_canonical = excluded.is_canonical`,
  ).run(canonicalAccountId, canonicalAccountId, now);

  for (const aliasId of uniqueAliases) {
    db.prepare(
      `INSERT INTO account_group_members (group_id, account_id, is_canonical, created_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         group_id = excluded.group_id,
         is_canonical = excluded.is_canonical`,
    ).run(canonicalAccountId, aliasId, now);
  }

  const group = getAccountGroup(db, canonicalAccountId);
  if (!group) {
    throw new Error(`Failed to create account group for ${canonicalAccountId}`);
  }

  return group;
}

export function dissolveAccountGroup(db: DatabaseSync, canonicalAccountId: string): boolean {
  const result = db
    .prepare('DELETE FROM account_groups WHERE canonical_account_id = ?')
    .run(canonicalAccountId);
  return result.changes > 0;
}

export function unlinkAccountAlias(db: DatabaseSync, aliasAccountId: string): boolean {
  const row = db
    .prepare('SELECT group_id, is_canonical FROM account_group_members WHERE account_id = ?')
    .get(aliasAccountId) as
    | { readonly group_id: string; readonly is_canonical: number }
    | undefined;

  if (!row || row.is_canonical === 1) {
    return false;
  }

  db.prepare('DELETE FROM account_group_members WHERE account_id = ?').run(aliasAccountId);

  const remaining = db
    .prepare('SELECT COUNT(*) AS total FROM account_group_members WHERE group_id = ?')
    .get(row.group_id) as { readonly total: number };

  if (remaining.total <= 1) {
    dissolveAccountGroup(db, row.group_id);
  }

  return true;
}

export function formatLinkableAccountHeadline(
  db: DatabaseSync,
  account: LinkableAccountRow,
): string {
  const displayName = resolveAccountDisplayName(db, account.id);
  const suffix = account.isAlias ? ' · merged alias' : account.isCanonical ? ' · canonical' : '';
  return `${displayName}${suffix}`;
}

export function enrichAccountLinksListRows(
  db: DatabaseSync,
  entityName: string,
  rows: readonly Record<string, unknown>[],
): readonly Record<string, unknown>[] {
  if (entityName !== 'accounts' && entityName !== 'credit-cards') {
    return rows;
  }

  return rows.map((row) => {
    const mergedAccountIds = getAliasAccountIds(db, String(row['id']));
    if (mergedAccountIds.length === 0) {
      return row;
    }

    return {
      ...row,
      merged_account_ids: mergedAccountIds,
    };
  });
}

export function formatLinkableAccountRecentTransactions(
  db: DatabaseSync,
  account: LinkableAccountRow,
  limit = 3,
): string {
  return formatConnectionRecentTransactions(
    listAccountRecentTransactions(db, account.id, limit),
    'No recent transactions',
  );
}

function assertAccountExists(db: DatabaseSync, accountId: string): void {
  const row = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
  if (!row) {
    throw new Error(`Unknown account ${accountId}`);
  }
}

function assertCanJoinGroup(db: DatabaseSync, accountId: string, canonicalAccountId: string): void {
  const row = db
    .prepare('SELECT group_id, is_canonical FROM account_group_members WHERE account_id = ?')
    .get(accountId) as { readonly group_id: string; readonly is_canonical: number } | undefined;

  if (!row) {
    return;
  }

  if (row.group_id === canonicalAccountId) {
    return;
  }

  if (row.is_canonical === 1) {
    throw new Error(`Account ${accountId} is already canonical for another group`);
  }

  throw new Error(`Account ${accountId} is already merged into another account group`);
}

function isFullyLinkedDuplicateGroup(accounts: readonly LinkableAccountRow[]): boolean {
  const groupIds = accounts.map((account) => account.canonicalAccountId);
  if (groupIds.some((groupId) => groupId === null)) {
    return false;
  }

  const uniqueGroupIds = new Set(groupIds);
  return uniqueGroupIds.size === 1;
}
