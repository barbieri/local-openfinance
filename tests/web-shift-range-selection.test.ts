import { describe, expect, it } from 'vitest';
import { applyShiftRangeSelection } from '../src/web/client/lib/shift-range-selection.js';

describe('applyShiftRangeSelection', () => {
  const orderedIds = ['a', 'b', 'c', 'd', 'e'];

  it('toggles a single row and sets the anchor', () => {
    expect(
      applyShiftRangeSelection({
        orderedIds,
        targetId: 'c',
        checked: true,
        shiftKey: false,
        selected: [],
        anchorIndex: null,
      }),
    ).toEqual({ selected: ['c'], anchorIndex: 2 });
  });

  it('selects an inclusive range on shift-click', () => {
    expect(
      applyShiftRangeSelection({
        orderedIds,
        targetId: 'd',
        checked: true,
        shiftKey: true,
        selected: ['a'],
        anchorIndex: 0,
      }),
    ).toEqual({ selected: ['a', 'b', 'c', 'd'], anchorIndex: 3 });
  });

  it('deselects an inclusive range on shift-click when unchecked', () => {
    expect(
      applyShiftRangeSelection({
        orderedIds,
        targetId: 'e',
        checked: false,
        shiftKey: true,
        selected: orderedIds,
        anchorIndex: 2,
      }),
    ).toEqual({ selected: ['a', 'b'], anchorIndex: 4 });
  });

  it('works when shift-clicking above the anchor', () => {
    expect(
      applyShiftRangeSelection({
        orderedIds,
        targetId: 'b',
        checked: true,
        shiftKey: true,
        selected: [],
        anchorIndex: 3,
      }),
    ).toEqual({ selected: ['b', 'c', 'd'], anchorIndex: 1 });
  });
});
