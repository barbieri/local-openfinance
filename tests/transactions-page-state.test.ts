import { describe, expect, it } from 'vitest';
import { removeDeletedTransactionIds } from '../src/web/client/pages/transactions-page-selection.js';

describe('removeDeletedTransactionIds', () => {
  it('keeps only selected rows that were not deleted by the detail dialog', () => {
    expect(removeDeletedTransactionIds(['tx-1', 'tx-2', 'tx-3'], ['tx-1', 'tx-3'])).toEqual([
      'tx-2',
    ]);
  });
});
