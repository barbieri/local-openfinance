import { describe, expect, it } from 'vitest';
import { type CategoryRow, resolveCategoryPath } from '../src/db/category-display.js';

describe('resolveCategoryPath', () => {
  it('builds translated path and falls back to parent_name', () => {
    const child: CategoryRow = {
      id: 'c1',
      name: 'Child',
      name_translated: 'Filho',
      parent_id: 'p-missing',
      parent_name: 'Shopping',
    };
    const byId = new Map<string, CategoryRow>([[child.id, child]]);
    const result = resolveCategoryPath(child, byId);
    expect(result.path).toBe('Shopping > Filho');
  });
});
