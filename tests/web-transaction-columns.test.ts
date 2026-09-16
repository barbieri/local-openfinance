import { describe, expect, it } from 'vitest';
import {
  TRANSACTION_COLUMN_KEYS,
  type TransactionColumnKey,
} from '../src/web/client/components/transactions/transactions-page-column-keys.js';
import { resolveTransactionVisibleColumns } from '../src/web/client/lib/transaction-visible-columns.js';

const allColumns = new Set<TransactionColumnKey>(TRANSACTION_COLUMN_KEYS);

describe('transaction table columns', () => {
  it('hides the transfer column only while transfers are hidden', () => {
    expect(resolveTransactionVisibleColumns(allColumns, { transfers: 'hide' })).not.toContain(
      'transfer',
    );
    expect(resolveTransactionVisibleColumns(allColumns, { transfers: 'only' })).toContain(
      'transfer',
    );
    expect(resolveTransactionVisibleColumns(allColumns, {})).toContain('transfer');
  });

  it('hides the installments column only while installments are hidden', () => {
    expect(resolveTransactionVisibleColumns(allColumns, { installments: 'hide' })).not.toContain(
      'installments',
    );
    expect(resolveTransactionVisibleColumns(allColumns, { installments: 'only' })).toContain(
      'installments',
    );
    expect(resolveTransactionVisibleColumns(allColumns, {})).toContain('installments');
  });

  it('preserves selected columns so both columns return when filters are restored', () => {
    const selected = new Set<TransactionColumnKey>(['installments', 'transfer']);

    expect(
      resolveTransactionVisibleColumns(selected, {
        transfers: 'hide',
        installments: 'hide',
      }),
    ).toEqual(new Set(['select']));
    expect(resolveTransactionVisibleColumns(selected, {})).toEqual(
      new Set(['installments', 'transfer']),
    );
    expect(selected).toEqual(new Set(['installments', 'transfer']));
  });
});
