import { formatCurrencyAmount } from '../../lib/format.js';

type ChartAmountTooltipProps = {
  readonly active?: boolean;
  readonly payload?: ReadonlyArray<{ readonly value?: number; readonly name?: string }>;
  readonly label?: string;
  readonly currency: string;
  readonly locale: string;
};

export function ChartAmountTooltip({
  active,
  payload,
  label,
  currency,
  locale,
}: ChartAmountTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const value = payload[0]?.value;
  if (typeof value !== 'number') {
    return null;
  }

  return (
    <div className="rounded border border-border bg-background px-2 py-1 text-xs shadow-sm">
      {label ? <div className="font-medium">{label}</div> : null}
      <div className="tabular-nums">{formatCurrencyAmount(value, currency, locale)}</div>
    </div>
  );
}
