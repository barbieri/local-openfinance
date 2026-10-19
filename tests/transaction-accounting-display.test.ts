import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { transactionAccountingAmount } from '../src/db/transaction-foreign-amount.js';
import { ForeignCurrencyAmount } from '../src/web/client/components/format/ForeignCurrencyAmount.js';
import { buildTransactionRowGrouping } from '../src/web/client/lib/transaction-row-grouping.js';

describe('transaction accounting display', () => {
  it('renders foreign card purchases as debits and refunds as credits without changing FX magnitude', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'en-US', resources: {} });
    const render = (amountCents: number, accountAmount: number) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(ForeignCurrencyAmount, {
            amountCents,
            amountInAccountCurrencyCents: accountAmount,
            accountType: 'CREDIT',
            currency: 'USD',
            accountCurrency: 'BRL',
          }),
        ),
      );
    const purchase = render(100, 500);
    expect(purchase).toContain('-$1.00');
    expect(purchase).toContain('-R$5.00');
    expect(purchase.match(/--debit/g)).toHaveLength(2);
    const refund = render(-100, -500);
    expect(refund).toContain('+$1.00');
    expect(refund).toContain('+R$5.00');
    expect(refund.match(/--credit/g)).toHaveLength(2);
    expect(transactionAccountingAmount(-100, 'BANK')).toBe(-100);
  });

  it('uses signed card contributions in group totals', () => {
    const grouping = buildTransactionRowGrouping({
      rows: [1000, -250].map((amount, index) => ({
        id: String(index),
        account_id: 'card',
        account_type: 'CREDIT',
        local_date: '2026-06-01',
        display_name: 'Card',
        merchant_name: null,
        category_id: null,
        category_override_id: null,
        category_presentation: null,
        amount_in_account_currency_cents: amount,
        account_currency: 'BRL',
        annotation: null,
      })),
      accounts: [],
      groupBy: ['date'],
      locale: 'en-US',
      t: i18next.t,
    });
    expect(grouping.groups[0]?.amountSummary).toEqual({
      positiveCents: 250,
      negativeCents: -1000,
      balanceCents: -750,
      currency: 'BRL',
      mixedCurrencies: false,
    });
  });
});
