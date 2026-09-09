import { describe, expect, it } from 'vitest';
import { buildTransactionFilterQuery } from '../src/web/server/transaction-request.js';
import { parseTransactionWebFilters } from '../src/web/server/transactions-list.js';

describe('buildTransactionFilterQuery', () => {
  it('maps transaction list query params to filter input', () => {
    const input = buildTransactionFilterQuery((name) => {
      const values: Record<string, string> = {
        date: '2026-06-01',
        'start-date': '2026-06-01',
        'end-date': '2026-06-30',
        account: 'acc-1',
        'category-id': 'food',
        merchant: 'shop',
        description: 'groceries',
        'label-id': 'travel',
        transfers: 'hide',
        installments: 'only',
        classification: 'unclassified',
        unclassified: '1',
        status: 'POSTED',
        'payment-type': 'PIX',
        q: 'coffee',
      };
      return values[name];
    });

    expect(parseTransactionWebFilters(input)).toEqual(
      parseTransactionWebFilters({
        date: '2026-06-01',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        account: 'acc-1',
        categoryId: 'food',
        merchant: 'shop',
        description: 'groceries',
        labelId: 'travel',
        transfers: 'hide',
        installments: 'only',
        classification: 'unclassified',
        unclassified: '1',
        status: 'POSTED',
        paymentType: 'PIX',
        q: 'coffee',
      }),
    );
  });
});
