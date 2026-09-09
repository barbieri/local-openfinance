import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  type AccountBalanceAnchor,
  buildAccountBalanceDailyPoints,
  iterateDateKeysInclusive,
} from '../src/chart/account-balance-over-time.js';
import type {
  BalanceChartDailyTotalRow,
  BalanceChartInitialSumRow,
} from '../src/db/balance-chart-query.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { loadTransactionChartSection } from '../src/db/transaction-charts.js';
import { createTransactionWebListFilters } from '../src/db/transaction-query.js';
import { toLocalDateKey } from '../src/utils/local-date.js';

const MESSAGES = {
  formatLimitedHistoryMessage: (date: string) => `limited before ${date}`,
  formatNoBankAccountsMessage: () => 'no bank accounts',
  formatMixedCurrenciesMessage: () => 'mixed currencies',
} as const;

const BASE_FILTERS = createTransactionWebListFilters();

type TestTransaction = {
  readonly accountId: string;
  readonly occurredAt: string;
  readonly amountCents: number;
};

function applyTestTransactionToAggregates(input: {
  readonly transaction: TestTransaction;
  readonly anchor: AccountBalanceAnchor;
  readonly displayStart: string;
  readonly timeZone: string;
  readonly initialByAccount: Map<string, number>;
  readonly dailyByAccountDate: Map<
    string,
    Map<string, { credit: number; debit: number; net: number }>
  >;
  readonly earliestByAccount: Map<string, string | null>;
}): void {
  const { transaction, anchor, displayStart, timeZone } = input;
  if (Date.parse(transaction.occurredAt) > Date.parse(anchor.syncedAt)) {
    return;
  }

  const localDate = toLocalDateKey(transaction.occurredAt, timeZone);
  const earliest = input.earliestByAccount.get(transaction.accountId) ?? null;
  if (earliest == null || localDate < earliest) {
    input.earliestByAccount.set(transaction.accountId, localDate);
  }

  if (localDate >= displayStart) {
    input.initialByAccount.set(
      transaction.accountId,
      (input.initialByAccount.get(transaction.accountId) ?? 0) + transaction.amountCents,
    );
  }

  const byDate = input.dailyByAccountDate.get(transaction.accountId) ?? new Map();
  const bucket = byDate.get(localDate) ?? { credit: 0, debit: 0, net: 0 };
  if (transaction.amountCents >= 0) {
    bucket.credit += transaction.amountCents;
  } else {
    bucket.debit += Math.abs(transaction.amountCents);
  }
  bucket.net += transaction.amountCents;
  byDate.set(localDate, bucket);
  input.dailyByAccountDate.set(transaction.accountId, byDate);
}

function deriveBalanceChartAggregates(input: {
  readonly anchors: readonly AccountBalanceAnchor[];
  readonly transactions: readonly TestTransaction[];
  readonly displayStart: string;
  readonly timeZone: string;
}): {
  readonly initialSums: BalanceChartInitialSumRow[];
  readonly dailyTotals: BalanceChartDailyTotalRow[];
  readonly earliestLocalDateByAccount: Map<string, string | null>;
} {
  const initialByAccount = new Map<string, number>();
  const dailyByAccountDate = new Map<
    string,
    Map<string, { credit: number; debit: number; net: number }>
  >();
  const earliestByAccount = new Map<string, string | null>();

  for (const anchor of input.anchors) {
    initialByAccount.set(anchor.accountId, 0);
    earliestByAccount.set(anchor.accountId, null);
  }

  for (const transaction of input.transactions) {
    const anchor = input.anchors.find((entry) => entry.accountId === transaction.accountId);
    if (!anchor) {
      continue;
    }
    applyTestTransactionToAggregates({
      transaction,
      anchor,
      displayStart: input.displayStart,
      timeZone: input.timeZone,
      initialByAccount,
      dailyByAccountDate,
      earliestByAccount,
    });
  }

  const initialSums = [...initialByAccount.entries()].map(([account_id, net_cents]) => ({
    account_id,
    net_cents,
  }));

  const dailyTotals: BalanceChartDailyTotalRow[] = [];
  for (const [account_id, byDate] of dailyByAccountDate.entries()) {
    for (const [local_date, totals] of byDate.entries()) {
      dailyTotals.push({
        account_id,
        local_date,
        credit_cents: totals.credit,
        debit_cents: totals.debit,
        net_cents: totals.net,
      });
    }
  }

  return {
    initialSums,
    dailyTotals,
    earliestLocalDateByAccount: earliestByAccount,
  };
}

function seedConnection(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itaú', 'UPDATED', '{}', '2026-06-22T12:00:00.000Z')`,
  ).run();
}

