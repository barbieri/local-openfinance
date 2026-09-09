import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSACTION_PAGE_SIZE,
  MAX_TRANSACTION_PAGE_SIZE,
  parseTransactionPagination,
} from '../src/web/server/transactions-list.js';

describe('parseTransactionPagination', () => {
  it('defaults page and page-size', () => {
    expect(parseTransactionPagination({})).toEqual({
      page: 1,
      pageSize: DEFAULT_TRANSACTION_PAGE_SIZE,
      offset: 0,
    });
  });

  it('parses valid page and page-size', () => {
    expect(
      parseTransactionPagination({
        page: '3',
        pageSize: '25',
      }),
    ).toEqual({
      page: 3,
      pageSize: 25,
      offset: 50,
    });
  });

  it('clamps page-size to the configured maximum', () => {
    expect(
      parseTransactionPagination({
        pageSize: String(MAX_TRANSACTION_PAGE_SIZE + 50),
      }),
    ).toEqual({
      page: 1,
      pageSize: MAX_TRANSACTION_PAGE_SIZE,
      offset: 0,
    });
  });

  it('rejects invalid page values', () => {
    expect(parseTransactionPagination({ page: '0' })).toEqual({
      error: 'Invalid page parameter: 0',
    });
    expect(parseTransactionPagination({ page: 'abc' })).toEqual({
      error: 'Invalid page parameter: abc',
    });
  });

  it('rejects invalid page-size values', () => {
    expect(parseTransactionPagination({ pageSize: '0' })).toEqual({
      error: 'Invalid page-size parameter: 0',
    });
    expect(parseTransactionPagination({ pageSize: 'NaN' })).toEqual({
      error: 'Invalid page-size parameter: NaN',
    });
  });
});
