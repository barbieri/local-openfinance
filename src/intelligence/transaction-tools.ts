import type { DatabaseSync } from 'node:sqlite';
import { loadAssistSuggestion } from '../annotation/assist-suggestions.js';
import { isConfirmedTransactionClassification } from '../annotation/classification-policy.js';
import { isMergedAlias } from '../db/account-links.js';
import {
  getEnrichedTransaction,
  listEnrichedTransactionPage,
} from '../db/enriched-transactions.js';
import type { EnrichedTransaction } from '../db/transaction-details.js';
import {
  aggregateTransactionHistory,
  listEnrichedTransactionHistoryPage,
  type TransactionHistoryScope,
} from '../db/transaction-history-query.js';
import { createTransactionWebListFilters } from '../db/transaction-query.js';
import { IntelligenceToolError } from './intelligence-tool-error.js';
import {
  baseReportTransactionFilters,
  loadReportTransactionChartDataset,
  REPORT_BRIEFING_ACCESS,
} from './report-scope.js';
import {
  defineIntelligenceTool,
  MAX_LIST_ITEMS,
  MAX_LIST_OFFSET,
  MAX_QUERY_LENGTH,
  optionalEnum,
  optionalInteger,
  optionalString,
  parseNoArguments,
  readToolArguments,
  requireAllowedArguments,
  requireString,
  type ScopedIntelligenceToolContext,
} from './tool-contract.js';

const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

type TransactionHistoryInput = {
  readonly transactionId: string;
  readonly limit: number;
  readonly offset: number;
};

type ClassificationHistoryInput = {
  readonly transactionId: string;
  readonly dimension: 'category' | 'label';
};

type ListTransactionsInput = {
  readonly query: string | null;
  readonly categoryId: string | null;
  readonly labelId: string | null;
  readonly limit: number;
  readonly offset: number;
  readonly sort: 'date:asc' | 'date:desc' | 'amount:asc' | 'amount:desc';
};

function parseListTransactionsInput(input: unknown): ListTransactionsInput {
  const args = readToolArguments(input);
  requireAllowedArguments(args, ['query', 'categoryId', 'labelId', 'limit', 'offset', 'sort']);
  return {
    query: optionalString(args, 'query'),
    categoryId: optionalString(args, 'categoryId'),
    labelId: optionalString(args, 'labelId'),
    limit: optionalInteger(args, 'limit', 20, 1, MAX_LIST_ITEMS),
    offset: optionalInteger(args, 'offset', 0, 0, MAX_LIST_OFFSET),
    sort: optionalEnum(
      args,
      'sort',
      ['date:asc', 'date:desc', 'amount:asc', 'amount:desc'] as const,
      'date:desc',
    ),
  };
}

function parseGetTransactionInput(input: unknown): { readonly id: string } {
  const args = readToolArguments(input);
  requireAllowedArguments(args, ['id']);
  return { id: requireString(args, 'id') };
}

function parseTransactionHistoryInput(input: unknown): TransactionHistoryInput {
  const args = readToolArguments(input);
  requireAllowedArguments(args, ['transactionId', 'limit', 'offset']);
  return {
    transactionId: requireString(args, 'transactionId'),
    limit: optionalInteger(args, 'limit', 20, 1, MAX_LIST_ITEMS),
    offset: optionalInteger(args, 'offset', 0, 0, MAX_LIST_OFFSET),
  };
}

function parseClassificationHistoryInput(input: unknown): ClassificationHistoryInput {
  const args = readToolArguments(input);
  requireAllowedArguments(args, ['transactionId', 'dimension']);
  return {
    transactionId: requireString(args, 'transactionId'),
    dimension: optionalEnum(args, 'dimension', ['category', 'label'] as const, 'category'),
  };
}

