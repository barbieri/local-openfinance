import { FormattedCurrency } from './FormattedCurrency.js';

type GrandTotalSummaryProps = {
  readonly label: string;
  readonly countLabel?: string;
  readonly totalsByCurrency: ReadonlyArray<readonly [string, number]>;
  readonly signed?: boolean;
};

export function GrandTotalSummary({
  label,
  countLabel,
  totalsByCurrency,
  signed = false,
}: GrandTotalSummaryProps) {
  if (totalsByCurrency.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="font-semibold text-foreground">{label}</span>
      {totalsByCurrency.map(([currency, amountCents]) => (
        <FormattedCurrency
          key={currency}
          amountCents={amountCents}
          currency={currency}
          signed={signed}
          className="font-semibold"
        />
      ))}
      {countLabel ? <span className="text-muted-foreground">{countLabel}</span> : null}
    </div>
  );
}
