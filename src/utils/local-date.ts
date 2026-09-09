import { getDateTimeFormat } from './intl-formatters.js';

export function resolveLocalTimeZone(): string {
  const configured = process.env['TZ']?.trim();
  return configured && configured.length > 0
    ? configured
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function toLocalDateKey(occurredAt: string, timeZone = resolveLocalTimeZone()): string {
  return getDateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(occurredAt));
}