export const TRANSACTION_INTELLIGENCE_TOOLS = {
  list_transactions: defineIntelligenceTool({
    description:
      'List report-scoped transactions above the configured line-item floor. Searches can narrow but never widen the report window or accounts.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', maxLength: MAX_QUERY_LENGTH },
        categoryId: { type: 'string', maxLength: MAX_QUERY_LENGTH },
        labelId: { type: 'string', maxLength: MAX_QUERY_LENGTH },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_ITEMS },
        offset: { type: 'integer', minimum: 0, maximum: MAX_LIST_OFFSET },
        sort: { enum: ['date:asc', 'date:desc', 'amount:asc', 'amount:desc'] },
      },
    },
    parse: parseListTransactionsInput,
    execute: (context, input) =>
      listTransactions(
        context,
        input,
        context.resolved.config.intelligence.minReportedItemAmountCents,
      ),
  }),
  get_transaction: defineIntelligenceTool({
    description:
      'Load one transaction only when it belongs to the report window, accounts, annotation policy, and line-item floor.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH } },
    },
    parse: parseGetTransactionInput,
    execute: (context, input) =>
      presentTransaction(
        context.db,
        requireScopedTransaction(
          context,
          input.id,
          context.resolved.config.intelligence.minReportedItemAmountCents,
        ),
      ),
  }),
  investigate_transaction_history: defineIntelligenceTool({
    description:
      'Investigate recurrence through the report period end for a transaction already inside the report scope. Results are limited to the same permitted account or a shared counterparty document key; callers cannot supply dates, accounts, or document keys.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['transactionId'],
      properties: {
        transactionId: { type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_ITEMS },
        offset: { type: 'integer', minimum: 0, maximum: MAX_LIST_OFFSET },
      },
    },
    parse: parseTransactionHistoryInput,
    execute: (context, input) =>
      investigateTransactionHistory(
        context,
        input,
        context.resolved.config.intelligence.minReportedItemAmountCents,
      ),
  }),
  aggregate_classification_history: defineIntelligenceTool({
    description:
      'Aggregate recurrence through the report period end for the anchor transaction category or labels. The dimension and identifiers are derived from the validated transaction; dates, accounts, and classification keys cannot be supplied by the caller.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['transactionId'],
      properties: {
        transactionId: { type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH },
        dimension: { enum: ['category', 'label'] },
      },
    },
    parse: parseClassificationHistoryInput,
    execute: (context, input) =>
      aggregateClassificationHistory(
        context,
        input,
        context.resolved.config.intelligence.minReportedItemAmountCents,
      ),
  }),
  transaction_charts: defineIntelligenceTool({
    description:
      'Load report-scoped balance points plus deterministic category and label allocations. Internal movements are excluded from transaction allocations.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    parse: parseNoArguments,
    execute: (context) => presentTransactionCharts(context),
  }),
} as const;

function presentTransactionCharts(context: ScopedIntelligenceToolContext): unknown {
  const { db, scope, briefing } = context;
  const dataset = loadReportTransactionChartDataset(db, scope);
  const current = briefing?.analysis.chart.find(
    (period) => period.start === scope.period.start && period.end === scope.period.end,
  );
  return {
    currency: briefing?.analysis.currency ?? dataset.currency,
    dailyBalance: dataset.dailyBalance.map(({ date, balance, isEstimated }) => ({
      date,
      balance,
      isEstimated,
    })),
    categoryTotals: current?.categoryTotals ?? {},
    labelTotals: current?.labelTotals ?? {},
  };
}

function listTransactions(
  context: ScopedIntelligenceToolContext,
  input: ListTransactionsInput,
  floorCents: number,
): unknown {
  const { db, scope } = context;
  const base = baseReportTransactionFilters(scope);
  const filters = createTransactionWebListFilters({
    ...base,
    searchQuery: input.query,
    categoryIds: input.categoryId ? [input.categoryId] : 'all',
    labelIds: input.labelId ? [input.labelId] : 'all',
    transfers: 'hide',
    transactionIds: reportableTransactionIds(context),
    minAbsoluteAmountCents: floorCents,
  });
  const result = listEnrichedTransactionPage(db, filters, {
    limit: input.limit,
    offset: input.offset,
    sort: input.sort,
    timeZone: scope.timeZone,
  });
  return {
    ...result,
    rows: result.rows.map((row) => presentTransaction(db, row)),
    cap: MAX_LIST_ITEMS,
  };
}

function requireScopedTransaction(
  context: ScopedIntelligenceToolContext,
  id: string,
  floorCents: number,
): EnrichedTransaction {
  const { db, scope } = context;
  const row = getEnrichedTransaction(db, id, scope.timeZone, { useCreditPurchaseDate: true });
  if (
    !row ||
    row.local_date < scope.period.start ||
    row.local_date > scope.period.end ||
    isMergedAlias(db, row.account_id) ||
    (scope.report.accountIds.length > 0 && !scope.report.accountIds.includes(row.account_id)) ||
    row.transfer_group !== null ||
    !isReportableTransaction(context, row) ||
    Math.abs(row.amount_in_account_currency_cents) <= floorCents
  ) {
    throw new IntelligenceToolError('Transaction is outside this report scope');
  }
  if (!scope.report.includeUnannotated && !isConfirmedEnrichedTransaction(row)) {
    throw new IntelligenceToolError('Transaction is outside this report scope');
  }
  return row;
}

