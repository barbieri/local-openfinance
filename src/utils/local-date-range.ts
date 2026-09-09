import { getDateTimeFormat } from './intl-formatters.js';
import { toLocalDateKey } from './local-date.js';

export type LocalDateRange = {
  readonly startDate: string | null;
  readonly endDate: string | null;
};

export type DateNavigationUnit = 'day' | 'week' | 'month' | 'year';

export type DateNavigationSpec =
  | { readonly kind: 'unit'; readonly unit: DateNavigationUnit }
  | { readonly kind: 'duration'; readonly days: number };

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function resolveFlexibleLocalDateRange(
  input: {
    readonly date?: string | undefined;
    readonly startDate?: string | undefined;
    readonly endDate?: string | undefined;
  },
  timeZone: string,
): LocalDateRange | null {
  const dateValue = input.date?.trim();
  if (dateValue === 'custom') {
    const startDate = input.startDate?.trim() ?? null;
    const endDate = input.endDate?.trim() ?? null;
    if (!startDate && !endDate) {
      return null;
    }
    return { startDate, endDate };
  }

  if (dateValue) {
    return resolveDateSelector(dateValue, timeZone);
  }

  const startDate = input.startDate?.trim() ?? null;
  const endDate = input.endDate?.trim() ?? null;
  if (!startDate && !endDate) {
    return null;
  }

  return { startDate, endDate };
}

export function resolveDateSelector(value: string, timeZone: string): LocalDateRange {
  const shortcut = resolveDateShortcut(value, timeZone);
  if (shortcut) {
    return shortcut;
  }

  if (/^\d{4}$/u.test(value)) {
    return {
      startDate: `${value}-01-01`,
      endDate: `${value}-12-31`,
    };
  }

  if (/^\d{4}-\d{2}$/u.test(value)) {
    const [yearText, monthText] = value.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      startDate: `${value}-01`,
      endDate: `${value}-${String(lastDay).padStart(2, '0')}`,
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return {
      startDate: value,
      endDate: value,
    };
  }

  throw new Error(
    `Invalid --date value "${value}". Use today, yesterday, tomorrow, this-week, this-month, ytd, last-12-months, YYYY, YYYY-MM, or YYYY-MM-DD.`,
  );
}

function resolveDateShortcut(value: string, timeZone: string): LocalDateRange | null {
  const normalized = value.trim().toLowerCase();
  const today = toLocalDateKey(new Date().toISOString(), timeZone);

  switch (normalized) {
    case 'today':
      return singleDayRange(today);
    case 'yesterday':
      return singleDayRange(addDaysToDateKey(today, -1, timeZone));
    case 'tomorrow':
      return singleDayRange(addDaysToDateKey(today, 1, timeZone));
    case 'this-month':
      return monthRangeFromDateKey(today);
    case 'past-month':
      return monthRangeFromDateKey(addMonthsToDateKey(today, -1, timeZone));
    case 'ytd': {
      const yearText = today.split('-')[0] ?? '';
      return {
        startDate: `${yearText}-01-01`,
        endDate: today,
      };
    }
    case 'last-12-months':
      return {
        startDate: addMonthsToDateKey(today, -12, timeZone),
        endDate: today,
      };
    case 'this-week':
      return weekRangeFromDateKey(today, timeZone);
    case 'past-week': {
      const end = addDaysToDateKey(today, -1, timeZone);
      const start = addDaysToDateKey(end, -6, timeZone);
      return { startDate: start, endDate: end };
    }
    default:
      return null;
  }
}

function singleDayRange(dateKey: string): LocalDateRange {
  return {
    startDate: dateKey,
    endDate: dateKey,
  };
}

function monthRangeFromDateKey(dateKey: string): LocalDateRange {
  const [yearText, monthText] = dateKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    startDate: `${yearText}-${monthText}-01`,
    endDate: `${yearText}-${monthText}-${String(lastDay).padStart(2, '0')}`,
  };
}

function weekRangeFromDateKey(dateKey: string, timeZone: string): LocalDateRange {
  const weekday = getLocalWeekdayIndex(dateKey, timeZone);
  const daysFromMonday = (weekday + 6) % 7;
  const startDate = addDaysToDateKey(dateKey, -daysFromMonday, timeZone);
  const endDate = addDaysToDateKey(startDate, 6, timeZone);

  return { startDate, endDate };
}

function getLocalWeekdayIndex(dateKey: string, timeZone: string): number {
  const weekday = getDateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(new Date(`${dateKey}T12:00:00.000Z`));

  return WEEKDAY_INDEX[weekday] ?? 0;
}

function addDaysToDateKey(dateKey: string, days: number, timeZone: string): string {
  const [yearText, monthText, dayText] = dateKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));

  return toLocalDateKey(shifted.toISOString(), timeZone);
}

function addMonthsToDateKey(dateKey: string, months: number, timeZone: string): string {
  const [yearText, monthText, dayText] = dateKey.split('-');
  let year = Number(yearText);
  let month = Number(monthText);
  const day = Number(dayText);

  month += months;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  while (month < 1) {
    month += 12;
    year -= 1;
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);

  return toLocalDateKey(
    new Date(Date.UTC(year, month - 1, clampedDay, 12)).toISOString(),
    timeZone,
  );
}

function dateKeyFromRangeValue(value: string): string {
  return value.slice(0, 10);
}

export function isFullMonthDateRange(startDate: string, endDate: string): boolean {
  const start = dateKeyFromRangeValue(startDate);
  const end = dateKeyFromRangeValue(endDate);
  const monthRange = monthRangeFromDateKey(start);
  return monthRange.startDate === start && monthRange.endDate === end;
}

