import { describe, expect, it } from 'vitest';
import {
  parseTransactionCreditCardMetadata,
  parseTransactionMerchantDetail,
  resolvePayeeMccName,
  resolveUpstreamMerchantLabel,
} from '../src/openfinance/transaction-metadata.js';

describe('transaction metadata', () => {
  it('parses credit card metadata from raw json', () => {
    const parsed = parseTransactionCreditCardMetadata({
      creditCardMetadata: {
        billId: 'bill-1',
        purchaseDate: '2026-05-10T12:00:00.000Z',
        totalAmount: 120.5,
        payeeMCC: 5941,
        installmentNumber: 2,
        totalInstallments: 3,
      },
    });

    expect(parsed).toEqual({
      bill_id: 'bill-1',
      purchase_date: '2026-05-10T12:00:00.000Z',
      purchase_total_cents: 12050,
      payee_mcc: 5941,
      installment_number: 2,
      total_installments: 3,
    });
  });

  it('prefers merchant business name for display and mcc resolution', () => {
    const record = {
      merchant: { businessName: 'ACME LTDA', cnpj: '00.000.000/0001-00' },
      creditCardMetadata: { payeeMCC: 5941 },
    };

    expect(parseTransactionMerchantDetail(record)).toMatchObject({
      business_name: 'ACME LTDA',
      cnpj: '00.000.000/0001-00',
    });
    expect(resolveUpstreamMerchantLabel(record)).toBe('ACME LTDA');
    expect(resolvePayeeMccName(5941, 'en', null)).toBe('Sporting Goods Stores');
    expect(resolvePayeeMccName(5941, 'en', 'Grocery')).toBe('Grocery');
  });
});