function investigateTransactionHistory(
  context: ScopedIntelligenceToolContext,
  input: TransactionHistoryInput,
  floorCents: number,
): Record<string, unknown> {
  const { db, scope } = context;
  requireScopedTransaction(context, input.transactionId, floorCents);
  const result = listEnrichedTransactionHistoryPage(
    db,
    createTransactionHistoryScope(context, floorCents),
    {
      limit: input.limit,
      offset: input.offset,
      timeZone: scope.timeZone,
    },
    input.transactionId,
  );
  if (!result) throw new IntelligenceToolError('Transaction is outside this report scope');
  return {
    anchorTransactionId: input.transactionId,
    rows: result.rows.map((row) => ({
      ...presentTransaction(db, row),
      sameAccount: row.account_id === result.anchorAccountId,
      sharedCounterparty: result.sharedCounterpartyIds.has(row.id),
    })),
    total: result.total,
    cap: MAX_LIST_ITEMS,
  };
}

function aggregateClassificationHistory(
  context: ScopedIntelligenceToolContext,
  input: ClassificationHistoryInput,
  floorCents: number,
): Record<string, unknown> {
  const { db, scope } = context;
  const anchor = requireScopedTransaction(context, input.transactionId, floorCents);
  const result = aggregateTransactionHistory(
    db,
    {
      scope: createTransactionHistoryScope(context, floorCents),
      dimension: input.dimension,
      anchor,
    },
    scope.timeZone,
  );
  return {
    anchorTransactionId: input.transactionId,
    dimension: input.dimension,
    keys: result.keys,
    rows: result.rows,
    cap: result.cap,
    truncated: result.truncated,
  };
}

function createTransactionHistoryScope(
  context: ScopedIntelligenceToolContext,
  floorCents: number,
): TransactionHistoryScope {
  const { scope } = context;
  return {
    transactionIds: reportableTransactionIds(context),
    accountIds: scope.report.accountIds.length > 0 ? scope.report.accountIds : 'all',
    startDate: null,
    endDate: scope.period.end,
    classification: scope.report.includeUnannotated ? 'all' : 'classified',
    transfers: 'hide',
    useCreditPurchaseDate: true,
    minAbsoluteAmountCents: floorCents,
  };
}

function isReportableTransaction(
  context: ScopedIntelligenceToolContext,
  row: EnrichedTransaction,
): boolean {
  return Boolean(context.briefing?.[REPORT_BRIEFING_ACCESS].reportableTransactionIds.has(row.id));
}

function reportableTransactionIds(context: ScopedIntelligenceToolContext): readonly string[] {
  return [...(context.briefing?.[REPORT_BRIEFING_ACCESS].reportableTransactionIds ?? [])];
}

function presentTransaction(db: DatabaseSync, row: EnrichedTransaction): Record<string, unknown> {
  const suggestion = loadAssistSuggestion(db, row.id);
  const confirmed = isConfirmedEnrichedTransaction(row);
  const pendingSuggestion =
    !confirmed &&
    suggestion?.reviewStatus === 'pending' &&
    suggestion.status === 'ok' &&
    suggestion.proposal
      ? suggestion
      : null;
  return {
    id: row.id,
    permalink: `#/transaction/${row.id}`,
    accountId: row.account_id,
    account: row.account_display_name,
    occurredAt: row.display_occurred_at,
    localDate: row.local_date,
    amountCents: row.amount_in_account_currency_cents,
    currency: row.account_currency,
    merchant: row.merchant_name,
    description: row.display_description,
    paymentType: row.payment_type,
    status: row.status,
    classificationSource: confirmed ? 'confirmed' : pendingSuggestion ? 'suggestion' : 'none',
    classification: confirmed ? row.annotation : (pendingSuggestion?.proposal ?? null),
    categoryOverrideId: row.category_override_id,
    transfer: row.transfer_group,
    creditCard: row.credit_card,
  };
}

function isConfirmedEnrichedTransaction(row: EnrichedTransaction): boolean {
  return isConfirmedTransactionClassification({
    categoryOverrideId: row.category_override_id,
    annotation: row.annotation
      ? {
          categoryId: row.annotation.categoryId,
          subCategoryId: row.annotation.subCategoryId,
          labels: row.annotation.labels,
          notes: row.annotation.notes,
        }
      : null,
  });
}
