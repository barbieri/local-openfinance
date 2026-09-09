import type { DatabaseSync } from 'node:sqlite';
import { parseAccountDetailColumns } from '../../db/account-details.js';
import { isMergedAlias, VISIBLE_ACCOUNTS_WHERE } from '../../db/account-links.js';
import { syncCreditCardBillLinksForAccount } from '../../db/credit-card-bill-links.js';
import {
  parseInvestmentDetails,
  resolveInvestmentTotalCents,
} from '../../db/investment-details.js';
import { parseLoanDetails } from '../../db/loan-details.js';
import { resolveSyncedTransactionAmountInAccountCurrencyCents } from '../../db/transaction-foreign-amount.js';
import { throwIfAborted } from '../../utils/job-abort.js';
import { mapInParallel } from '../../utils/map-in-parallel.js';
import { applyOpenFinanceCategoryDefaults } from '../category-defaults.js';
import type { OpenFinanceClient } from '../client.js';
import { resolveImportedCreditCardBillPaymentStatus } from '../credit-card-bill-status.js';
import { parseAmountToCents, readArray, readFieldString, readRecord } from '../money.js';
import { extractTransactionDocumentKeys } from '../payment-document.js';
import { resolveTransactionMerchantAndDescription } from '../transaction-merchant.js';
import {
  advanceSyncCursor,
  isPageBeforeCutoff,
  loadKnownIds,
  readRowId,
  resolveIncrementalFromDate,
  toDateKey,
  upsertSyncCursor,
} from './incremental.js';
import {
  paginateResults,
  readEntityId,
  readNestedResultRecords,
  readPagedRows,
  readResultRecords,
} from './pagination.js';
import type { SyncProgressReporter } from './progress.js';

type ConnectionRow = {
  item_id: string;
  connector_id: string | null;
  connector_name: string | null;
  status: string | null;
};

export type SyncSummary = {
  syncedAt: string;
  connections: number;
  accounts: number;
  transactions: number;
  creditCardBills: number;
  investments: number;
  investmentTransactions: number;
  loans: number;
  categories: number;
};

export type SyncOptions = {
  readonly forceBeforeFetch: boolean;
  readonly forceUpsert: boolean;
  readonly connections: readonly string[];
  readonly lookbackDays: number;
  readonly pageSize: number;
};

export type SyncRunOptions = SyncOptions & {
  readonly progress?: SyncProgressReporter;
  readonly signal?: AbortSignal | undefined;
};

export async function syncOpenFinanceData(
  db: DatabaseSync,
  client: OpenFinanceClient,
  options: SyncRunOptions,
): Promise<SyncSummary> {
  const progress = options.progress;
  const syncedAt = new Date().toISOString();
  const summary: SyncSummary = {
    syncedAt,
    connections: 0,
    accounts: 0,
    transactions: 0,
    creditCardBills: 0,
    investments: 0,
    investmentTransactions: 0,
    loans: 0,
    categories: 0,
  };

  progress?.setPhase('connections');
  throwIfAborted(options.signal);
  if (options.forceUpsert) {
    progress?.setPhase('force-upsert');
  }
  const listResult = await client.post<Record<string, unknown>>('/connections/list', {});
  let connections = readArray(listResult['connections'])
    .map(normalizeConnection)
    .filter((row): row is ConnectionRow => row !== null);

  if (options.connections.length > 0) {
    const allowed = new Set(options.connections.map((item) => item.toLowerCase()));
    connections = connections.filter(
      (connection) =>
        allowed.has(connection.item_id.toLowerCase()) ||
        allowed.has((connection.connector_id ?? '').toLowerCase()) ||
        allowed.has((connection.connector_name ?? '').toLowerCase()),
    );
  }

  await syncConnectionsAndCategories(db, client, connections, options, syncedAt, summary);
  await syncPerConnectionEntities(db, client, connections, options, syncedAt, summary);

  progress?.finish();
  return summary;
}

