import { describe, expect, it } from 'vitest';
import { buildCategoryTree } from '../src/db/category-tree.js';

describe('buildCategoryTree', () => {
  it('preserves grandchildren when child rows sort before their parent', () => {
    const tree = buildCategoryTree([
      { id: 'food', parent_id: null, path: 'Food' },
      { id: 'pizza', parent_id: 'restaurants', path: 'Food > Restaurants > Pizza' },
      { id: 'restaurants', parent_id: 'food', path: 'Food > Restaurants' },
    ]);

    expect(tree).toEqual([
      {
        id: 'food',
        path: 'Food',
        children: [
          {
            id: 'restaurants',
            path: 'Food > Restaurants',
            children: [
              {
                id: 'pizza',
                path: 'Food > Restaurants > Pizza',
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('treats missing parents as roots', () => {
    const tree = buildCategoryTree([
      { id: 'orphan', parent_id: 'missing', path: 'Orphan' },
      { id: 'root', parent_id: null, path: 'Root' },
    ]);

    expect(tree.map((node) => node.id).toSorted()).toEqual(['orphan', 'root']);
  });
});
