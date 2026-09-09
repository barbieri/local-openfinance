import { describe, expect, it, vi } from 'vitest';
import {
  advanceSyncCursor,
  FULL_SYNC_FROM_DATE,
  isPageBeforeCutoff,
  oldestDateKeyOnPage,
  resolveIncrementalFromDate,
  toDateKey,
} from '../src/openfinance/sync/incremental.js';
import { paginateResults } from '../src/openfinance/sync/pagination.js';
import { buildSyncTrailSummary, formatSyncTrail } from '../src/openfinance/sync/progress.js';

describe('sync incremental helpers', () => {
  it('normalizes date keys from ISO timestamps', () => {
    expect(toDateKey('2026-06-11T14:22:00.000Z')).toBe('2026-06-11');
    expect(toDateKey('')).toBeNull();
  });

  it('finds the oldest date on a page', () => {
    const oldest = oldestDateKeyOnPage(
      [{ date: '2026-06-10' }, { date: '2026-06-05' }, { date: '2026-06-08' }],
      (record) => String(record['date']),
    );
    expect(oldest).toBe('2026-06-05');
  });

  it('stops when the oldest page row is before the overlap cutoff', () => {
    expect(
      isPageBeforeCutoff([{ date: '2026-06-10' }, { date: '2026-06-03' }], '2026-06-04', (record) =>
        String(record['date']),
      ),
    ).toBe(true);

    expect(
      isPageBeforeCutoff([{ date: '2026-06-10' }, { date: '2026-06-08' }], '2026-06-04', (record) =>
        String(record['date']),
      ),
    ).toBe(false);
  });
});

describe('paginateResults', () => {
  it('skips known rows and stops early after the overlap window', async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      rows:
        page === 1
          ? [
              { id: 'tx-1', date: '2026-06-11' },
              { id: 'tx-2', date: '2026-06-10' },
            ]
          : [
              { id: 'tx-3', date: '2026-06-03' },
              { id: 'tx-4', date: '2026-06-02' },
            ],
      totalPages: 5,
    }));

    const consumed: string[] = [];
    const fromDate = '2026-06-04';
    const count = await paginateResults(
      fetchPage,
      (row: { id: string; date: string }) => {
        consumed.push(row.id);
      },
      {
        shouldSkip: (row) => {
          if (row.id === 'tx-1') {
            return true;
          }
          return row.date < fromDate;
        },
        shouldStopAfterPage: (rows) =>
          isPageBeforeCutoff(rows, fromDate, (record) => String(record['date'])),
      },
    );

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(consumed).toEqual(['tx-2']);
    expect(count).toBe(1);
  });

  it('reports page progress through onPage', async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      rows: [{ id: `row-${page}` }],
      totalPages: 2,
    }));
    const pages: number[] = [];

    await paginateResults(fetchPage, () => {}, {
      onPage: ({ page }) => {
        pages.push(page);
      },
    });

    expect(pages).toEqual([1, 2]);
  });
});

describe('formatSyncTrail', () => {
  it('formats connection and account summaries', () => {
    expect(buildSyncTrailSummary({ accounts: 2, investments: 3, loans: 1 })).toBe(
      '2 accounts, 3 investments, 1 loans',
    );
    expect(buildSyncTrailSummary({ transactions: 12 })).toBe('12 transactions');
    expect(formatSyncTrail('Itaú', { accounts: 2, investments: 3, loans: 1 })).toContain('Itaú');
  });
});

describe('resolveIncrementalFromDate', () => {
  it('uses a wider initial window when no cursor exists', () => {
    const db = {
      prepare() {
        return {
          get() {
            return undefined;
          },
        };
      },
    };

    const fromDate = resolveIncrementalFromDate(db as never, 'transactions:account:a', 7);
    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() - 30);
    expect(fromDate).toBe(expected.toISOString().slice(0, 10));
  });

  it('overlaps from the stored cursor by lookbackDays', () => {
    const db = {
      prepare() {
        return {
          get() {
            return { cursor_value: '2026-06-11T10:00:00.000Z' };
          },
        };
      },
    };

    const fromDate = resolveIncrementalFromDate(db as never, 'transactions:account:a', 7);
    expect(fromDate).toBe('2026-06-04');
  });

  it('caps a future cursor at the current sync time before applying the overlap', () => {
    const db = {
      prepare() {
        return {
          get() {
            return { cursor_value: '2027-04-09T03:00:00.000Z' };
          },
        };
      },
    };

    const fromDate = resolveIncrementalFromDate(
      db as never,
      'transactions:account:a',
      7,
      30,
      false,
      new Date('2026-08-18T12:00:00.000Z'),
    );

    expect(fromDate).toBe('2026-08-11');
  });

  it('keeps the conservative overlap baseline for old, empty, and future-dated pages', () => {
    const fromDate = '2026-08-11';
    const syncedAt = '2026-08-18T12:00:00.000Z';

    expect(advanceSyncCursor(fromDate, '2026-08-10T23:59:59.000Z', syncedAt)).toBe(fromDate);
    expect(advanceSyncCursor(fromDate, '2027-04-09T03:00:00.000Z', syncedAt)).toBe(fromDate);
    expect(advanceSyncCursor(fromDate, '2026-08-18T11:59:59.000Z', syncedAt)).toBe(
      '2026-08-18T11:59:59.000Z',
    );
  });

  it('uses the full-history cutoff when forceFull is true', () => {
    const db = {
      prepare() {
        return {
          get() {
            return { cursor_value: '2026-06-11T10:00:00.000Z' };
          },
        };
      },
    };

    const fromDate = resolveIncrementalFromDate(db as never, 'transactions:account:a', 7, 30, true);
    expect(fromDate).toBe(FULL_SYNC_FROM_DATE);
  });
});