async function syncConnectionsAndCategories(
  db: DatabaseSync,
  client: OpenFinanceClient,
  connections: readonly ConnectionRow[],
  options: SyncRunOptions,
  syncedAt: string,
  summary: SyncSummary,
): Promise<void> {
  const progress = options.progress;

  if (options.forceBeforeFetch && connections.length > 0) {
    progress?.setPhase('force-sync', `${connections.length} connection(s)`);
    await client.post('/connections/sync', {
      items: connections.map((connection) => connection.item_id),
    });
  }

  const upsertConnection = db.prepare(`
    INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      connector_id = excluded.connector_id,
      connector_name = excluded.connector_name,
      status = excluded.status,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at
  `);

  for (const [index, connection] of connections.entries()) {
    throwIfAborted(options.signal);
    progress?.setStep(
      index + 1,
      connections.length,
      connection.connector_name ?? connection.item_id,
    );
    upsertConnection.run(
      connection.item_id,
      connection.connector_id ?? null,
      connection.connector_name ?? null,
      connection.status ?? null,
      JSON.stringify(connection),
      syncedAt,
    );
    summary.connections += 1;
  }

  if (summary.connections > 0) {
    progress?.writeTrail('Connections', { connections: summary.connections });
  }

  progress?.setPhase('categories');
  const categoryCount = await syncCategories(db, client, syncedAt, options.forceUpsert);
  summary.categories = categoryCount;
  progress?.writeTrail('Categories', { categories: categoryCount });
}

async function syncPerConnectionEntities(
  db: DatabaseSync,
  client: OpenFinanceClient,
  connections: readonly ConnectionRow[],
  options: SyncRunOptions,
  syncedAt: string,
  summary: SyncSummary,
): Promise<void> {
  const progress = options.progress;

  await mapInParallel(
    connections,
    async (connection, index) => {
      throwIfAborted(options.signal);
      const connectionLabel = connection.connector_name ?? connection.item_id;

      progress?.setPhase('accounts', connectionLabel);
      progress?.setStep(index + 1, connections.length);
      await syncAccounts(db, client, connection.item_id, syncedAt);

      progress?.setPhase('investments', connectionLabel);
      const investmentCount = await syncInvestments(
        db,
        client,
        connection.item_id,
        options.pageSize,
        syncedAt,
        progress,
        options.signal,
      );
      summary.investments += investmentCount;

      progress?.setPhase('loans', connectionLabel);
      const loanCount = await syncLoans(db, client, connection.item_id, syncedAt);
      summary.loans += loanCount;

      const visibleAccountCount = countVisibleAccountsForConnection(db, connection.item_id);
      summary.accounts += visibleAccountCount;

      progress?.writeTrail(connectionLabel, {
        accounts: visibleAccountCount,
        investments: investmentCount,
        loans: loanCount,
      });

      const visibleAccounts = listVisibleAccountsForConnection(db, connection.item_id);
      await mapInParallel(
        visibleAccounts,
        async (account, accountIndex) => {
          throwIfAborted(options.signal);
          const accountLabel = account.name ?? account.id;
          let transactionCount = 0;
          let creditCardBillCount: number | undefined;

          progress?.setPhase('account', accountLabel);
          progress?.setStep(accountIndex + 1, visibleAccounts.length);
          progress?.setPhase('transactions', accountLabel);
          transactionCount = await syncTransactions(
            db,
            client,
            account.id,
            options.lookbackDays,
            options.pageSize,
            syncedAt,
            progress,
            options.forceUpsert,
            options.signal,
          );
          summary.transactions += transactionCount;

          if (account.type === 'CREDIT') {
            progress?.setPhase('credit-card-bills', accountLabel);
            creditCardBillCount = await syncCreditCardBills(
              db,
              client,
              account.id,
              options.pageSize,
              syncedAt,
              progress,
              options.signal,
            );
            summary.creditCardBills += creditCardBillCount;
            syncCreditCardBillLinksForAccount(db, account.id, syncedAt);
          }

          progress?.writeTrail(
            accountLabel,
            {
              transactions: transactionCount,
              ...(creditCardBillCount !== undefined
                ? { creditCardBills: creditCardBillCount }
                : {}),
            },
            { indent: 1 },
          );
        },
        1,
      );

      const investments = listInvestmentsForConnection(db, connection.item_id);
      await mapInParallel(
        investments,
        async (investment, investmentIndex) => {
          throwIfAborted(options.signal);
          const investmentLabel = investment.name ?? investment.id;

          progress?.setPhase('investment-transactions', investmentLabel);
          progress?.setStep(investmentIndex + 1, investments.length);
          const investmentTransactionCount = await syncInvestmentTransactions(
            db,
            client,
            investment.id,
            options.lookbackDays,
            options.pageSize,
            syncedAt,
            progress,
            options.forceUpsert,
            options.signal,
          );
          summary.investmentTransactions += investmentTransactionCount;

          progress?.writeTrail(
            investmentLabel,
            {
              investmentTransactions: investmentTransactionCount,
            },
            { indent: 1 },
          );
        },
        1,
      );
    },
    1,
  );
}

