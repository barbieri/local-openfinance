import { describe, expect, it } from 'vitest';
import { resolveImportedCreditCardBillPaymentStatus } from '../src/openfinance/credit-card-bill-status.js';

const TIME_ZONE = 'America/Sao_Paulo';

describe('resolveImportedCreditCardBillPaymentStatus', () => {
  it('converts zero-total past-due unconfirmed bills to PAID', () => {
    expect(
      resolveImportedCreditCardBillPaymentStatus({
        paymentStatus: 'PAST_DUE_UNCONFIRMED',
        totalAmountCents: 0,
        dueDate: '2026-05-20T03:00:00.000Z',
        referenceDate: new Date('2026-06-11T12:00:00.000Z'),
        timeZone: TIME_ZONE,
      }),
    ).toBe('PAID');
  });

  it('converts zero-total past-due unpaid bills to PAID', () => {
    expect(
      resolveImportedCreditCardBillPaymentStatus({
        paymentStatus: 'PAST_DUE_UNPAID',
        totalAmountCents: 0,
        dueDate: '2026-05-20T03:00:00.000Z',
        referenceDate: new Date('2026-06-11T12:00:00.000Z'),
        timeZone: TIME_ZONE,
      }),
    ).toBe('PAID');
  });

  it('leaves future zero-total past-due bills unchanged', () => {
    expect(
      resolveImportedCreditCardBillPaymentStatus({
        paymentStatus: 'PAST_DUE_UNCONFIRMED',
        totalAmountCents: 0,
        dueDate: '2026-07-20T03:00:00.000Z',
        referenceDate: new Date('2026-06-11T12:00:00.000Z'),
        timeZone: TIME_ZONE,
      }),
    ).toBe('PAST_DUE_UNCONFIRMED');
  });

  it('leaves positive-total past-due bills unchanged', () => {
    expect(
      resolveImportedCreditCardBillPaymentStatus({
        paymentStatus: 'PAST_DUE_UNPAID',
        totalAmountCents: 150000,
        dueDate: '2026-05-20T03:00:00.000Z',
        referenceDate: new Date('2026-06-11T12:00:00.000Z'),
        timeZone: TIME_ZONE,
      }),
    ).toBe('PAST_DUE_UNPAID');
  });

  it('does not treat due today as past', () => {
    expect(
      resolveImportedCreditCardBillPaymentStatus({
        paymentStatus: 'PAST_DUE_UNCONFIRMED',
        totalAmountCents: 0,
        dueDate: '2026-06-11T03:00:00.000Z',
        referenceDate: new Date('2026-06-11T12:00:00.000Z'),
        timeZone: TIME_ZONE,
      }),
    ).toBe('PAST_DUE_UNCONFIRMED');
  });

  it('leaves other statuses unchanged', () => {
    expect(
      resolveImportedCreditCardBillPaymentStatus({
        paymentStatus: 'OPEN',
        totalAmountCents: 0,
        dueDate: '2026-05-20T03:00:00.000Z',
        referenceDate: new Date('2026-06-11T12:00:00.000Z'),
        timeZone: TIME_ZONE,
      }),
    ).toBe('OPEN');
  });
});
