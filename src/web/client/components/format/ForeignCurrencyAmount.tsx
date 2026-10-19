import { clsx } from 'clsx';
import {
  isForeignCurrencyTransaction,
  transactionAccountingAmount,
} from '../../../../db/transaction-foreign-amount.js';
import { FormattedCurrency } from './FormattedCurrency.js';

type ForeignCurrencyAmountProps = {
  readonly amountCents: number;
  readonly accountType?: string | undefined;
  readonly currency: string;
  readonly accountCurrency: string;
  readonly amountInAccountCurrencyCents?: number | null;
  readonly className?: string;
  readonly signed?: boolean;
};

export function ForeignCurrencyAmount({
  amountCents: rawAmountCents,
  accountType,
  currency,
  accountCurrency,
  amountInAccountCurrencyCents,
  className,
  signed = true,
}: ForeignCurrencyAmountProps) {
  const amountCents = transactionAccountingAmount(rawAmountCents, accountType);
  const accountAmountCents = transactionAccountingAmount(
    amountInAccountCurrencyCents ?? rawAmountCents,
    accountType,
  );
  const hasForeignAmount = isForeignCurrencyTransaction(currency, accountCurrency);

  if (!hasForeignAmount) {
    return (
      <FormattedCurrency
        amountCents={amountCents}
        currency={currency}
        className={className}
        signed={signed}
      />
    );
  }

  return (
    <span className={clsx('tabular-nums', className)}>
      <FormattedCurrency amountCents={amountCents} currency={currency} signed={signed} />
      {' ('}
      <FormattedCurrency
        amountCents={accountAmountCents}
        currency={accountCurrency}
        signed={signed}
      />
      {')'}
    </span>
  );
}
