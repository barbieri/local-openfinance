import { describe, expect, it } from 'vitest';
import { colorForAmountRank } from '../src/chart/chart-colors.js';
import {
  aggregateCategoryBreakdown,
  aggregateLabelBreakdown,
  aggregateTopLevelCategories,
  aggregateTopLevelLabels,
  categoryHasSubcategoryBreakdown,
} from '../src/chart/transaction-aggregates.js';

describe('chart-colors', () => {
  it('darkens the first rank and lightens the last rank', () => {
    const base = '#336699';
    const dark = colorForAmountRank(base, 0, 3);
    const light = colorForAmountRank(base, 2, 3);
    expect(dark).not.toBe(light);
    expect(dark.toLowerCase()).not.toBe(base.toLowerCase());
    expect(light.toLowerCase()).not.toBe(base.toLowerCase());
  });
});

describe('transaction chart aggregates', () => {
  const categories = {
    food: { id: 'food', parent_id: null, name: 'Food', color: '#ff0000' },
    groceries: { id: 'groceries', parent_id: 'food', name: 'Groceries', color: '#ff0000' },
    dining: { id: 'dining', parent_id: 'food', name: 'Dining', color: '#ff0000' },
    travel: { id: 'travel', parent_id: null, name: 'Travel', color: '#0000ff' },
  } as const;

  const labels = {
    trip: { id: 'trip', parent_id: null, name: 'Trip', color: '#00aa00' },
    hotel: { id: 'hotel', parent_id: 'trip', name: 'Hotel', color: '#00aa00' },
    foodTag: { id: 'foodTag', parent_id: null, name: 'Food tag', color: '#aa0000' },
  } as const;

  it('aggregates top-level categories by effective category', () => {
    const rows = [
      {
        amount_cents: -1000,
        category_id: 'groceries',
        category_override_id: null,
        annotation: null,
      },
      {
        amount_cents: -2000,
        category_id: 'dining',
        category_override_id: null,
        annotation: null,
      },
      {
        amount_cents: -3000,
        category_id: 'misc',
        category_override_id: 'travel',
        annotation: null,
      },
    ];

    const buckets = aggregateTopLevelCategories(rows, categories, 'Uncategorized');
    expect(buckets.map((bucket) => bucket.id)).toEqual(['food', 'travel']);
    expect(buckets[0]?.totalCents).toBe(3000);
    expect(buckets[1]?.totalCents).toBe(3000);
  });

  it('breaks down sub-categories under a selected root', () => {
    const rows = [
      {
        amount_cents: -1000,
        category_id: 'groceries',
        category_override_id: null,
        annotation: null,
      },
      {
        amount_cents: -2500,
        category_id: 'dining',
        category_override_id: null,
        annotation: null,
      },
    ];

    const buckets = aggregateCategoryBreakdown(rows, categories, 'food');
    expect(buckets.map((bucket) => bucket.id)).toEqual(['dining', 'groceries']);
    expect(buckets[0]?.color).not.toBe(buckets[1]?.color);
    expect(categoryHasSubcategoryBreakdown(rows, categories, 'food')).toBe(true);
  });

  it('aggregates labels by top-level label and deepest child match', () => {
    const rows = [
      {
        amount_cents: -1500,
        category_id: null,
        category_override_id: null,
        annotation: { labelIds: ['hotel'] },
      },
      {
        amount_cents: -500,
        category_id: null,
        category_override_id: null,
        annotation: { labelIds: ['trip', 'foodTag'] },
      },
    ];

    const topLevel = aggregateTopLevelLabels(rows, labels);
    expect(topLevel.map((bucket) => bucket.id).sort()).toEqual(['foodTag', 'trip']);
    expect(topLevel.find((bucket) => bucket.id === 'trip')?.totalCents).toBe(2000);

    const breakdown = aggregateLabelBreakdown(rows, labels, 'trip');
    expect(breakdown.map((bucket) => bucket.id)).toEqual(['hotel', 'trip']);
  });
});
