import { describe, expect, it } from 'vitest';
import {
  buildTransactionChartQuery,
  buildTransactionFilterSummary,
  buildTransactionListQuery,
  buildTransactionScopedQuery,
  clearTransactionFilterPart,
  resolveEffectiveTransactionFilters,
  resolveTransactionDateSelectValue,
  TRANSACTION_DATE_ALL,
} from '../src/web/client/lib/transaction-filters.js';

describe('transaction filters', () => {
  it('defaults missing date preset to this month', () => {
    expect(resolveEffectiveTransactionFilters({})).toEqual({ d: 'this-month' });
    expect(resolveEffectiveTransactionFilters({ d: TRANSACTION_DATE_ALL })).toEqual({
      d: TRANSACTION_DATE_ALL,
    });
  });

  it('builds query from effective date preset', () => {
    expect(buildTransactionListQuery({ f: {} })).toContain('date=this-month');
    expect(buildTransactionListQuery({ f: {} })).toContain('page=1');
    expect(buildTransactionListQuery({ f: { d: TRANSACTION_DATE_ALL } })).toContain('page=1');
    expect(buildTransactionListQuery({ f: { d: 'today' } })).toContain('date=today');
  });

  it('builds sort query from table order state', () => {
    expect(buildTransactionListQuery({ f: {}, o: [{ id: 'date', desc: true }] })).toContain(
      'sort=date%3Adesc',
    );
    expect(buildTransactionListQuery({ f: {}, o: [{ id: 'date', desc: false }] })).toContain(
      'sort=date%3Aasc',
    );
  });

  it('builds an unpaginated query for filter-scoped actions', () => {
    const query = buildTransactionChartQuery({
      f: { a: 'acc-1', d: 'past-month', 'category-id': 'food' },
      p: 2,
      ps: 1,
    });

    expect(query).toContain('account=acc-1');
    expect(query).toContain('date=past-month');
    expect(query).toContain('category-id=food');
    expect(query).not.toContain('page=');
    expect(query).not.toContain('page-size=');
  });

  it('builds an unpaginated sorted query for export and other filter-scoped actions', () => {
    const query = buildTransactionScopedQuery({
      f: { a: 'acc-1', d: 'this-month' },
      p: 3,
      ps: 50,
      o: [{ id: 'date', desc: true }],
    });

    expect(query).toContain('account=acc-1');
    expect(query).toContain('date=this-month');
    expect(query).toContain('sort=date%3Adesc');
    expect(query).not.toContain('page=');
    expect(query).not.toContain('page-size=');
  });

  it('shows this month in the date selector when unset', () => {
    expect(resolveTransactionDateSelectValue({}, false)).toBe('this-month');
    expect(resolveTransactionDateSelectValue({ d: TRANSACTION_DATE_ALL }, false)).toBe('all');
  });

  it('summarizes only restrictive filters', () => {
    const summary = buildTransactionFilterSummary(
      {
        d: 'this-month',
        a: 'acc-1',
        'category-id': 'food,travel',
      },
      {
        accounts: [{ id: 'acc-1', display_name: 'Checking' }],
        bills: [],
        categoryById: {},
        labelById: {},
        locale: 'en-US',
        t: ((key: string) => key) as never,
      },
    );
    expect(summary).toEqual([
      { id: 'account', label: 'columns.account', accountIds: ['acc-1'] },
      { id: 'date', label: 'columns.date', value: 'filters.thisMonth' },
      {
        id: 'category-id',
        label: 'columns.category',
        categoryIds: ['food', 'travel'],
      },
    ]);
  });

  it('summarizes multiple account filters', () => {
    const summary = buildTransactionFilterSummary(
      { a: 'acc-1,acc-2', d: TRANSACTION_DATE_ALL },
      {
        accounts: [
          { id: 'acc-1', display_name: 'Checking' },
          { id: 'acc-2', display_name: 'Credit Card' },
        ],
        bills: [],
        categoryById: {},
        labelById: {},
        locale: 'en-US',
        t: ((key: string) => key) as never,
      },
    );
    expect(summary).toEqual([
      { id: 'account', label: 'columns.account', accountIds: ['acc-1', 'acc-2'] },
    ]);
  });

  it('builds multi-account query params', () => {
    expect(buildTransactionListQuery({ f: { a: 'acc-1,acc-2' } })).toContain(
      'account=acc-1%2Cacc-2',
    );
  });

  it('clears summary filter parts back to defaults', () => {
    expect(clearTransactionFilterPart('account')).toEqual({ a: undefined });
    expect(clearTransactionFilterPart('date')).toEqual({ d: undefined });
    expect(clearTransactionFilterPart('date-custom')).toEqual({
      d: 'this-month',
      'start-date': undefined,
      'end-date': undefined,
    });
    expect(clearTransactionFilterPart('label-id')).toEqual({ 'label-id': undefined });
  });
});
