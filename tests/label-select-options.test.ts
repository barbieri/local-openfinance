import { describe, expect, it } from 'vitest';
import { collectDescendantLabelIds } from '../src/web/client/lib/label-descendants.js';

describe('collectDescendantLabelIds', () => {
  const rows = [
    { id: 'food', name: 'Food', parentId: null },
    { id: 'food.groceries', name: 'Groceries', parentId: 'food' },
    { id: 'food.restaurants', name: 'Restaurants', parentId: 'food' },
    { id: 'food.groceries.organic', name: 'Organic', parentId: 'food.groceries' },
    { id: 'travel', name: 'Travel', parentId: null },
  ] as const;

  it('returns all nested descendants for a parent label', () => {
    expect(collectDescendantLabelIds('food', rows)).toEqual([
      'food.groceries',
      'food.restaurants',
      'food.groceries.organic',
    ]);
  });

  it('returns direct and nested descendants for a mid-level label', () => {
    expect(collectDescendantLabelIds('food.groceries', rows)).toEqual(['food.groceries.organic']);
  });

  it('returns an empty list for labels without children', () => {
    expect(collectDescendantLabelIds('travel', rows)).toEqual([]);
    expect(collectDescendantLabelIds('food.groceries.organic', rows)).toEqual([]);
  });
});
