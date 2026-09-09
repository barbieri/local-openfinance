import type { TFunction } from 'i18next';
import { getDateTimeFormat } from '../../../utils/intl-formatters.js';
import {
  type DateNavigationSpec,
  isFullMonthDateRange,
  isFullYearDateRange,
  type LocalDateRange,
  resolveDateNavigationSpec,
  resolveDateSelector,
  resolveFlexibleLocalDateRange,
  shiftLocalDateRange,
} from '../../../utils/local-date-range.js';
import {
  DEFAULT_TRANSACTION_DATE_PRESET,
  isCustomDateActive,
  resolveEffectiveTransactionFilters,
  TRANSACTION_DATE_ALL,
} from './transaction-filters.js';

export type ResolvedTransactionDateFilter = {
  readonly preset: string | null;
  readonly range: LocalDateRange;
};

export function resolveBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function resolveEffectiveTransactionDateFilter(
  filters: Record<string, string | string[]>,
  timeZone = resolveBrowserTimeZone(),
): ResolvedTransactionDateFilter | null {
  const effective = resolveEffectiveTransactionFilters(filters);
  if (effective['d'] === TRANSACTION_DATE_ALL) {
    return null;
  }

  if (isCustomDateActive(filters)) {
    const range = resolveFlexibleLocalDateRange(
      {
        date: 'custom',
        startDate: String(effective['start-date'] ?? ''),
        endDate: String(effective['end-date'] ?? ''),
      },
      timeZone,
    );
    if (!range?.startDate || !range.endDate) {
      return null;
    }
    return { preset: 'custom', range };
  }

  const preset = String(effective['d'] ?? DEFAULT_TRANSACTION_DATE_PRESET);
  return {
    preset,
    range: resolveDateSelector(preset, timeZone),
  };
}

export function resolveTransactionDateNavigationSpec(
  filters: Record<string, string | string[]>,
  timeZone = resolveBrowserTimeZone(),
): DateNavigationSpec | null {
  const resolved = resolveEffectiveTransactionDateFilter(filters, timeZone);
  if (!resolved) {
    return null;
  }
  return resolveDateNavigationSpec(resolved.preset, resolved.range, timeZone);
}

function localDateKeyToStartDateTime(value: string): string {
  if (value.includes('T')) {
    return value.length === 16 ? value : value.slice(0, 16);
  }
  return `${value}T00:00`;
}

function localDateKeyToEndDateTime(value: string): string {
  if (value.includes('T')) {
    return value.length === 16 ? value : value.slice(0, 16);
  }
  return `${value}T23:59`;
}

export function localDateRangeToDateTimeLocalValues(range: LocalDateRange): {
  readonly start: string;
  readonly end: string;
} | null {
  if (!range.startDate || !range.endDate) {
    return null;
  }
  return {
    start: localDateKeyToStartDateTime(range.startDate),
    end: localDateKeyToEndDateTime(range.endDate),
  };
}

export type FixedDateRangeShortcut = {
  readonly id: string;
  readonly labelKey: string;
};

export const FIXED_DATE_RANGE_SHORTCUTS: readonly FixedDateRangeShortcut[] = [
  { id: 'today', labelKey: 'filters.today' },
  { id: 'this-week', labelKey: 'filters.thisWeek' },
  { id: 'past-week', labelKey: 'filters.pastWeek' },
  { id: 'this-month', labelKey: 'filters.thisMonth' },
  { id: 'past-month', labelKey: 'filters.pastMonth' },
  { id: 'this-year', labelKey: 'dateRange.thisYear' },
  { id: 'ytd', labelKey: 'filters.ytd' },
  { id: 'last-12-months', labelKey: 'filters.last12Months' },
];

export function resolveFixedDateRangeShortcut(
  shortcutId: string,
  timeZone = resolveBrowserTimeZone(),
): { readonly start: string; readonly end: string } | null {
  const range = resolveFixedDateRangeShortcutRange(shortcutId, timeZone);
  return range ? localDateRangeToDateTimeLocalValues(range) : null;
}

function resolveFixedDateRangeShortcutRange(
  shortcutId: string,
  timeZone: string,
): LocalDateRange | null {
  if (shortcutId === 'this-year') {
    const today = resolveDateSelector('today', timeZone);
    const year = today.startDate?.slice(0, 4);
    if (!year) {
      return null;
    }
    return resolveDateSelector(year, timeZone);
  }

  try {
    return resolveDateSelector(shortcutId, timeZone);
  } catch {
    return null;
  }
}

