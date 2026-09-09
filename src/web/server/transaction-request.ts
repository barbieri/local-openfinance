import type { Context } from 'hono';
import type { TransactionWebListFilters } from '../../db/transaction-query.js';
import { parseTransactionWebFilters } from './transactions-list.js';

export type TransactionFilterQueryInput = Parameters<typeof parseTransactionWebFilters>[0];

export function buildTransactionFilterQuery(
  query: (name: string) => string | undefined,
): TransactionFilterQueryInput {
  return {
    date: query('date'),
    startDate: query('start-date'),
    endDate: query('end-date'),
    account: query('account'),
    categoryId: query('category-id'),
    merchant: query('merchant'),
    description: query('description'),
    labelId: query('label-id'),
    transfers: query('transfers'),
    installments: query('installments'),
    classification: query('classification'),
    unclassified: query('unclassified'),
    status: query('status'),
    paymentType: query('payment-type'),
    q: query('q'),
    billId: query('bill-id'),
    displayDate: query('display-date'),
  };
}

export function parseTransactionFiltersFromRequest(c: Context): TransactionWebListFilters {
  return parseTransactionWebFilters(buildTransactionFilterQuery((name) => c.req.query(name)));
}
