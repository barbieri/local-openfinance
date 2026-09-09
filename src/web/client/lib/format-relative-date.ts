import { getDateTimeFormat, getRelativeTimeFormat } from '../../../utils/intl-formatters.js';

const RELATIVE_CUTOFF_MS = 7 * 24 * 60 * 60 * 1000;

export function formatRelativeOrAbsoluteDate(
  value: string,
  locale: string,
  now = Date.now(),
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  const ageMs = now - date.getTime();
  if (ageMs > RELATIVE_CUTOFF_MS) {
    return getDateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  const rtf = getRelativeTimeFormat(locale, { numeric: 'auto' });
  const seconds = Math.round(ageMs / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);

  if (seconds < 60) {
    return rtf.format(-seconds, 'second');
  }
  if (minutes < 60) {
    return rtf.format(-minutes, 'minute');
  }
  if (hours < 48) {
    return rtf.format(-hours, 'hour');
  }
  return rtf.format(-days, 'day');
}
