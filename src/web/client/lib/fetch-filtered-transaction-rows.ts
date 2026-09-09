import { apiJson } from './api.js';
import { collectPagedRows } from './collect-paged-rows.js';
import { TRANSACTION_EXPORT_PAGE_SIZE } from './transaction-filters.js';

export async function fetchAllFilteredTransactionRows<T>(options: {
  readonly filterQuery: string;
  readonly locale: string;
}): Promise<T[]> {
  return collectPagedRows(async (page) => {
    const params = new URLSearchParams(options.filterQuery);
    params.set('page', String(page));
    params.set('page-size', String(TRANSACTION_EXPORT_PAGE_SIZE));
    params.set('locale', options.locale);
    return apiJson<{ readonly rows: readonly T[]; readonly total: number }>(
      `/api/transactions?${params.toString()}`,
    );
  });
}
