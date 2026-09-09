import type { ResolvedReportConfig, Weekday } from '../types.js';
import { getDateTimeFormat } from '../utils/intl-formatters.js';
import { toLocalDateKey } from '../utils/local-date.js';

export type DueReport = {
  readonly report: ResolvedReportConfig;
  readonly dueKey: string;
};

export function resolveDueReports(
  reports: readonly ResolvedReportConfig[],
  now: Date,
  timeZone: string,
): readonly DueReport[] {
  const dateKey = toLocalDateKey(now.toISOString(), timeZone);
  const localTime = formatLocalTime(now, timeZone);
  const weekday = formatLocalWeekday(now, timeZone);
  const day = Number(dateKey.slice(8, 10));
  const lastDay = new Date(
    Date.UTC(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)), 0),
  ).getUTCDate();

  return reports.flatMap((report) => {
    const schedule = report.schedule;
    let due = false;
    switch (schedule.kind) {
      case 'manual':
        return [];
      case 'daily':
        due = localTime >= schedule.time;
        break;
      case 'weekly':
        due = weekday === schedule.weekday && localTime >= schedule.time;
        break;
      case 'monthly':
        due =
          (schedule.day === 'last' ? day === lastDay : day === schedule.day) &&
          localTime >= schedule.time;
        break;
    }
    return due ? [{ report, dueKey: `${schedule.kind}:${dateKey}` }] : [];
  });
}

function formatLocalTime(now: Date, timeZone: string): string {
  const parts = getDateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

function formatLocalWeekday(now: Date, timeZone: string): Weekday {
  return getDateTimeFormat('en-US', { timeZone, weekday: 'long' })
    .format(now)
    .toLowerCase() as Weekday;
}