export function localDateRangeToFilterPatch(
  range: LocalDateRange,
): Record<string, string | undefined> {
  if (!range.startDate || !range.endDate) {
    return {};
  }
  return {
    d: 'custom',
    'start-date': localDateKeyToStartDateTime(range.startDate),
    'end-date': localDateKeyToEndDateTime(range.endDate),
  };
}

export function shiftTransactionDateFiltersBack(
  filters: Record<string, string | string[]>,
  timeZone = resolveBrowserTimeZone(),
): Record<string, string | undefined> | null {
  const resolved = resolveEffectiveTransactionDateFilter(filters, timeZone);
  if (!resolved) {
    return null;
  }

  const spec = resolveDateNavigationSpec(resolved.preset, resolved.range, timeZone);
  if (!spec) {
    return null;
  }

  const shifted = shiftLocalDateRange(resolved.range, spec, -1, timeZone);
  return localDateRangeToFilterPatch(shifted);
}

export function resolveTransactionDateNavigationTooltipKey(spec: DateNavigationSpec): string {
  if (spec.kind === 'duration') {
    return 'filters.dateNavBackPeriod';
  }
  switch (spec.unit) {
    case 'day':
      return 'filters.dateNavBackDay';
    case 'week':
      return 'filters.dateNavBackWeek';
    case 'month':
      return 'filters.dateNavBackMonth';
    case 'year':
      return 'filters.dateNavBackYear';
  }
}

function formatLocalDateKey(dateKey: string, locale: string): string {
  const parsed = new Date(`${dateKey}T12:00:00.000Z`);
  return getDateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function formatMonthYear(dateKey: string, locale: string): string {
  const parsed = new Date(`${dateKey}T12:00:00.000Z`);
  return getDateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
  }).format(parsed);
}

export function formatLocalDateRangeLabel(range: LocalDateRange, locale: string): string | null {
  if (!range.startDate || !range.endDate) {
    return null;
  }

  const start = range.startDate.slice(0, 10);
  const end = range.endDate.slice(0, 10);
  if (start === end) {
    return formatLocalDateKey(start, locale);
  }
  if (isFullMonthDateRange(start, end)) {
    return formatMonthYear(start, locale);
  }
  if (isFullYearDateRange(start, end)) {
    return start.slice(0, 4);
  }

  return `${formatLocalDateKey(start, locale)} – ${formatLocalDateKey(end, locale)}`;
}

export function formatTransactionDateColumnHeader(
  filters: Record<string, string | string[]>,
  locale: string,
  t: TFunction,
  options: {
    readonly usePurchaseDate?: boolean | undefined;
  } = {},
  timeZone = resolveBrowserTimeZone(),
): string {
  if (options.usePurchaseDate) {
    return `${t('columns.date')} (${t('filters.usePurchaseDate')})`;
  }

  const resolved = resolveEffectiveTransactionDateFilter(filters, timeZone);
  if (!resolved) {
    return t('columns.date');
  }

  if (resolved.preset === 'today') {
    return t('filters.today');
  }

  if (
    resolved.range.startDate &&
    resolved.range.endDate &&
    isFullMonthDateRange(resolved.range.startDate.slice(0, 10), resolved.range.endDate.slice(0, 10))
  ) {
    return t('columns.dayShort');
  }

  const rangeLabel = formatLocalDateRangeLabel(resolved.range, locale);
  return rangeLabel ?? t('columns.date');
}

export function formatTransactionDateCellValue(
  value: string,
  filters: Record<string, string | string[]>,
  locale: string,
  timeZone = resolveBrowserTimeZone(),
): string {
  const dateKey = value.slice(0, 10);
  const resolved = resolveEffectiveTransactionDateFilter(filters, timeZone);
  if (!resolved?.range.startDate || !resolved.range.endDate) {
    return formatLocalDateKey(dateKey, locale);
  }

  const start = resolved.range.startDate.slice(0, 10);
  const end = resolved.range.endDate.slice(0, 10);
  const parsed = new Date(`${dateKey}T12:00:00.000Z`);
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return getDateTimeFormat(locale, { day: 'numeric' }).format(parsed);
  }
  if (start.slice(0, 4) === end.slice(0, 4)) {
    return getDateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(parsed);
  }
  return formatLocalDateKey(dateKey, locale);
}
