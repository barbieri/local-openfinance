import { clsx } from 'clsx';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

type FormattedPercentProps = {
  readonly value: number;
  readonly decimals?: number;
  readonly className?: string;
};

export function FormattedPercent({ value, decimals = 0, className }: FormattedPercentProps) {
  const { i18n } = useTranslation();
  const formatter = useMemo(
    () =>
      Intl.NumberFormat(i18n.language, {
        style: 'percent',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    [i18n.language, decimals],
  );
  const formatted = formatter.format(value);
  return <span className={clsx('tabular-nums', className)}>{formatted}</span>;
}
