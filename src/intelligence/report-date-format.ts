import type { ReportWindow } from '../types.js';
import type { LocalDatePeriod } from './period.js';

export type ReportDateStyle = 'weekly' | 'monthly' | 'iso';

const ISO_REPORT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function assertNever(value: never): never {
  throw new Error(`Unsupported report window: ${String(value)}`);
}

export function resolveReportDateStyle(windowKind: ReportWindow['kind']): ReportDateStyle {
  switch (windowKind) {
    case 'last-complete-week':
      return 'weekly';
    case 'last-complete-month':
      return 'monthly';
    case 'last-complete-day':
      return 'iso';
    default:
      return assertNever(windowKind);
  }
}

export function reportDateStyleInstruction(style: ReportDateStyle): string {
  switch (style) {
    case 'weekly':
      return 'The renderer converts every date node to `DD/MM (weekday)`, including the subject.';
    case 'monthly':
      return 'The renderer converts every date node to `DD`, including the subject.';
    case 'iso':
      return 'The renderer publishes ISO dates for this report window, including the subject.';
    default:
      return assertNever(style);
  }
}

export function parseReportDate(date: string): Date | null {
  if (!ISO_REPORT_DATE_PATTERN.test(date)) return null;

  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return parsed;
}

export function formatReportDate(date: string, style: ReportDateStyle): string {
  const parsed = parseReportDate(date);
  if (parsed === null) throw new Error(`Invalid report date: ${date}`);
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  if (style === 'weekly') {
    return `${day}/${month} (${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][parsed.getUTCDay()]})`;
  }
  if (style === 'monthly') {
    return day;
  }
  return date;
}

export function formatReportPeriod(period: LocalDatePeriod, style: ReportDateStyle): string {
  return `${formatReportDate(period.start, style)} a ${formatReportDate(period.end, style)}`;
}

export function formatLocalizedReportPeriod(
  period: LocalDatePeriod,
  style: ReportDateStyle,
  language: string,
): string {
  const options: Intl.DateTimeFormatOptions =
    style === 'weekly'
      ? { day: '2-digit', month: '2-digit', weekday: 'short', timeZone: 'UTC' }
      : style === 'monthly'
        ? { day: '2-digit', timeZone: 'UTC' }
        : { dateStyle: 'short', timeZone: 'UTC' };
  const formatter = new Intl.DateTimeFormat(language, options);
  const start = formatter.format(new Date(`${period.start}T12:00:00.000Z`));
  const end = formatter.format(new Date(`${period.end}T12:00:00.000Z`));
  return `${start}..${end}`;
}
