import { useTranslation } from 'react-i18next';
import { formatRelativeOrAbsoluteDate } from '../../lib/format-relative-date.js';

export function FormattedSyncTime({
  value,
  className,
}: {
  readonly value: string | null | undefined;
  readonly className?: string;
}) {
  const { i18n } = useTranslation();
  if (!value) {
    return <>—</>;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <>—</>;
  }

  const formatted = formatRelativeOrAbsoluteDate(value, i18n.language);

  return (
    <span className={className} title={date.toISOString()}>
      {formatted}
    </span>
  );
}
