import type { DatabaseSync } from 'node:sqlite';
import { readFieldString } from '../openfinance/money.js';
import { parseTransactionCreditCardMetadata } from '../openfinance/transaction-metadata.js';
import { addCalendarDays } from '../utils/calendar-days.js';
import { creditDataFromAccountRow } from './account-details.js';

export type CreditCardBillLinkSource = 'transaction_metadata' | 'inferred' | 'manual';

export type CreditCardBillLink = {
  readonly bill_id: string;
  readonly transaction_id: string;
  readonly source: CreditCardBillLinkSource;
  readonly confidence: number;
  readonly bill_due_date: string | null;
};

const LINK_SELECT_SQL = `
  SELECT cbt.bill_id, cbt.transaction_id, cbt.source, cbt.confidence, b.due_date AS bill_due_date
  FROM credit_card_bill_transactions cbt
  JOIN credit_card_bills b ON b.id = cbt.bill_id
  WHERE cbt.transaction_id = ?`;

export function loadCreditCardBillLink(
  db: DatabaseSync,
  transactionId: string,
): CreditCardBillLink | null {
  const row = db.prepare(LINK_SELECT_SQL).get(transactionId) as Record<string, unknown> | undefined;
  return row ? mapBillLinkRow(row) : null;
}

export function loadCreditCardBillLinksForTransactions(
  db: DatabaseSync,
  transactionIds: readonly string[],
): Map<string, CreditCardBillLink> {
  if (transactionIds.length === 0) {
    return new Map();
  }

  const placeholders = transactionIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT cbt.bill_id, cbt.transaction_id, cbt.source, cbt.confidence, b.due_date AS bill_due_date
       FROM credit_card_bill_transactions cbt
       JOIN credit_card_bills b ON b.id = cbt.bill_id
       WHERE cbt.transaction_id IN (${placeholders})`,
    )
    .all(...transactionIds) as Record<string, unknown>[];

  const map = new Map<string, CreditCardBillLink>();
  for (const row of rows) {
    const link = mapBillLinkRow(row);
    map.set(link.transaction_id, link);
  }
  return map;
}

export function syncCreditCardBillLinksForAccount(
  db: DatabaseSync,
  accountId: string,
  syncedAt: string,
): { readonly metadata: number; readonly inferred: number } {
  const metadataCount = linkTransactionsFromMetadata(db, accountId, syncedAt);
  const inferredCount = linkTransactionsInferred(db, accountId, syncedAt);
  return { metadata: metadataCount, inferred: inferredCount };
}

export function setManualCreditCardBillLink(
  db: DatabaseSync,
  transactionId: string,
  billId: string,
  syncedAt: string,
): void {
  const bill = db
    .prepare('SELECT id, account_id FROM credit_card_bills WHERE id = ?')
    .get(billId) as Record<string, unknown> | undefined;
  if (!bill) {
    throw new Error('Bill not found');
  }

  const transaction = db
    .prepare('SELECT id, account_id FROM transactions WHERE id = ?')
    .get(transactionId) as Record<string, unknown> | undefined;
  if (!transaction) {
    throw new Error('Transaction not found');
  }
  if (String(transaction['account_id']) !== String(bill['account_id'])) {
    throw new Error('Bill and transaction must belong to the same credit card account');
  }

  const existing = loadCreditCardBillLink(db, transactionId);
  if (existing?.source === 'transaction_metadata') {
    throw new Error('Cannot override a bill link provided by transaction metadata');
  }

  db.prepare('DELETE FROM credit_card_bill_transactions WHERE transaction_id = ?').run(
    transactionId,
  );
  upsertBillLink(db, billId, transactionId, 'manual', 100, syncedAt);
}

export function canChangeCreditCardBillLink(
  db: DatabaseSync,
  transactionId: string,
  rawJson: string,
): boolean {
  const parsed = parseTransactionCreditCardMetadata(rawJson);
  if (parsed.bill_id) {
    return false;
  }
  const existing = loadCreditCardBillLink(db, transactionId);
  return !existing || existing.source === 'inferred';
}

function linkTransactionsFromMetadata(
  db: DatabaseSync,
  accountId: string,
  syncedAt: string,
): number {
  const rows = db
    .prepare(
      `SELECT t.id, t.raw_json
       FROM transactions t
       WHERE t.account_id = ?`,
    )
    .all(accountId) as Record<string, unknown>[];

  let count = 0;
  for (const row of rows) {
    const transactionId = String(row['id']);
    const parsed = parseTransactionCreditCardMetadata(String(row['raw_json'] ?? '{}'));
    const billId = parsed.bill_id;
    if (!billId) {
      continue;
    }

    const billExists = db
      .prepare('SELECT 1 FROM credit_card_bills WHERE id = ? AND account_id = ?')
      .get(billId, accountId);
    if (!billExists) {
      continue;
    }

    const existing = loadCreditCardBillLink(db, transactionId);
    if (existing?.source === 'manual') {
      continue;
    }

    db.prepare('DELETE FROM credit_card_bill_transactions WHERE transaction_id = ?').run(
      transactionId,
    );
    upsertBillLink(db, billId, transactionId, 'transaction_metadata', 100, syncedAt);
    count += 1;
  }
  return count;
}

function linkTransactionsInferred(db: DatabaseSync, accountId: string, syncedAt: string): number {
  const bills = db
    .prepare(
      `SELECT id, due_date
       FROM credit_card_bills
       WHERE account_id = ?
       ORDER BY due_date ASC`,
    )
    .all(accountId) as Record<string, unknown>[];

  if (bills.length === 0) {
    return 0;
  }

  const accountRow = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
    | Record<string, unknown>
    | undefined;
  const closingDay = resolveClosingDay(accountRow);

  const windows = buildStatementWindows(bills, closingDay);
  const transactions = db
    .prepare(
      `SELECT t.id, t.occurred_at, t.raw_json
       FROM transactions t
       WHERE t.account_id = ?`,
    )
    .all(accountId) as Record<string, unknown>[];

  let count = 0;
  for (const row of transactions) {
    const transactionId = String(row['id']);
    const parsed = parseTransactionCreditCardMetadata(String(row['raw_json'] ?? '{}'));
    if (parsed.bill_id) {
      continue;
    }

    const existing = loadCreditCardBillLink(db, transactionId);
    if (existing && (existing.source === 'manual' || existing.source === 'transaction_metadata')) {
      continue;
    }

    const localDate = String(row['occurred_at']).slice(0, 10);
    const window = resolveStatementWindowForDate(windows, localDate);
    if (!window) {
      continue;
    }

    if (existing?.source === 'inferred' && existing.bill_id === window.billId) {
      continue;
    }

    db.prepare('DELETE FROM credit_card_bill_transactions WHERE transaction_id = ?').run(
      transactionId,
    );
    upsertBillLink(db, window.billId, transactionId, 'inferred', window.confidence, syncedAt);
    count += 1;
  }
  return count;
}

type StatementWindow = {
  readonly billId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly confidence: number;
};

function resolveStatementWindowForDate(
  windows: readonly StatementWindow[],
  localDate: string,
): StatementWindow | undefined {
  for (const entry of windows) {
    if (localDate >= entry.startDate && localDate <= entry.endDate) {
      return entry;
    }
  }
  return undefined;
}

function buildStatementWindows(
  bills: readonly Record<string, unknown>[],
  closingDay: number | null,
): StatementWindow[] {
  const sorted = bills.toSorted((a, b) =>
    String(a['due_date']).localeCompare(String(b['due_date'])),
  );

  const windows: StatementWindow[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const bill = sorted[index];
    if (!bill) {
      continue;
    }
    const billId = String(bill['id']);
    const dueDate = String(bill['due_date']).slice(0, 10);

    if (closingDay !== null) {
      const endDate = statementEndDateForDueDate(dueDate, closingDay);
      const previousBill = index > 0 ? sorted[index - 1] : null;
      const startDate = previousBill
        ? addCalendarDays(
            statementEndDateForDueDate(String(previousBill['due_date']).slice(0, 10), closingDay),
            1,
          )
        : addCalendarDays(addMonths(endDate, -1), 1);
      windows.push({ billId, startDate, endDate, confidence: 85 });
      continue;
    }

    const previousBill = index > 0 ? sorted[index - 1] : null;
    const endDate = dueDate;
    const startDate = previousBill
      ? addCalendarDays(String(previousBill['due_date']).slice(0, 10), 1)
      : `${endDate.slice(0, 7)}-01`;
    windows.push({ billId, startDate, endDate, confidence: 60 });
  }
  return windows;
}

function addMonths(dateKey: string, months: number): string {
  const date = new Date(`${dateKey.slice(0, 10)}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function statementEndDateForDueDate(dueDate: string, closingDay: number): string {
  const due = new Date(`${dueDate}T12:00:00`);
  let year = due.getUTCFullYear();
  let month = due.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(closingDay, lastDay);
  let end = new Date(Date.UTC(year, month, day));
  if (end > due) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    const prevLastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    end = new Date(Date.UTC(year, month, Math.min(closingDay, prevLastDay)));
  }
  return end.toISOString().slice(0, 10);
}