export function isFullYearDateRange(startDate: string, endDate: string): boolean {
  const start = dateKeyFromRangeValue(startDate);
  const end = dateKeyFromRangeValue(endDate);
  const year = start.slice(0, 4);
  return start === `${year}-01-01` && end === `${year}-12-31`;
}

export function countInclusiveLocalDays(
  startDate: string,
  endDate: string,
  timeZone: string,
): number {
  const start = dateKeyFromRangeValue(startDate);
  const end = dateKeyFromRangeValue(endDate);
  let count = 0;
  let cursor = start;
  while (cursor <= end && count < 400) {
    count += 1;
    if (cursor === end) {
      break;
    }
    cursor = addDaysToDateKey(cursor, 1, timeZone);
  }
  return count;
}

export function resolveDateNavigationSpec(
  preset: string | null,
  range: LocalDateRange,
  timeZone: string,
): DateNavigationSpec | null {
  if (!range.startDate || !range.endDate) {
    return null;
  }

  switch (preset) {
    case 'today':
    case 'yesterday':
    case 'tomorrow':
      return { kind: 'unit', unit: 'day' };
    case 'this-week':
    case 'past-week':
      return { kind: 'unit', unit: 'week' };
    case 'this-month':
    case 'past-month':
      return { kind: 'unit', unit: 'month' };
    case 'ytd':
      return { kind: 'unit', unit: 'year' };
    case 'last-12-months':
      return { kind: 'unit', unit: 'month' };
    default:
      return inferDateNavigationSpecFromRange(range, timeZone);
  }
}

function inferDateNavigationSpecFromRange(
  range: LocalDateRange,
  timeZone: string,
): DateNavigationSpec | null {
  if (!range.startDate || !range.endDate) {
    return null;
  }

  const start = dateKeyFromRangeValue(range.startDate);
  const end = dateKeyFromRangeValue(range.endDate);
  if (start === end) {
    return { kind: 'unit', unit: 'day' };
  }
  if (isFullMonthDateRange(start, end)) {
    return { kind: 'unit', unit: 'month' };
  }
  if (isFullYearDateRange(start, end)) {
    return { kind: 'unit', unit: 'year' };
  }

  const days = countInclusiveLocalDays(start, end, timeZone);
  if (days === 7) {
    return { kind: 'unit', unit: 'week' };
  }
  if (days > 1) {
    return { kind: 'duration', days };
  }

  return null;
}

export function shiftLocalDateRange(
  range: LocalDateRange,
  spec: DateNavigationSpec,
  steps: number,
  timeZone: string,
): LocalDateRange {
  if (!range.startDate || !range.endDate) {
    return range;
  }

  const startKey = dateKeyFromRangeValue(range.startDate);
  const endKey = dateKeyFromRangeValue(range.endDate);
  const startSuffix = range.startDate.length > 10 ? range.startDate.slice(10) : '';
  const endSuffix = range.endDate.length > 10 ? range.endDate.slice(10) : '';
  const shiftedKeys = shiftDateKeys(startKey, endKey, spec, steps, timeZone);

  return {
    startDate: `${shiftedKeys.startKey}${startSuffix}`,
    endDate: `${shiftedKeys.endKey}${endSuffix}`,
  };
}

function shiftDateKeys(
  startKey: string,
  endKey: string,
  spec: DateNavigationSpec,
  steps: number,
  timeZone: string,
): { readonly startKey: string; readonly endKey: string } {
  if (spec.kind === 'duration') {
    const deltaDays = spec.days * steps;
    return {
      startKey: addDaysToDateKey(startKey, deltaDays, timeZone),
      endKey: addDaysToDateKey(endKey, deltaDays, timeZone),
    };
  }

  return shiftDateKeysByUnit(startKey, endKey, spec.unit, steps, timeZone);
}

function shiftDateKeysByUnit(
  startKey: string,
  endKey: string,
  unit: DateNavigationUnit,
  steps: number,
  timeZone: string,
): { readonly startKey: string; readonly endKey: string } {
  switch (unit) {
    case 'day':
      return {
        startKey: addDaysToDateKey(startKey, steps, timeZone),
        endKey: addDaysToDateKey(endKey, steps, timeZone),
      };
    case 'week':
      return {
        startKey: addDaysToDateKey(startKey, steps * 7, timeZone),
        endKey: addDaysToDateKey(endKey, steps * 7, timeZone),
      };
    case 'month':
      return shiftMonthDateKeys(startKey, endKey, steps, timeZone);
    case 'year':
      return shiftYearDateKeys(startKey, endKey, steps, timeZone);
  }
}

function shiftMonthDateKeys(
  startKey: string,
  endKey: string,
  steps: number,
  timeZone: string,
): { readonly startKey: string; readonly endKey: string } {
  if (isFullMonthDateRange(startKey, endKey)) {
    const monthRange = monthRangeFromDateKey(addMonthsToDateKey(startKey, steps, timeZone));
    return {
      startKey: monthRange.startDate ?? startKey,
      endKey: monthRange.endDate ?? endKey,
    };
  }

  return {
    startKey: addMonthsToDateKey(startKey, steps, timeZone),
    endKey: addMonthsToDateKey(endKey, steps, timeZone),
  };
}

function shiftYearDateKeys(
  startKey: string,
  endKey: string,
  steps: number,
  timeZone: string,
): { readonly startKey: string; readonly endKey: string } {
  if (isFullYearDateRange(startKey, endKey)) {
    const year = Number(startKey.slice(0, 4)) + steps;
    return {
      startKey: `${year}-01-01`,
      endKey: `${year}-12-31`,
    };
  }

  return {
    startKey: addMonthsToDateKey(startKey, steps * 12, timeZone),
    endKey: addMonthsToDateKey(endKey, steps * 12, timeZone),
  };
}
