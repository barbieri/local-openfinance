import type { DatabaseSync } from 'node:sqlite';
import { readFieldString, readRecord } from '../money.js';

export function loadKnownIds(
  db: DatabaseSync,
  table: 'transactions' | 'investment_transactions' | 'credit_card_bills' | 'investments',
  scopeColumn: string,
  scopeValue: string,
): ReadonlySet<string> {
  const rows = db
    .prepare(`SELECT id FROM ${table} WHERE ${scopeColumn} = ?`)
    .all(scopeValue) as Array<{ readonly id: string }>;
  return new Set(rows.map((row) => row.id));
}

export const FULL_SYNC_FROM_DATE = '1970-01-01';

export function resolveIncrementalFromDate(
  db: DatabaseSync,
  cursorKey: string,
  lookbackDays: number,
  initialLookbackDays = 30,
  forceFull = false,
  now = new Date(),
): string {
  if (forceFull) {
    return FULL_SYNC_FROM_DATE;
  }

  const row = db
    .prepare('SELECT cursor_value FROM sync_cursors WHERE resource = ?')
    .get(cursorKey) as { readonly cursor_value?: string } | undefined;

  if (!row?.cursor_value) {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - Math.max(lookbackDays, initialLookbackDays));
    return start.toISOString().slice(0, 10);
  }

  const cursorDate = new Date(row.cursor_value);
  const effectiveCursorDate = cursorDate > now ? new Date(now) : cursorDate;
  effectiveCursorDate.setUTCDate(effectiveCursorDate.getUTCDate() - lookbackDays);
  return effectiveCursorDate.toISOString().slice(0, 10);
}

/** Future-dated pending entries must not push an incremental cursor past the sync time. */
export function advanceSyncCursor(
  cursorValue: string,
  candidateValue: string,
  syncedAt: string,
): string {
  const valueDate = new Date(candidateValue);
  const syncDate = new Date(syncedAt);
  if (
    Number.isNaN(valueDate.getTime()) ||
    Number.isNaN(syncDate.getTime()) ||
    valueDate > syncDate ||
    candidateValue <= cursorValue
  ) {
    return cursorValue;
  }
  return candidateValue;
}

export function upsertSyncCursor(
  db: DatabaseSync,
  resource: string,
  cursorValue: string,
  syncedAt: string,
): void {
  db.prepare(`
    INSERT INTO sync_cursors (resource, cursor_value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(resource) DO UPDATE SET
      cursor_value = excluded.cursor_value,
      updated_at = excluded.updated_at
  `).run(resource, cursorValue, syncedAt);
}

export function toDateKey(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 10) {
    return null;
  }
  return trimmed.slice(0, 10);
}

export function oldestDateKeyOnPage(
  rows: readonly unknown[],
  readDate: (record: Record<string, unknown>) => string | null | undefined,
): string | null {
  let oldest: string | null = null;
  for (const item of rows) {
    const record = readRecord(item);
    if (!record) {
      continue;
    }
    const dateKey = toDateKey(readDate(record));
    if (!dateKey) {
      continue;
    }
    if (!oldest || dateKey < oldest) {
      oldest = dateKey;
    }
  }
  return oldest;
}

/** Stop when the oldest row on a page is before the overlap cutoff (API lists newest first). */
export function isPageBeforeCutoff(
  rows: readonly unknown[],
  cutoffDateKey: string,
  readDate: (record: Record<string, unknown>) => string | null | undefined,
): boolean {
  const oldest = oldestDateKeyOnPage(rows, readDate);
  return oldest !== null && oldest < cutoffDateKey;
}

export function readRowId(record: Record<string, unknown>, idField = 'id'): string | null {
  return readFieldString(record, idField);
}
