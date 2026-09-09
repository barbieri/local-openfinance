import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveDateNavigationSpec,
  resolveDateSelector,
  resolveFlexibleLocalDateRange,
  shiftLocalDateRange,
} from '../src/utils/local-date-range.js';
import { formatTransactionDateCellValue } from '../src/web/client/lib/transaction-date-navigation.js';

describe('local date range', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves day shortcuts in the configured timezone', () => {
    expect(resolveDateSelector('today', 'UTC')).toEqual({
      startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
      endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
    });
  });

  it('resolves partial YYYY and YYYY-MM selectors', () => {
    expect(resolveDateSelector('2026', 'UTC')).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(resolveDateSelector('2026-02', 'UTC')).toEqual({
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    });
  });

  it('resolves a single YYYY-MM-DD selector', () => {
    expect(resolveDateSelector('2026-06-15', 'UTC')).toEqual({
      startDate: '2026-06-15',
      endDate: '2026-06-15',
    });
  });

  it('resolves past-month, year-to-date, and last-12-months shortcuts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));

    expect(resolveDateSelector('ytd', 'UTC')).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-06-15',
    });
    expect(resolveDateSelector('past-month', 'UTC')).toEqual({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });
    expect(resolveDateSelector('last-12-months', 'UTC')).toEqual({
      startDate: '2025-06-15',
      endDate: '2026-06-15',
    });
  });
});

describe('date navigation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves navigation units from presets', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));

    const monthRange = resolveDateSelector('this-month', 'UTC');
    expect(resolveDateNavigationSpec('this-month', monthRange, 'UTC')).toEqual({
      kind: 'unit',
      unit: 'month',
    });
    expect(
      resolveDateNavigationSpec('past-month', resolveDateSelector('past-month', 'UTC'), 'UTC'),
    ).toEqual({
      kind: 'unit',
      unit: 'month',
    });
    expect(
      resolveDateNavigationSpec('this-week', resolveDateSelector('this-week', 'UTC'), 'UTC'),
    ).toEqual({
      kind: 'unit',
      unit: 'week',
    });
    expect(resolveDateNavigationSpec('ytd', resolveDateSelector('ytd', 'UTC'), 'UTC')).toEqual({
      kind: 'unit',
      unit: 'year',
    });
  });

  it('shifts month and week ranges backward', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));

    const monthRange = resolveDateSelector('this-month', 'UTC');
    expect(shiftLocalDateRange(monthRange, { kind: 'unit', unit: 'month' }, -1, 'UTC')).toEqual({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });

    const weekRange = resolveDateSelector('this-week', 'UTC');
    expect(shiftLocalDateRange(weekRange, { kind: 'unit', unit: 'week' }, -1, 'UTC')).toEqual({
      startDate: '2026-06-08',
      endDate: '2026-06-14',
    });
  });

  it('shifts custom duration ranges by their span', () => {
    const range = { startDate: '2026-06-10', endDate: '2026-06-12' };
    expect(resolveDateNavigationSpec('custom', range, 'UTC')).toEqual({
      kind: 'duration',
      days: 3,
    });
    expect(shiftLocalDateRange(range, { kind: 'duration', days: 3 }, -1, 'UTC')).toEqual({
      startDate: '2026-06-07',
      endDate: '2026-06-09',
    });
  });
});

describe('transaction date cells', () => {
  it('uses the narrowest label that still identifies the active range', () => {
    expect(
      formatTransactionDateCellValue(
        '2026-06-15',
        { d: 'custom', 'start-date': '2026-06-01', 'end-date': '2026-06-30' },
        'en-US',
        'UTC',
      ),
    ).toBe('15');
    expect(
      formatTransactionDateCellValue(
        '2026-06-15',
        { d: 'custom', 'start-date': '2026-01-01', 'end-date': '2026-12-31' },
        'en-US',
        'UTC',
      ),
    ).toBe('Jun 15');
  });
});

describe('resolveFlexibleLocalDateRange', () => {
  it('uses explicit bounds for custom without resolving presets', () => {
    expect(
      resolveFlexibleLocalDateRange(
        {
          date: 'custom',
          startDate: '2026-06-01T08:00',
          endDate: '2026-06-02T18:30',
        },
        'UTC',
      ),
    ).toEqual({
      startDate: '2026-06-01T08:00',
      endDate: '2026-06-02T18:30',
    });
    expect(
      resolveFlexibleLocalDateRange(
        {
          date: 'today',
          startDate: '2026-01-01',
          endDate: '2026-01-02',
        },
        'UTC',
      ),
    ).not.toEqual({
      startDate: '2026-01-01',
      endDate: '2026-01-02',
    });
  });
});
