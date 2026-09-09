import { getDateTimeFormat } from '../../../utils/intl-formatters.js';

const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u;

export function isDateTimeLocalValue(value: string): boolean {
  return value.includes('T');
}

export function toDateTimeLocalValue(date: Date): string {
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function startOfTodayLocal(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return toDateTimeLocalValue(date);
}

export function endOfTodayLocal(): string {
  const date = new Date();
  date.setHours(23, 59, 0, 0);
  return toDateTimeLocalValue(date);
}

export function parseDateTimeLocal(value: string): Date | null {
  if (
    !DATETIME_LOCAL_PATTERN.test(value) &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(value)
  ) {
    return null;
  }
  const parsed = new Date(value.length === 16 ? `${value}:00` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function dateTimeLocalToIso(value: string): string {
  if (!isDateTimeLocalValue(value)) {
    return value;
  }
  const parsed = parseDateTimeLocal(value);
  if (!parsed) {
    return value;
  }
  return parsed.toISOString();
}

export function formatDateTimeLocalRange(start: string, end: string, locale: string): string {
  const startDate = parseDateTimeLocal(start);
  const endDate = parseDateTimeLocal(end);
  if (!startDate || !endDate) {
    return `${start} → ${end}`;
  }

  const formatter = getDateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${formatter.format(startDate)} → ${formatter.format(endDate)}`;
}
