import type { ReportWindow } from '../types.js';

export type LocalDatePeriod = {
  readonly start: string;
  readonly end: string;
};

function parseDateKey(dateKey: string): Date {
  const [yearText, monthText, dayText] = dateKey.split('-');
  return new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText), 12));
}

function formatDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToLocalDateKey(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

export function shiftLocalDateKeyMonths(dateKey: string, months: number): string {
  const date = parseDateKey(`${dateKey.slice(0, 7)}-01`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return formatDateKey(date);
}

export function monthKeyFromDateKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function lastCompleteMonthKey(periodEnd: string): string {
  const [yearText, monthText, dayText] = periodEnd.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day === lastDay) {
    return monthKeyFromDateKey(periodEnd);
  }
  return monthKeyFromDateKey(addDaysToLocalDateKey(`${yearText}-${monthText}-01`, -1));
}

export function resolveLastCompleteWeek(todayDateKey: string): LocalDatePeriod {
  const today = parseDateKey(todayDateKey);
  const weekday = today.getUTCDay();
  const daysFromMonday = (weekday + 6) % 7;
  const currentMonday = new Date(today);
  currentMonday.setUTCDate(currentMonday.getUTCDate() - daysFromMonday);
  const lastMonday = new Date(currentMonday);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setUTCDate(lastSunday.getUTCDate() + 6);
  return { start: formatDateKey(lastMonday), end: formatDateKey(lastSunday) };
}

export function resolveReportWindowPeriod(
  window: ReportWindow,
  todayDateKey: string,
): LocalDatePeriod {
  switch (window.kind) {
    case 'last-complete-day': {
      const day = addDaysToLocalDateKey(todayDateKey, -1);
      return { start: day, end: day };
    }
    case 'last-complete-week':
      return resolveLastCompleteWeek(todayDateKey);
    case 'last-complete-month': {
      const currentMonthStart = `${todayDateKey.slice(0, 7)}-01`;
      const end = addDaysToLocalDateKey(currentMonthStart, -1);
      return { start: `${end.slice(0, 7)}-01`, end };
    }
  }
}

export function inclusiveDateKeys(start: string, end: string): readonly string[] {
  const keys: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    keys.push(cursor);
    cursor = addDaysToLocalDateKey(cursor, 1);
  }
  return keys;
}
