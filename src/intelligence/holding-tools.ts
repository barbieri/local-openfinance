import type { DatabaseSync } from 'node:sqlite';
import { listEnrichedAccounts } from '../db/account-list-details.js';
import { listEnrichedCreditCardBills } from '../db/credit-card-bill-details.js';
import { listEnrichedInvestments } from '../db/investment-details.js';
import { listEnrichedLoans } from '../db/loan-details.js';
import type { ReportQueryScope } from './report-scope.js';
import { defineIntelligenceTool, MAX_LIST_ITEMS, parseNoArguments } from './tool-contract.js';

const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

export const HOLDING_INTELLIGENCE_TOOLS = {
  list_accounts: defineIntelligenceTool({
    description: 'List account balances and credit limits within the report account scope.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    parse: parseNoArguments,
    execute: ({ db, scope }) => listAccounts(db, scope.report.accountIds),
  }),
  list_investments: defineIntelligenceTool({
    description: 'List current investments within the report account scope.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    parse: parseNoArguments,
    execute: ({ db, scope }) => listInvestments(db, scope.report.accountIds),
  }),
  list_loans: defineIntelligenceTool({
    description: 'List current loans within the report account scope.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    parse: parseNoArguments,
    execute: ({ db, scope }) => listLoans(db, scope.report.accountIds),
  }),
  list_credit_card_bills: defineIntelligenceTool({
    description: 'List current credit-card bills within the report account scope.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    parse: parseNoArguments,
    execute: ({ db, scope }) => listCreditCardBills(db, scope),
  }),
} as const;

function listAccounts(db: DatabaseSync, accountIds: readonly string[]): unknown {
  const { accounts } = listEnrichedAccounts(db, { limit: 10_000, offset: 0 });
  const accountIdSet = new Set(accountIds);
  const scoped = accounts.filter((row) => accountIdSet.size === 0 || accountIdSet.has(row.id));
  const rows = scoped.slice(0, MAX_LIST_ITEMS).map((row) => ({
    id: row.id,
    name: row.display_name,
    type: row.type,
    subtype: row.subtype,
    balanceCents: row.balance_cents,
    currency: row.currency,
    credit: row.credit_data,
    syncedAt: row.synced_at,
  }));
  return {
    rows,
    total: scoped.length,
    cap: MAX_LIST_ITEMS,
    truncated: scoped.length > rows.length,
  };
}

function listInvestments(db: DatabaseSync, accountIds: readonly string[]): unknown {
  const scoped = accountIds.length === 0 ? listEnrichedInvestments(db, 'all') : [];
  const rows = scoped.slice(0, MAX_LIST_ITEMS).map((row) => ({
    id: row.id,
    name: row.display_name,
    account: row.account_group_label,
    type: row.type,
    subtype: row.subtype,
    balanceCents: row.balance_cents,
    totalCents: row.total_cents,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    currency: row.currency,
    status: row.status,
    issuer: row.issuer,
    dueDate: row.due_date,
    syncedAt: row.synced_at,
  }));
  return {
    rows,
    total: scoped.length,
    cap: MAX_LIST_ITEMS,
    truncated: scoped.length > rows.length,
  };
}

function listLoans(db: DatabaseSync, accountIds: readonly string[]): unknown {
  const scoped = accountIds.length === 0 ? listEnrichedLoans(db) : [];
  const rows = scoped.slice(0, MAX_LIST_ITEMS).map((row) => ({
    id: row.id,
    name: row.display_name,
    account: row.account_group_label,
    type: row.type,
    contractAmountCents: row.contract_amount_cents,
    outstandingBalanceCents: row.outstanding_balance_cents,
    installmentCents: row.installment_cents,
    paidInstallments: row.paid_installments,
    totalInstallments: row.total_installments,
    interestRate: row.interest_rate,
    dueDate: row.due_date,
    currency: row.currency,
    syncedAt: row.synced_at,
  }));
  return {
    rows,
    total: scoped.length,
    cap: MAX_LIST_ITEMS,
    truncated: scoped.length > rows.length,
  };
}

function listCreditCardBills(db: DatabaseSync, scope: ReportQueryScope): unknown {
  const { bills } = listEnrichedCreditCardBills(db, {
    filters: [
      { field: 'due_date', operator: 'ge', value: scope.period.start },
      { field: 'due_date', operator: 'le', value: scope.period.end },
    ],
    limit: 10_000,
    offset: 0,
  });
  const accountIdSet = new Set(scope.report.accountIds);
  const scoped = bills.filter(
    (row) => row.due_date !== null && (accountIdSet.size === 0 || accountIdSet.has(row.account_id)),
  );
  const rows = scoped.slice(0, MAX_LIST_ITEMS).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    account: row.account_display_name,
    dueDate: row.due_date,
    totalAmountCents: row.total_amount_cents,
    minimumPaymentCents: row.minimum_payment_cents,
    paymentStatus: row.payment_status,
    currency: row.currency,
    syncedAt: row.synced_at,
  }));
  return {
    rows,
    total: scoped.length,
    cap: MAX_LIST_ITEMS,
    truncated: scoped.length > rows.length,
  };
}
