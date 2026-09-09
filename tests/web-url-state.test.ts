import { describe, expect, it } from 'vitest';
import {
  buildAppHash,
  buildReportsHash,
  buildTransactionHash,
  parseAppHash,
} from '../src/web/client/lib/app-hash.js';
import {
  decodeTableState,
  encodeTableState,
  type TableUrlState,
} from '../src/web/client/lib/table-url-state.js';

describe('app hash routing', () => {
  it('parses tab-only hashes', () => {
    expect(parseAppHash('#/sync')).toEqual({
      route: 'tab',
      tab: 'sync',
      tableStateEncoded: null,
      reportsSection: null,
      reportsReportId: null,
      reportsRunId: null,
    });
    expect(parseAppHash('#/categories')).toEqual({
      route: 'tab',
      tab: 'categories',
      tableStateEncoded: null,
      reportsSection: null,
      reportsReportId: null,
      reportsRunId: null,
    });
  });

  it('parses tab with table state', () => {
    const encoded = encodeTableState({ f: { d: 'today' }, t: 'transactions' } as TableUrlState & {
      t: string;
    });
    expect(parseAppHash(`#/transactions/s=${encoded}`)).toEqual({
      route: 'tab',
      tab: 'transactions',
      tableStateEncoded: encoded,
      reportsSection: null,
      reportsReportId: null,
      reportsRunId: null,
    });
  });

  it('supports legacy s= hashes', () => {
    const encoded = 'abc123';
    expect(parseAppHash(`#s=${encoded}`)).toEqual({
      route: 'tab',
      tab: 'transactions',
      tableStateEncoded: encoded,
      reportsSection: null,
      reportsReportId: null,
      reportsRunId: null,
    });
  });

  it('parses transaction permalink hashes', () => {
    expect(parseAppHash('#/transaction/abc-123')).toEqual({
      route: 'transaction',
      transactionId: 'abc-123',
    });
    expect(parseAppHash('#/transaction/')).toEqual({
      route: 'tab',
      tab: 'transactions',
      tableStateEncoded: null,
      reportsSection: null,
      reportsReportId: null,
      reportsRunId: null,
    });
    expect(parseAppHash('#/transactions/abc-123')).toEqual({
      route: 'tab',
      tab: 'transactions',
      tableStateEncoded: null,
      reportsSection: null,
      reportsReportId: null,
      reportsRunId: null,
    });
  });

  it('builds tab hashes', () => {
    expect(buildAppHash('investments')).toBe('#/investments');
    expect(buildAppHash('transactions', 'payload')).toBe('#/transactions/s=payload');
    expect(buildAppHash('sync', 'payload')).toBe('#/sync');
    expect(buildTransactionHash('abc-123')).toBe('#/transaction/abc-123');
  });

  it('parses reports inner hashes', () => {
    expect(parseAppHash('#/reports')).toEqual({
      route: 'tab',
      tab: 'reports',
      tableStateEncoded: null,
      reportsSection: 'catalog',
      reportsReportId: null,
      reportsRunId: null,
    });
    expect(parseAppHash('#/reports/weekly')).toEqual({
      route: 'tab',
      tab: 'reports',
      tableStateEncoded: null,
      reportsSection: 'current',
      reportsReportId: 'weekly',
      reportsRunId: null,
    });
    expect(parseAppHash('#/reports/weekly/memory')).toEqual({
      route: 'tab',
      tab: 'reports',
      tableStateEncoded: null,
      reportsSection: 'memory',
      reportsReportId: 'weekly',
      reportsRunId: null,
    });
    expect(parseAppHash('#/reports/weekly/chat/run-1')).toEqual({
      route: 'tab',
      tab: 'reports',
      tableStateEncoded: null,
      reportsSection: 'chat',
      reportsReportId: 'weekly',
      reportsRunId: 'run-1',
    });
    expect(parseAppHash('#/reports/weekly/run/run-1')).toEqual({
      route: 'tab',
      tab: 'reports',
      tableStateEncoded: null,
      reportsSection: 'run',
      reportsReportId: 'weekly',
      reportsRunId: 'run-1',
    });
    expect(buildReportsHash()).toBe('#/reports');
    expect(buildReportsHash('weekly')).toBe('#/reports/weekly');
    expect(buildReportsHash('weekly', 'memory')).toBe('#/reports/weekly/memory');
    expect(buildReportsHash('weekly', 'chat', 'run-1')).toBe('#/reports/weekly/chat/run-1');
    expect(buildReportsHash('weekly', 'run', 'run-1')).toBe('#/reports/weekly/run/run-1');
  });

  it('parses legacy report hashes for config-aware redirect handling', () => {
    expect(parseAppHash('#/reports/memory')).toMatchObject({
      reportsSection: 'memory',
      reportsReportId: null,
    });
    expect(parseAppHash('#/reports/chat/run-1')).toMatchObject({
      reportsSection: 'chat',
      reportsReportId: null,
      reportsRunId: 'run-1',
    });
    expect(parseAppHash('#/reports/run/run-1')).toMatchObject({
      reportsSection: 'run',
      reportsReportId: null,
      reportsRunId: 'run-1',
    });
  });

  it('does not crash on malformed percent escapes in permalinks', () => {
    expect(parseAppHash('#/reports/%E0%A4%A')).toMatchObject({
      reportsSection: 'current',
      reportsReportId: '%E0%A4%A',
    });
    expect(parseAppHash('#/reports/weekly/run/%E0%A4%A')).toMatchObject({
      reportsSection: 'run',
      reportsRunId: '%E0%A4%A',
    });
    expect(parseAppHash('#/transaction/%E0%A4%A')).toEqual({
      route: 'transaction',
      transactionId: '%E0%A4%A',
    });
  });
});

describe('table url state codec', () => {
  it('round-trips filter state', () => {
    const state = {
      f: { d: 'today', a: 'acc-1' },
      c: ['date', 'amount'],
    };
    const encoded = encodeTableState(state);
    const decoded = decodeTableState(encoded);
    expect(decoded).toEqual(state);
  });

  it('round-trips chart panel state', () => {
    const state = {
      f: { d: 'this-month' },
      charts: { open: true, tab: 'category' as const },
    };
    const encoded = encodeTableState(state);
    const decoded = decodeTableState(encoded);
    expect(decoded).toEqual(state);
  });

  it('round-trips transaction grouping state', () => {
    const state = {
      f: { d: 'this-month' },
      g: ['date', 'account', 'merchant'] as const,
    };
    const encoded = encodeTableState(state);
    const decoded = decodeTableState(encoded);
    expect(decoded).toEqual(state);
  });
});