function resolveClosingDay(accountRow: Record<string, unknown> | undefined): number | null {
  if (!accountRow) {
    return null;
  }
  const creditData = creditDataFromAccountRow(accountRow);
  const closeDate = creditData?.balance_close_date;
  if (!closeDate) {
    return null;
  }
  const day = Number.parseInt(closeDate.slice(8, 10), 10);
  return Number.isFinite(day) && day >= 1 && day <= 31 ? day : null;
}

function upsertBillLink(
  db: DatabaseSync,
  billId: string,
  transactionId: string,
  source: CreditCardBillLinkSource,
  confidence: number,
  syncedAt: string,
): void {
  db.prepare(
    `INSERT INTO credit_card_bill_transactions (
      bill_id, transaction_id, source, confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(bill_id, transaction_id) DO UPDATE SET
      source = excluded.source,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at`,
  ).run(billId, transactionId, source, confidence, syncedAt, syncedAt);
}

function mapBillLinkRow(row: Record<string, unknown>): CreditCardBillLink {
  return {
    bill_id: String(row['bill_id']),
    transaction_id: String(row['transaction_id']),
    source: String(row['source']) as CreditCardBillLinkSource,
    confidence: Number(row['confidence'] ?? 100),
    bill_due_date: readFieldString(row, 'bill_due_date'),
  };
}
