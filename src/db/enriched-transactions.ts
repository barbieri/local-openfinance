import type { DatabaseSync } from 'node:sqlite';
import { resolveLocalTimeZone } from '../utils/local-date.js';
import { resolveCategoryTranslationEnabled } from '../utils/locale-resolve.js';
import { buildCategoryIndex } from './category-display.js';
import {
  type EnrichedTransaction,
  enrichTransactionRow,
  loadTransactionRowById,
} from './transaction-details.js';
import {
  listEnrichedTransactionsPage,
  parseTransactionSort,
  type TransactionWebListFilters,
} from './transaction-query.js';

export type EnrichedTransactionListResult = {
  readonly rows: ReturnType<typeof listEnrichedTransactionsPage>['rows'];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly page: number;
  readonly pageCount: number;
};

export function getEnrichedTransaction(
  db: DatabaseSync,
  transactionId: string,
  timeZone = resolveLocalTimeZone(),
  options: {
    readonly useCreditPurchaseDate?: boolean | undefined;
    readonly locale?: string | undefined;
  } = {},
): EnrichedTransaction | null {
  const row = loadTransactionRowById(db, transactionId);
  if (!row) {
    return null;
  }
  const categoryIndex = buildCategoryIndex(db, {
    translateNames: resolveCategoryTranslationEnabled(options.locale),
  });
  return enrichTransactionRow(db, row, timeZone, categoryIndex, {
    useCreditPurchaseDate: options.useCreditPurchaseDate === true,
    locale: options.locale,
  });
}

export function listEnrichedTransactionPage(
  db: DatabaseSync,
  filters: TransactionWebListFilters,
  options: {
    readonly limit: number;
    readonly offset: number;
    readonly sort?: string | undefined;
    readonly timeZone?: string | undefined;
    readonly locale?: string | undefined;
  },
): EnrichedTransactionListResult {
  const result = listEnrichedTransactionsPage(db, filters, {
    limit: options.limit,
    offset: options.offset,
    sort: parseTransactionSort(options.sort),
    timeZone: options.timeZone ?? resolveLocalTimeZone(),
    locale: options.locale,
  });
  return {
    rows: result.rows,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    page: Math.floor(options.offset / options.limit) + 1,
    pageCount: result.total === 0 ? 0 : Math.ceil(result.total / options.limit),
  };
}
