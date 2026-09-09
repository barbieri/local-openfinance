import { clsx } from 'clsx';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

type FormattedNumberProps = {
  readonly value: number;
  readonly className?: string;
};

export function FormattedNumber({ value, className }: FormattedNumberProps) {
  const { i18n } = useTranslation();
  const formatter = useMemo(
    () => Intl.NumberFormat(i18n.language, { useGrouping: true }),
    [i18n.language],
  );
  const formatted = formatter.format(value);
  return <span className={clsx('tabular-nums', className)}>{formatted}</span>;
}
