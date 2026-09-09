import { describe, expect, it } from 'vitest';
import {
  parseCreditCardInstallmentMetadata,
  resolveTransactionMerchantAndDescription,
  stripCreditCardInstallmentSuffix,
} from '../src/openfinance/transaction-merchant.js';

describe('transaction merchant parsing', () => {
  it('strips credit card installment suffix using creditCardMetadata', () => {
    const metadata = { installmentNumber: 9, totalInstallments: 12 };
    expect(stripCreditCardInstallmentSuffix('Disney Plus       09/12', metadata)).toBe(
      'Disney Plus',
    );
  });

  it('strips zero-padded installment suffix when total is single digit', () => {
    const metadata = { installmentNumber: 1, totalInstallments: 3 };
    expect(stripCreditCardInstallmentSuffix('Store Purchase 01/03', metadata)).toBe(
      'Store Purchase',
    );
  });

  it('prefers raw_json.merchant.businessName over name and PIX parsing heuristics', () => {
    const result = resolveTransactionMerchantAndDescription({
      description:
        'PIX EMITIDO OUTRA IF - Pagamento Pix|@***.495.348-**|@servico de manutencao de piscina Burle M|@arx',
      merchant: { name: 'Pool Maintenance Co', businessName: 'POOL MAINTENANCE LTDA' },
      paymentData: {},
    });

    expect(result.merchantName).toBe('POOL MAINTENANCE LTDA');
    expect(result.description).toBe(
      'PIX EMITIDO OUTRA IF - Pagamento Pix|@***.495.348-**|@servico de manutencao de piscina Burle M|@arx',
    );
  });

  it('falls back to merchant.businessName when name is absent', () => {
    const result = resolveTransactionMerchantAndDescription({
      description: 'Some purchase',
      merchant: { businessName: 'NETFLIX ENTRETENIMENTO BRASIL LTDA.' },
      paymentData: {},
    });

    expect(result.merchantName).toBe('NETFLIX ENTRETENIMENTO BRASIL LTDA.');
  });

  it('accepts merchant as a plain string', () => {
    const result = resolveTransactionMerchantAndDescription({
      description: 'Some purchase',
      merchant: 'McDonalds',
      paymentData: {},
    });

    expect(result.merchantName).toBe('McDonalds');
  });

  it('parses Sicoob outbound PIX pipe descriptions', () => {
    const result = resolveTransactionMerchantAndDescription({
      description:
        'PIX EMITIDO OUTRA IF - Pagamento Pix|@***.495.348-**|@servico de manutencao de piscina Burle M|@arx',
      paymentData: {},
    });

    expect(result.merchantName).toBe('***.495.348-**');
    expect(result.description).toBe('servico de manutencao de piscina Burle Marx');
  });

  it('parses Sicoob inbound PIX pipe descriptions', () => {
    const result = resolveTransactionMerchantAndDescription({
      description:
        'PIX RECEBIDO - OUTRA IF - Recebimento Pix|@GUSTAVO SVERZUT BARBIERI|@***.339.558-**|@AFAC',
      paymentData: {},
    });

    expect(result.merchantName).toBe('GUSTAVO SVERZUT BARBIERI (***.339.558-**)');
    expect(result.description).toBe('AFAC');
  });

  it('prefers paymentData.receiver for Itau Pix enviado', () => {
    const result = resolveTransactionMerchantAndDescription({
      description: 'Pix enviado Joao Silva',
      paymentData: { receiver: 'Joao Silva' },
    });

    expect(result.merchantName).toBe('Joao Silva');
  });

  it('parses Itau PIX QR code payments from the description suffix', () => {
    const result = resolveTransactionMerchantAndDescription({
      description: 'Pagamento de Pix QR Code Eimael Oliveira Léon',
      paymentData: {},
    });

    expect(result.merchantName).toBe('Eimael Oliveira Léon');
  });

  it('strips installment suffix when resolving default merchant names', () => {
    const result = resolveTransactionMerchantAndDescription({
      description: 'Disney Plus       09/12',
      creditCardMetadata: { installmentNumber: 9, totalInstallments: 12 },
    });

    expect(result.merchantName).toBe('Disney Plus');
    expect(result.description).toBe('Disney Plus       09/12');
  });

  it('strips glued installment suffix from credit card descriptions', () => {
    const result = resolveTransactionMerchantAndDescription({
      description: 'PORTO SEGURO CIA S01/06',
      paymentData: {},
    });

    expect(result.merchantName).toBe('PORTO SEGURO CIA S');
    expect(result.description).toBe('PORTO SEGURO CIA S01/06');
  });

  it('reads creditCardMetadata installment fields from raw_json', () => {
    expect(
      parseCreditCardInstallmentMetadata({
        creditCardMetadata: { installmentNumber: 3, totalInstallments: 10 },
      }),
    ).toEqual({
      installmentNumber: 3,
      totalInstallments: 10,
    });
  });
});
