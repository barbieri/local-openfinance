import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  buildTransactionRowGrouping,
  type TransactionGroupingRow,
} from '../src/web/client/lib/transaction-row-grouping.js';

const t = ((key: string, options?: { readonly count?: number }) => {
  const labels: Record<string, string> = {
    'columns.account': 'Account',
    'columns.connection': 'Connection',
    'columns.date': 'Date',
    'columns.labels': 'Labels',
    'filters.unlabeled': 'Unlabeled',
    'table.groupRows': `${options?.count ?? 0} rows`,
  };
  return labels[key] ?? key;
}) as TFunction;

function transactionRow(overrides: Partial<TransactionGroupingRow>): TransactionGroupingRow {
  return {
    id: 'tx',
    account_id: 'acc-1',
    local_date: '2026-06-01',
    display_name: 'Account 1',
    merchant_name: null,
    category_id: null,
    category_override_id: null,
    category_presentation: null,
    amount_in_account_currency_cents: -1000,
    account_currency: 'BRL',
    annotation: null,
    ...overrides,
  };
}

describe('buildTransactionRowGrouping', () => {
  it('groups rows by nested fields without duplicating multi-label transactions', () => {
    const grouping = buildTransactionRowGrouping({
      rows: [
        transactionRow({
          id: 'tx-1',
          account_id: 'acc-1',
          amount_in_account_currency_cents: 5000,
          annotation: {
            labels: ['Food', 'Work'],
            labelIds: ['food', 'work'],
            labelPresentations: [
              {
                id: 'food',
                name: 'Food',
                icon: 'MdRestaurant',
                color: '#ef4444',
                path: 'Food',
              },
              {
                id: 'work',
                name: 'Work',
                icon: 'MdWork',
                color: '#2563eb',
                path: 'Work',
              },
            ],
          },
        }),
        transactionRow({
          id: 'tx-2',
          account_id: 'acc-2',
          amount_in_account_currency_cents: -2000,
        }),
      ],
      groupBy: ['connection', 'label'],
      accounts: [
        {
          id: 'acc-1',
          connection_item_id: 'conn-1',
          connection_display_name: 'Bank One',
          display_name: 'Checking',
        },
        {
          id: 'acc-2',
          connection_item_id: 'conn-1',
          connection_display_name: 'Bank One',
          display_name: 'Savings',
        },
      ],
      locale: 'en-US',
      t,
    });

    expect(grouping.rows.map((row) => row.id)).toEqual(['tx-1', 'tx-2']);
    expect(grouping.groups).toHaveLength(1);
    expect(grouping.groups[0]?.label).toBe('Connection: Bank One');
    expect(grouping.groups[0]?.children?.map((group) => group.label)).toEqual([
      'Labels: Food, Work',
      'Labels: Unlabeled',
    ]);
    expect(grouping.groups[0]?.children?.map((group) => group.count)).toEqual([1, 1]);
    expect(grouping.groups[0]?.allRowIndexes).toEqual([0, 1]);
    expect(grouping.groups[0]?.amountSummary).toEqual({
      positiveCents: 5000,
      negativeCents: -2000,
      balanceCents: 3000,
      currency: 'BRL',
      mixedCurrencies: false,
    });
    expect(grouping.groups[0]?.children?.[0]?.labelPresentations).toEqual([
      {
        id: 'food',
        name: 'Food',
        icon: 'MdRestaurant',
        color: '#ef4444',
        path: 'Food',
      },
      {
        id: 'work',
        name: 'Work',
        icon: 'MdWork',
        color: '#2563eb',
        path: 'Work',
      },
    ]);
  });
});
