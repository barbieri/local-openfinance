import {
  parseTransactionAccountFilter,
  parseTransactionCategoryFilter,
  parseTransactionPaymentTypeFilter,
  parseTransactionStatusFilter,
  resolveTransactionDateRange,
} from '../../db/transaction-details.js';
import {
  parseTransactionBillIdFilter,
  parseTransactionClassificationFilter,
  parseTransactionInstallmentsFilter,
  parseTransactionLabelFilter,
  parseTransactionTransfersFilter,
  parseTransactionUseCreditPurchaseDate,
  type TransactionWebListFilters,
} from '../../db/transaction-query.js';

export const DEFAULT_TRANSACTION_PAGE_SIZE = 50;
export const MAX_TRANSACTION_PAGE_SIZE = 200;

export type TransactionPagination = {
  readonly page: number;
  readonly pageSize: number;
  readonly offset: number;
};

export type TransactionPaginationParseResult = TransactionPagination | { readonly error: string };

export function parseTransactionPagination(query: {
  readonly page?: string | undefined;
  readonly pageSize?: string | undefined;
}): TransactionPaginationParseResult {
  const pageRaw = query.page ?? '1';
  const page = Number.parseInt(pageRaw, 10);
  if (!Number.isFinite(page) || page < 1) {
    return { error: `Invalid page parameter: ${pageRaw}` };
  }

  const pageSizeRaw = query.pageSize ?? String(DEFAULT_TRANSACTION_PAGE_SIZE);
  const pageSizeParsed = Number.parseInt(pageSizeRaw, 10);
  if (!Number.isFinite(pageSizeParsed) || pageSizeParsed < 1) {
    return { error: `Invalid page-size parameter: ${pageSizeRaw}` };
  }

  const pageSize = Math.min(pageSizeParsed, MAX_TRANSACTION_PAGE_SIZE);
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function parseTransactionWebFilters(query: {
  readonly date?: string | undefined;
  readonly startDate?: string | undefined;
  readonly endDate?: string | undefined;
  readonly account?: string | undefined;
  readonly categoryId?: string | undefined;
  readonly merchant?: string | undefined;
  readonly description?: string | undefined;
  readonly labelId?: string | undefined;
  readonly transfers?: string | undefined;
  readonly installments?: string | undefined;
  readonly classification?: string | undefined;
  readonly unclassified?: string | undefined;
  readonly status?: string | undefined;
  readonly paymentType?: string | undefined;
  readonly q?: string | undefined;
  readonly billId?: string | undefined;
  readonly displayDate?: string | undefined;
}): TransactionWebListFilters {
  return {
    status: parseTransactionStatusFilter(query.status),
    accountIds: parseTransactionAccountFilter(query.account),
    categoryIds: parseTransactionCategoryFilter(query.categoryId),
    merchantPattern: null,
    merchantQuery: query.merchant?.trim() || null,
    descriptionQuery: query.description?.trim() || null,
    paymentTypes: parseTransactionPaymentTypeFilter(query.paymentType),
    labelIds: parseTransactionLabelFilter(query.labelId),
    transfers: parseTransactionTransfersFilter(query.transfers),
    installments: parseTransactionInstallmentsFilter(query.installments),
    classification:
      query.unclassified === '1' && !query.classification
        ? 'unclassified'
        : parseTransactionClassificationFilter(query.classification),
    searchQuery: query.q?.trim() || null,
    billId: parseTransactionBillIdFilter(query.billId),
    useCreditPurchaseDate: parseTransactionUseCreditPurchaseDate(query.displayDate),
    minAbsoluteAmountCents: null,
    ...resolveTransactionDateRange({
      date: query.date,
      startDate: query.startDate,
      endDate: query.endDate,
    }),
  };
}