function countVisibleAccountsForConnection(db: DatabaseSync, itemId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM accounts WHERE connection_item_id = ? AND ${VISIBLE_ACCOUNTS_WHERE}`,
    )
    .get(itemId) as { readonly count: number };
  return row.count;
}

function listVisibleAccountsForConnection(
  db: DatabaseSync,
  itemId: string,
): Array<{ readonly id: string; readonly type: string; readonly name: string | null }> {
  return db
    .prepare(
      `SELECT id, type, name FROM accounts
       WHERE connection_item_id = ? AND ${VISIBLE_ACCOUNTS_WHERE}
       ORDER BY type ASC, COALESCE(name, id) ASC, id ASC`,
    )
    .all(itemId) as Array<{
    readonly id: string;
    readonly type: string;
    readonly name: string | null;
  }>;
}

function listInvestmentsForConnection(
  db: DatabaseSync,
  itemId: string,
): Array<{ readonly id: string; readonly name: string | null }> {
  return db
    .prepare(
      `SELECT id, name FROM investments
       WHERE connection_item_id = ?
       ORDER BY COALESCE(name, id) ASC, id ASC`,
    )
    .all(itemId) as Array<{ readonly id: string; readonly name: string | null }>;
}

function normalizeConnection(value: unknown): ConnectionRow | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  const itemId = readFieldString(record, 'item_id');
  if (!itemId) {
    return null;
  }

  return {
    item_id: itemId,
    connector_id: readFieldString(record, 'connector_id'),
    connector_name: readFieldString(record, 'connector_name'),
    status: readFieldString(record, 'status'),
  };
}

async function syncCategories(
  db: DatabaseSync,
  client: OpenFinanceClient,
  syncedAt: string,
  forceUpsert: boolean,
): Promise<number> {
  const result = await client.post<Record<string, unknown>>('/categories/list', {});
  const knownIds = forceUpsert
    ? new Set<string>()
    : new Set(
        (db.prepare('SELECT id FROM categories').all() as Array<{ readonly id: string }>).map(
          (row) => row.id,
        ),
      );
  const upsert = db.prepare(`
    INSERT INTO categories (id, name, name_translated, parent_id, parent_name, raw_json, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      name_translated = excluded.name_translated,
      parent_id = excluded.parent_id,
      parent_name = excluded.parent_name,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at
  `);

  let count = 0;
  for (const record of readResultRecords(result)) {
    const id = readFieldString(record, 'id');
    if (!id || knownIds.has(id)) {
      continue;
    }

    upsert.run(
      id,
      readFieldString(record, 'description') ?? id,
      readFieldString(record, 'descriptionTranslated'),
      readFieldString(record, 'parentId'),
      readFieldString(record, 'parentDescription'),
      JSON.stringify(record),
      syncedAt,
    );
    count += 1;
  }

  applyOpenFinanceCategoryDefaults(db);
  return count;
}

async function syncAccounts(
  db: DatabaseSync,
  client: OpenFinanceClient,
  itemId: string,
  syncedAt: string,
): Promise<number> {
  const result = await client.post<Record<string, unknown>>('/accounts/list', { item: itemId });
  const upsert = db.prepare(`
    INSERT INTO accounts (
      id, connection_item_id, type, subtype, name, number, owner, balance_cents, currency,
      credit_brand, credit_level, credit_limit_cents, credit_available_limit_cents,
      credit_minimum_payment_cents, credit_balance_close_date, credit_balance_due_date, credit_status,
      bank_transfer_number, bank_branch, bank_account,
      raw_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      connection_item_id = excluded.connection_item_id,
      type = excluded.type,
      subtype = excluded.subtype,
      name = excluded.name,
      number = excluded.number,
      owner = excluded.owner,
      balance_cents = excluded.balance_cents,
      currency = excluded.currency,
      credit_brand = excluded.credit_brand,
      credit_level = excluded.credit_level,
      credit_limit_cents = excluded.credit_limit_cents,
      credit_available_limit_cents = excluded.credit_available_limit_cents,
      credit_minimum_payment_cents = excluded.credit_minimum_payment_cents,
      credit_balance_close_date = excluded.credit_balance_close_date,
      credit_balance_due_date = excluded.credit_balance_due_date,
      credit_status = excluded.credit_status,
      bank_transfer_number = excluded.bank_transfer_number,
      bank_branch = excluded.bank_branch,
      bank_account = excluded.bank_account,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at
  `);

  let count = 0;
  for (const record of readResultRecords(result)) {
    const id = readEntityId(record);
    if (!id) {
      continue;
    }
    const accountDetails = parseAccountDetailColumns(record);

    upsert.run(
      id,
      itemId,
      readFieldString(record, 'type') ?? 'UNKNOWN',
      readFieldString(record, 'subtype'),
      readFieldString(record, 'name'),
      readFieldString(record, 'number'),
      readFieldString(record, 'owner'),
      parseAmountToCents(record['balance']),
      readFieldString(record, 'currencyCode') ?? 'BRL',
      accountDetails.credit_brand,
      accountDetails.credit_level,
      accountDetails.credit_limit_cents,
      accountDetails.credit_available_limit_cents,
      accountDetails.credit_minimum_payment_cents,
      accountDetails.credit_balance_close_date,
      accountDetails.credit_balance_due_date,
      accountDetails.credit_status,
      accountDetails.bank_transfer_number,
      accountDetails.bank_branch,
      accountDetails.bank_account,
      JSON.stringify(record),
      syncedAt,
    );
    count += 1;
  }

  return count;
}

async function syncTransactions(
  db: DatabaseSync,
  client: OpenFinanceClient,
  accountId: string,
  lookbackDays: number,
  pageSize: number,
  syncedAt: string,
  progress?: SyncProgressReporter,
  forceUpsert = false,
  signal?: AbortSignal,
): Promise<number> {
  if (isMergedAlias(db, accountId)) {
    return 0;
  }

  const cursorKey = `transactions:account:${accountId}`;
  const fromDate = resolveIncrementalFromDate(db, cursorKey, lookbackDays, 30, forceUpsert);
  const knownIds = forceUpsert
    ? new Set<string>()
    : loadKnownIds(db, 'transactions', 'account_id', accountId);
  const upsert = db.prepare(`
    INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, amount_in_account_currency_cents, currency,
      description, category_id, merchant_name, payment_type, status, raw_json, synced_at,
      payer_document_key, receiver_document_key, merchant_document_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id,
      occurred_at = excluded.occurred_at,
      amount_cents = excluded.amount_cents,
      amount_in_account_currency_cents = excluded.amount_in_account_currency_cents,
      currency = excluded.currency,
      description = excluded.description,
      category_id = excluded.category_id,
      merchant_name = excluded.merchant_name,
      payment_type = excluded.payment_type,
      status = excluded.status,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at,
      payer_document_key = excluded.payer_document_key,
      receiver_document_key = excluded.receiver_document_key,
      merchant_document_key = excluded.merchant_document_key
  `);

  let maxOccurredAt = fromDate;
  const count = await paginateResults<unknown>(
    async (page) => {
      const result = await client.post<Record<string, unknown>>('/transactions/list', {
        account_id: accountId,
        from: fromDate,
        page,
        page_size: pageSize,
        detail: 'raw',
      });
      return readPagedRows(result, page);
    },
    (item) => {
      const record = readRecord(item);
      if (!record) {
        return;
      }
      const id = readFieldString(record, 'id');
      if (!id) {
        return;
      }

      const occurredAt = readFieldString(record, 'date') ?? syncedAt;
      const { merchantName, description } = resolveTransactionMerchantAndDescription(record);
      const amountCents = parseAmountToCents(record['amount']) ?? 0;
      const documentKeys = extractTransactionDocumentKeys(record);
      upsert.run(
        id,
        accountId,
        occurredAt,
        amountCents,
        resolveSyncedTransactionAmountInAccountCurrencyCents(record, amountCents),
        readFieldString(record, 'currencyCode') ?? 'BRL',
        description,
        readFieldString(record, 'categoryId'),
        merchantName,
        readFieldString(record, 'operationType') ?? readFieldString(record, 'type'),
        readFieldString(record, 'status'),
        JSON.stringify(record),
        syncedAt,
        documentKeys.payerDocumentKey ?? '',
        documentKeys.receiverDocumentKey ?? '',
        documentKeys.merchantDocumentKey ?? '',
      );
      maxOccurredAt = advanceSyncCursor(maxOccurredAt, occurredAt, syncedAt);
    },
    {
      onPage: ({ page, totalPages }) => {
        progress?.setStep(page, totalPages);
      },
      shouldSkip: (item) => {
        const record = readRecord(item);
        if (!record) {
          return true;
        }
        if (forceUpsert) {
          return false;
        }
        const id = readRowId(record);
        if (id && knownIds.has(id)) {
          return true;
        }
        const dateKey = toDateKey(readFieldString(record, 'date'));
        return dateKey !== null && dateKey < fromDate;
      },
      shouldStopAfterPage: (rows) =>
        forceUpsert
          ? false
          : isPageBeforeCutoff(rows, fromDate, (record) => readFieldString(record, 'date')),
      signal,
    },
  );

  upsertSyncCursor(db, cursorKey, maxOccurredAt, syncedAt);
  return count;
}

async function syncCreditCardBills(
  db: DatabaseSync,
  client: OpenFinanceClient,
  accountId: string,
  pageSize: number,
  syncedAt: string,
  progress?: SyncProgressReporter,
  signal?: AbortSignal,
): Promise<number> {
  if (isMergedAlias(db, accountId)) {
    return 0;
  }

  const upsert = db.prepare(`
    INSERT INTO credit_card_bills (
      id, account_id, due_date, total_amount_cents, minimum_payment_cents, payment_status, currency, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id,
      due_date = excluded.due_date,
      total_amount_cents = excluded.total_amount_cents,
      minimum_payment_cents = excluded.minimum_payment_cents,
      payment_status = excluded.payment_status,
      currency = excluded.currency,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at
  `);

  return paginateResults<unknown>(
    async (page) => {
      const result = await client.post<Record<string, unknown>>('/credit-card-bills/list', {
        account_id: accountId,
        page,
        page_size: pageSize,
      });
      return readPagedRows(result, page);
    },
    (item) => {
      const record = readRecord(item);
      if (!record) {
        return;
      }
      const id = readFieldString(record, 'id');
      if (!id) {
        return;
      }

      const dueDate = readFieldString(record, 'dueDate');
      const totalAmountCents = parseAmountToCents(record['totalAmount']);
      const paymentStatus = resolveImportedCreditCardBillPaymentStatus({
        paymentStatus: readFieldString(record, 'payment_status'),
        totalAmountCents,
        dueDate,
        referenceDate: new Date(syncedAt),
      });

      upsert.run(
        id,
        accountId,
        dueDate,
        totalAmountCents,
        parseAmountToCents(record['minimumPaymentAmount']),
        paymentStatus,
        readFieldString(record, 'totalAmountCurrencyCode') ?? 'BRL',
        JSON.stringify(record),
        syncedAt,
      );
    },
    {
      onPage: ({ page, totalPages }) => {
        progress?.setStep(page, totalPages);
      },
      signal,
    },
  );
}

async function syncInvestments(
  db: DatabaseSync,
  client: OpenFinanceClient,
  itemId: string,
  pageSize: number,
  syncedAt: string,
  progress?: SyncProgressReporter,
  signal?: AbortSignal,
): Promise<number> {
  const upsert = db.prepare(`
    INSERT INTO investments (
      id, connection_item_id, type, subtype, name, code, balance_cents, currency,
      status, isin, quantity, unit_price_cents, total_cents, amount_cents,
      amount_withdrawal_cents, issuer, issuer_cnpj, rate, rate_type, purchase_date,
      due_date, taxes_cents, taxes2_cents, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      connection_item_id = excluded.connection_item_id,
      type = excluded.type,
      subtype = excluded.subtype,
      name = excluded.name,
      code = excluded.code,
      balance_cents = excluded.balance_cents,
      currency = excluded.currency,
      status = excluded.status,
      isin = excluded.isin,
      quantity = excluded.quantity,
      unit_price_cents = excluded.unit_price_cents,
      total_cents = excluded.total_cents,
      amount_cents = excluded.amount_cents,
      amount_withdrawal_cents = excluded.amount_withdrawal_cents,
      issuer = excluded.issuer,
      issuer_cnpj = excluded.issuer_cnpj,
      rate = excluded.rate,
      rate_type = excluded.rate_type,
      purchase_date = excluded.purchase_date,
      due_date = excluded.due_date,
      taxes_cents = excluded.taxes_cents,
      taxes2_cents = excluded.taxes2_cents,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at
  `);

  return paginateResults<unknown>(
    async (page) => {
      const result = await client.post<Record<string, unknown>>('/investments/list', {
        item: itemId,
        page,
        page_size: pageSize,
      });
      return readPagedRows(result, page);
    },
    (item) => {
      const record = readRecord(item);
      if (!record) {
        return;
      }
      const id = readFieldString(record, 'id');
      if (!id) {
        return;
      }
      const details = parseInvestmentDetails(record);
      const balanceCents =
        details.total_cents ??
        resolveInvestmentTotalCents(record) ??
        parseAmountToCents(record['balance'] ?? record['amount'] ?? record['value']);

      upsert.run(
        id,
        itemId,
        readFieldString(record, 'type'),
        readFieldString(record, 'subtype'),
        readFieldString(record, 'name'),
        readFieldString(record, 'code'),
        balanceCents,
        readFieldString(record, 'currencyCode') ?? 'BRL',
        details.status,
        details.isin,
        details.quantity,
        details.unit_price_cents,
        details.total_cents,
        details.amount_cents,
        details.amount_withdrawal_cents,
        details.issuer,
        details.issuer_cnpj,
        details.rate,
        details.rate_type,
        details.purchase_date,
        details.due_date,
        details.taxes_cents,
        details.taxes2_cents,
        JSON.stringify(record),
        syncedAt,
      );
    },
    {
      onPage: ({ page, totalPages }) => {
        progress?.setStep(page, totalPages);
      },
      signal,
    },
  );
}

async function syncInvestmentTransactions(
  db: DatabaseSync,
  client: OpenFinanceClient,
  investmentId: string,
  lookbackDays: number,
  pageSize: number,
  syncedAt: string,
  progress?: SyncProgressReporter,
  forceUpsert = false,
  signal?: AbortSignal,
): Promise<number> {
  const cursorKey = `investment_transactions:investment:${investmentId}`;
  const fromDate = resolveIncrementalFromDate(db, cursorKey, lookbackDays, 30, forceUpsert);
  const knownIds = forceUpsert
    ? new Set<string>()
    : loadKnownIds(db, 'investment_transactions', 'investment_id', investmentId);
  const upsert = db.prepare(`
    INSERT INTO investment_transactions (
      id, investment_id, occurred_at, type, amount_cents, quantity, currency, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      investment_id = excluded.investment_id,
      occurred_at = excluded.occurred_at,
      type = excluded.type,
      amount_cents = excluded.amount_cents,
      quantity = excluded.quantity,
      currency = excluded.currency,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at
  `);

  let maxOccurredAt = fromDate;
  const count = await paginateResults<unknown>(
    async (page) => {
      const result = await client.post<Record<string, unknown>>('/investments/transactions/list', {
        investment_id: investmentId,
        page,
        page_size: pageSize,
      });
      return readPagedRows(result, page);
    },
    (item) => {
      const record = readRecord(item);
      if (!record) {
        return;
      }
      const id = readFieldString(record, 'id');
      if (!id) {
        return;
      }

      const occurredAt = readFieldString(record, 'date') ?? syncedAt;
      upsert.run(
        id,
        investmentId,
        occurredAt,
        readFieldString(record, 'type'),
        parseAmountToCents(record['amount'] ?? record['value']),
        typeof record['quantity'] === 'number' ? record['quantity'] : null,
        readFieldString(record, 'currencyCode') ?? 'BRL',
        JSON.stringify(record),
        syncedAt,
      );
      maxOccurredAt = advanceSyncCursor(maxOccurredAt, occurredAt, syncedAt);
    },
    {
      onPage: ({ page, totalPages }) => {
        progress?.setStep(page, totalPages);
      },
      shouldSkip: (item) => {
        const record = readRecord(item);
        if (!record) {
          return true;
        }
        if (forceUpsert) {
          return false;
        }
        const id = readRowId(record);
        if (id && knownIds.has(id)) {
          return true;
        }
        const dateKey = toDateKey(readFieldString(record, 'date'));
        return dateKey !== null && dateKey < fromDate;
      },
      shouldStopAfterPage: (rows) =>
        forceUpsert
          ? false
          : isPageBeforeCutoff(rows, fromDate, (record) => readFieldString(record, 'date')),
      signal,
    },
  );

  upsertSyncCursor(db, cursorKey, maxOccurredAt, syncedAt);
  return count;
}

async function syncLoans(
  db: DatabaseSync,
  client: OpenFinanceClient,
  itemId: string,
  syncedAt: string,
): Promise<number> {
  const result = await client.post<Record<string, unknown>>('/loans/list', { items: [itemId] });
  const upsert = db.prepare(`
    INSERT INTO loans (
      id, connection_item_id, type, contract_amount_cents, due_date, contract_number, currency,
      name, outstanding_balance_cents, installment_cents, paid_installments, total_installments,
      contracted_date, interest_rate, creditor, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      connection_item_id = excluded.connection_item_id,
      type = excluded.type,
      contract_amount_cents = excluded.contract_amount_cents,
      due_date = excluded.due_date,
      contract_number = excluded.contract_number,
      currency = excluded.currency,
      name = excluded.name,
      outstanding_balance_cents = excluded.outstanding_balance_cents,
      installment_cents = excluded.installment_cents,
      paid_installments = excluded.paid_installments,
      total_installments = excluded.total_installments,
      contracted_date = excluded.contracted_date,
      interest_rate = excluded.interest_rate,
      creditor = excluded.creditor,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at
  `);

  let count = 0;
  for (const record of readNestedResultRecords(result)) {
    const id = readFieldString(record, 'id');
    if (!id) {
      continue;
    }
    const details = parseLoanDetails(record, {
      contract_amount_cents: parseAmountToCents(record['contractAmount']),
      due_date: readFieldString(record, 'dueDate'),
      contract_number: readFieldString(record, 'contractNumber'),
      type: readFieldString(record, 'type'),
    });

    upsert.run(
      id,
      itemId,
      readFieldString(record, 'type'),
      details.contract_amount_cents,
      details.due_date,
      readFieldString(record, 'contractNumber'),
      readFieldString(record, 'currencyCode') ?? 'BRL',
      details.name,
      details.outstanding_balance_cents,
      details.installment_cents,
      details.paid_installments,
      details.total_installments,
      details.contracted_date,
      details.interest_rate,
      details.creditor,
      JSON.stringify(record),
      syncedAt,
    );
    count += 1;
  }

  return count;
}
