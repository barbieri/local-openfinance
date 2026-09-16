import { describe, expect, it } from 'vitest';
import {
  buildInvestmentViewSummary,
  DEFAULT_INVESTMENT_GROUP_BY,
  effectiveInvestmentVisibleColumns,
  ensureInvestmentVisibleColumns,
  toggleInvestmentVisibleColumn,
  updateInvestmentViewForStatusFilter,
} from '../src/web/client/pages/investments/investments-page-helpers.js';

describe('investment page view state', () => {
  it('defaults to account grouping and derives active status, grouping, and search summary', () => {
    expect(DEFAULT_INVESTMENT_GROUP_BY).toBe('account');
    expect(
      buildInvestmentViewSummary({
        statusFilter: 'ACTIVE',
        groupBy: DEFAULT_INVESTMENT_GROUP_BY,
        search: ' CDB ',
      }),
    ).toEqual([
      { id: 'status', translationKey: 'filters.statusActive' },
      { id: 'groupBy', translationKey: 'filters.groupByAccount' },
      { id: 'search', value: 'CDB' },
    ]);
  });

  it('clears unavailable status grouping and retains a visible column for a single status', () => {
    const next = updateInvestmentViewForStatusFilter({
      statusFilter: 'ACTIVE',
      groupBy: 'status',
      visibleColumns: new Set(['status']),
    });

    expect(next.groupBy).toBe('none');
    expect(next.visibleColumns).toEqual(new Set(['name']));
  });

  it('does not remove the final visible column', () => {
    expect(
      toggleInvestmentVisibleColumn({
        visibleColumns: new Set(['account', 'name']),
        groupBy: 'account',
        singleStatus: true,
        key: 'name',
        checked: false,
      }),
    ).toEqual(new Set(['account', 'name']));
  });

  it('keeps the name column effective when account grouping hides the only selected column', () => {
    expect(
      ensureInvestmentVisibleColumns({
        visibleColumns: new Set(['account']),
        groupBy: 'account',
        singleStatus: true,
      }),
    ).toEqual(new Set(['account', 'name']));
  });

  it('keeps an effective column when a single status hides status beside name grouping', () => {
    const next = updateInvestmentViewForStatusFilter({
      statusFilter: 'ACTIVE',
      groupBy: 'name',
      visibleColumns: new Set(['name', 'status']),
    });

    expect(next.visibleColumns).toEqual(new Set(['name', 'total']));
    expect(
      effectiveInvestmentVisibleColumns({
        visibleColumns: next.visibleColumns,
        groupBy: next.groupBy,
        singleStatus: true,
      }),
    ).toEqual(new Set(['total']));
  });
});
