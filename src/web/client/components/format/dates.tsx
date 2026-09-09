import { useTranslation } from 'react-i18next';
import { formatLocalDate, formatLocalDateTime } from '../../lib/format.js';

export function FormattedDate({
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
  return <span className={className}>{formatLocalDate(value, i18n.language)}</span>;
}

export function FormattedDateTime({
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
  return <span className={className}>{formatLocalDateTime(value, i18n.language)}</span>;
}