function seedBankAccount(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly balanceCents: number;
    readonly currency?: string;
    readonly syncedAt?: string;
  },
): void {
  db.prepare(
    `INSERT INTO accounts (
      id, connection_item_id, type, name, balance_cents, currency, raw_json, synced_at
    ) VALUES (?, 'item-1', 'BANK', ?, ?, ?, '{}', ?)`,
  ).run(
    input.id,
    input.id,
    input.balanceCents,
    input.currency ?? 'BRL',
    input.syncedAt ?? '2026-06-22T12:00:00.000Z',
  );
}

function seedCreditAccount(db: DatabaseSync, id: string): void {
  db.prepare(
    `INSERT INTO accounts (
      id, connection_item_id, type, name, balance_cents, currency, raw_json, synced_at
    ) VALUES (?, 'item-1', 'CREDIT', ?, -50000, 'BRL', '{}', '2026-06-22T12:00:00.000Z')`,
  ).run(id, id);
}

function seedTransaction(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly accountId: string;
    readonly occurredAt: string;
    readonly amountCents: number;
    readonly categoryId?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, merchant_name, category_id, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, 'BRL', 'Purchase', 'Shop', ?, '{}', '2026-06-22T12:00:00.000Z')`,
  ).run(input.id, input.accountId, input.occurredAt, input.amountCents, input.categoryId ?? null);
}

describe('buildAccountBalanceDailyPoints', () => {
  it('reconstructs backward balance for one account', () => {
    const anchors = [
      {
        accountId: 'acc-1',
        balanceCents: 1_000_000,
        syncedAt: '2026-06-22T12:00:00.000Z',
        currency: 'BRL',
      },
    ];
    const transactions = [
      { accountId: 'acc-1', occurredAt: '2026-06-11T12:00:00.000Z', amountCents: -50_000 },
      { accountId: 'acc-1', occurredAt: '2026-06-12T12:00:00.000Z', amountCents: -25_000 },
    ];
    const aggregates = deriveBalanceChartAggregates({
      anchors,
      transactions,
      displayStart: '2026-06-10',
      timeZone: 'UTC',
    });

    const { dailyBalance } = buildAccountBalanceDailyPoints({
      anchors,
      initialSums: aggregates.initialSums,
      dailyTotals: aggregates.dailyTotals,
      earliestLocalDateByAccount: aggregates.earliestLocalDateByAccount,
      startDate: '2026-06-10',
      endDate: '2026-06-12',
      timeZone: 'UTC',
      ...MESSAGES,
    });

    expect(dailyBalance).toEqual([
      {
        date: '2026-06-10',
        credit: 0,
        debit: 0,
        balance: 1_075_000,
        isEstimated: true,
      },
      {
        date: '2026-06-11',
        credit: 0,
        debit: 50_000,
        balance: 1_025_000,
        isEstimated: false,
      },
      {
        date: '2026-06-12',
        credit: 0,
        debit: 25_000,
        balance: 1_000_000,
        isEstimated: false,
      },
    ]);
  });

  it('includes same-day transactions in the ending balance', () => {
    const anchors = [
      {
        accountId: 'acc-1',
        balanceCents: 100_000,
        syncedAt: '2026-06-22T12:00:00.000Z',
        currency: 'BRL',
      },
    ];
    const transactions = [
      { accountId: 'acc-1', occurredAt: '2026-06-10T08:00:00.000Z', amountCents: -10_000 },
      { accountId: 'acc-1', occurredAt: '2026-06-10T18:00:00.000Z', amountCents: 5_000 },
    ];
    const aggregates = deriveBalanceChartAggregates({
      anchors,
      transactions,
      displayStart: '2026-06-10',
      timeZone: 'UTC',
    });

    const { dailyBalance } = buildAccountBalanceDailyPoints({
      anchors,
      initialSums: aggregates.initialSums,
      dailyTotals: aggregates.dailyTotals,
      earliestLocalDateByAccount: aggregates.earliestLocalDateByAccount,
      startDate: '2026-06-10',
      endDate: '2026-06-10',
      timeZone: 'UTC',
      ...MESSAGES,
    });

    expect(dailyBalance).toEqual([
      {
        date: '2026-06-10',
        credit: 5_000,
        debit: 10_000,
        balance: 100_000,
        isEstimated: false,
      },
    ]);
  });

  it('aggregates same-currency multi-account balances by date', () => {
    const anchors = [
      {
        accountId: 'acc-1',
        balanceCents: 100_000,
        syncedAt: '2026-06-22T12:00:00.000Z',
        currency: 'BRL',
      },
      {
        accountId: 'acc-2',
        balanceCents: 200_000,
        syncedAt: '2026-06-22T12:00:00.000Z',
        currency: 'BRL',
      },
    ];
    const transactions = [
      { accountId: 'acc-1', occurredAt: '2026-06-10T12:00:00.000Z', amountCents: -10_000 },
      { accountId: 'acc-2', occurredAt: '2026-06-10T12:00:00.000Z', amountCents: -20_000 },
    ];
    const aggregates = deriveBalanceChartAggregates({
      anchors,
      transactions,
      displayStart: '2026-06-10',
      timeZone: 'UTC',
    });

    const { dailyBalance } = buildAccountBalanceDailyPoints({
      anchors,
      initialSums: aggregates.initialSums,
      dailyTotals: aggregates.dailyTotals,
      earliestLocalDateByAccount: aggregates.earliestLocalDateByAccount,
      startDate: '2026-06-10',
      endDate: '2026-06-10',
      timeZone: 'UTC',
      ...MESSAGES,
    });

    expect(dailyBalance[0]).toEqual({
      date: '2026-06-10',
      credit: 0,
      debit: 30_000,
      balance: 300_000,
      isEstimated: false,
    });
  });

  it('blocks mixed-currency aggregation with a warning', () => {
    const result = buildAccountBalanceDailyPoints({
      anchors: [
        {
          accountId: 'acc-1',
          balanceCents: 100_000,
          syncedAt: '2026-06-22T12:00:00.000Z',
          currency: 'BRL',
        },
        {
          accountId: 'acc-2',
          balanceCents: 200_000,
          syncedAt: '2026-06-22T12:00:00.000Z',
          currency: 'USD',
        },
      ],
      initialSums: [],
      dailyTotals: [],
      earliestLocalDateByAccount: new Map(),
      startDate: '2026-06-10',
      endDate: '2026-06-10',
      timeZone: 'UTC',
      ...MESSAGES,
    });

    expect(result.dailyBalance).toEqual([]);
    expect(result.warnings).toEqual([{ code: 'mixed_currencies', message: 'mixed currencies' }]);
  });
});

describe('loadTransactionChartSection balance', () => {
  it('ignores category filters for true balance', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedConnection(db);
    seedBankAccount(db, { id: 'acc-1', balanceCents: 100_000 });
    db.prepare(
      `INSERT INTO categories (id, name, name_translated, parent_id, parent_name, raw_json, synced_at)
       VALUES ('food', 'Food', 'Food', NULL, NULL, '{}', '2026-06-22T12:00:00.000Z')`,
    ).run();
    seedTransaction(db, {
      id: 'tx-1',
      accountId: 'acc-1',
      occurredAt: '2026-06-10T12:00:00.000Z',
      amountCents: -10_000,
      categoryId: 'food',
    });
    seedTransaction(db, {
      id: 'tx-2',
      accountId: 'acc-1',
      occurredAt: '2026-06-11T12:00:00.000Z',
      amountCents: -20_000,
      categoryId: null,
    });

    const unfiltered = loadTransactionChartSection(
      db,
      { ...BASE_FILTERS, startDate: '2026-06-10', endDate: '2026-06-11' },
      'UTC',
      'balance',
    );
    const categoryFiltered = loadTransactionChartSection(
      db,
      {
        ...BASE_FILTERS,
        startDate: '2026-06-10',
        endDate: '2026-06-11',
        categoryIds: ['food'],
      },
      'UTC',
      'balance',
    );

    expect(unfiltered.chart).toBe('balance');
    expect(categoryFiltered.chart).toBe('balance');
    if (unfiltered.chart !== 'balance' || categoryFiltered.chart !== 'balance') {
      throw new Error('expected balance chart');
    }
    expect(categoryFiltered.dailyBalance).toEqual(unfiltered.dailyBalance);
  });

  it('returns a warning when no bank accounts are in scope', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedConnection(db);
    seedCreditAccount(db, 'card-1');

    const section = loadTransactionChartSection(db, BASE_FILTERS, 'UTC', 'balance');
    expect(section.chart).toBe('balance');
    if (section.chart !== 'balance') {
      throw new Error('expected balance chart');
    }
    expect(section.dailyBalance).toEqual([]);
    expect(section.warnings.some((warning) => warning.code === 'no_bank_accounts')).toBe(true);
  });
});

describe('iterateDateKeysInclusive', () => {
  it('returns an empty array when the range is inverted', () => {
    expect(iterateDateKeysInclusive('2026-06-10', '2026-06-01')).toEqual([]);
  });
});
