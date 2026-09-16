import { describe, expect, it } from 'vitest';
import {
  buildInvestmentViewSummary,
  DEFAULT_INVESTMENT_GROUP_BY,
  effectiveInvestmentVisibleColumns,
  ensureInvestmentVisibleColumns,
  investmentViewSummaryPartLabel,
  toggleInvestmentVisibleColumn,
  updateInvestmentViewForStatusFilter,
} from '../src/web/client/pages/investments/investments-page-helpers.js';

describe('investment page view state', () => {
  it('defaults to account grouping and derives active status, grouping, and search summary', () => {
    expect(DEFAULT_INVESTMENT_GROUP_BY).toBe('account');
    expect(
      buildInvestmentViewSummary({
        statusFilter: 'ACTIVE',
        deletedFilter: 'hide',
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
      deletedFilter: 'hide',
    });

    expect(next.groupBy).toBe('none');
    expect(next.visibleColumns).toEqual(new Set(['status', 'name']));
  });

  it('does not remove the final visible column', () => {
    expect(
      toggleInvestmentVisibleColumn({
        visibleColumns: new Set(['account', 'name']),
        groupBy: 'account',
        singleStatus: true,
        deletedFilter: 'hide',
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
        deletedFilter: 'hide',
      }),
    ).toEqual(new Set(['account', 'name']));
  });

  it('keeps an effective column when a single status hides status beside name grouping', () => {
    const next = updateInvestmentViewForStatusFilter({
      statusFilter: 'ACTIVE',
      groupBy: 'name',
      visibleColumns: new Set(['name', 'status']),
      deletedFilter: 'hide',
    });

    expect(next.visibleColumns).toEqual(new Set(['name', 'status', 'total']));
    expect(
      effectiveInvestmentVisibleColumns({
        visibleColumns: next.visibleColumns,
        groupBy: next.groupBy,
        singleStatus: true,
        deletedFilter: 'hide',
      }),
    ).toEqual(new Set(['total']));
  });

  it('keeps selected automatic columns and restores deleted for its visible filters', () => {
    const updatedStatus = updateInvestmentViewForStatusFilter({
      statusFilter: 'ACTIVE',
      groupBy: 'none',
      visibleColumns: new Set(['status', 'deleted']),
      deletedFilter: 'hide',
    });

    expect(updatedStatus.visibleColumns).toEqual(new Set(['status', 'deleted', 'name']));
    expect(
      effectiveInvestmentVisibleColumns({
        visibleColumns: updatedStatus.visibleColumns,
        groupBy: updatedStatus.groupBy,
        singleStatus: true,
        deletedFilter: 'hide',
      }),
    ).toEqual(new Set(['name']));
    expect(
      effectiveInvestmentVisibleColumns({
        visibleColumns: updatedStatus.visibleColumns,
        groupBy: updatedStatus.groupBy,
        singleStatus: true,
        deletedFilter: 'all',
      }),
    ).toEqual(new Set(['deleted', 'name']));
  });

  it('summarizes a selected deleted filter', () => {
    expect(
      buildInvestmentViewSummary({
        statusFilter: 'all',
        deletedFilter: 'only',
        groupBy: 'none',
        search: '',
      }),
    ).toEqual([
      { id: 'status', translationKey: 'filters.statusAll' },
      { id: 'deleted', translationKey: 'filters.deletedOnly' },
      { id: 'groupBy', translationKey: 'filters.noGrouping' },
    ]);
  });

  it('labels only the deleted summary chip with its filter name', () => {
    const translate = (key: string) => key;

    expect(
      investmentViewSummaryPartLabel(
        { id: 'deleted', translationKey: 'filters.deletedAll' },
        translate,
      ),
    ).toBe('filters.deleted: filters.deletedAll');
    expect(
      investmentViewSummaryPartLabel(
        { id: 'status', translationKey: 'filters.statusAll' },
        translate,
      ),
    ).toBe('filters.statusAll');
  });
});
