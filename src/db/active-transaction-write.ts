import type { DatabaseSync } from 'node:sqlite';

export type ActiveEntry = {
  readonly entryType: 'transaction' | 'investment_transaction';
  readonly entryId: string;
};

type ActiveEntryType = ActiveEntry['entryType'];

export class EntryNotActiveError extends Error {
  readonly entries: readonly ActiveEntry[];

  constructor(entries: readonly ActiveEntry[], message = 'Entry not found') {
    super(message);
    this.name = 'EntryNotActiveError';
    this.entries = entries;
  }
}

export class TransactionNotActiveError extends EntryNotActiveError {
  readonly transactionIds: readonly string[];

  constructor(transactionIds: readonly string[]) {
    super(
      transactionIds.map((entryId) => ({ entryType: 'transaction', entryId })),
      'Transaction not found',
    );
    this.name = 'TransactionNotActiveError';
    this.transactionIds = transactionIds;
  }
}

const ACTIVE_ENTRY_TYPES = [
  'transaction',
  'investment_transaction',
] as const satisfies readonly ActiveEntryType[];

const ACTIVE_ENTRY_SELECT_SQL = {
  transaction: `SELECT id
                FROM transactions
                WHERE id IN (%PLACEHOLDERS%) AND deleted_at IS NULL`,
  investment_transaction: `SELECT it.id
                           FROM investment_transactions it
                           JOIN investments i ON i.id = it.investment_id
                           WHERE it.id IN (%PLACEHOLDERS%) AND i.deleted_at IS NULL`,
} as const satisfies Record<ActiveEntryType, string>;

function activeEntryKey(entry: ActiveEntry): string {
  return `${entry.entryType}\u0000${entry.entryId}`;
}

function uniqueNonBlankEntries(entries: readonly ActiveEntry[]): ActiveEntry[] {
  const uniqueEntryKeys = new Set<string>();
  const uniqueEntries: ActiveEntry[] = [];
  for (const entry of entries) {
    const normalized = { ...entry, entryId: entry.entryId.trim() };
    if (normalized.entryId && !uniqueEntryKeys.has(activeEntryKey(normalized))) {
      uniqueEntryKeys.add(activeEntryKey(normalized));
      uniqueEntries.push(normalized);
    }
  }
  return uniqueEntries;
}

function entryIdsForType(entries: readonly ActiveEntry[], entryType: ActiveEntryType): string[] {
  const entryIds: string[] = [];
  for (const entry of entries) {
    if (entry.entryType === entryType) {
      entryIds.push(entry.entryId);
    }
  }
  return entryIds;
}

function loadActiveEntryKeys(db: DatabaseSync, entries: readonly ActiveEntry[]): Set<string> {
  const activeEntryKeys = new Set<string>();
  for (const entryType of ACTIVE_ENTRY_TYPES) {
    const entryIds = entryIdsForType(entries, entryType);
    if (entryIds.length === 0) {
      continue;
    }

    const placeholders = entryIds.map(() => '?').join(', ');
    const rows = db
      .prepare(ACTIVE_ENTRY_SELECT_SQL[entryType].replace('%PLACEHOLDERS%', placeholders))
      .all(...entryIds) as Array<{ readonly id: string }>;
    for (const row of rows) {
      activeEntryKeys.add(activeEntryKey({ entryType, entryId: row.id }));
    }
  }
  return activeEntryKeys;
}

function throwForInactiveEntries(entries: readonly ActiveEntry[]): never {
  if (entries.every((entry) => entry.entryType === 'transaction')) {
    throw new TransactionNotActiveError(entries.map((entry) => entry.entryId));
  }
  throw new EntryNotActiveError(entries);
}

export function withActiveEntryWrite(
  db: DatabaseSync,
  entries: readonly ActiveEntry[],
  write: () => undefined,
): void {
  const uniqueEntries = uniqueNonBlankEntries(entries);
  if (uniqueEntries.length === 0) {
    throw new EntryNotActiveError([]);
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const activeEntryKeys = loadActiveEntryKeys(db, uniqueEntries);
    const inactiveEntries = uniqueEntries.filter(
      (entry) => !activeEntryKeys.has(activeEntryKey(entry)),
    );
    if (inactiveEntries.length > 0) {
      throwForInactiveEntries(inactiveEntries);
    }

    write();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function withActiveTransactionWrite(
  db: DatabaseSync,
  transactionIds: readonly string[],
  write: () => undefined,
): void {
  try {
    withActiveEntryWrite(
      db,
      transactionIds.map((entryId) => ({ entryType: 'transaction', entryId })),
      write,
    );
  } catch (error) {
    if (error instanceof EntryNotActiveError && !(error instanceof TransactionNotActiveError)) {
      throw new TransactionNotActiveError(error.entries.map((entry) => entry.entryId));
    }
    throw error;
  }
}
