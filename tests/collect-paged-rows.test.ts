import { describe, expect, it } from 'vitest';
import { collectPagedRows } from '../src/web/client/lib/collect-paged-rows.js';

describe('collectPagedRows', () => {
  it('walks every page until the filtered total is collected', async () => {
    const pages = [
      { rows: [1, 2], total: 5 },
      { rows: [3, 4], total: 5 },
      { rows: [5], total: 5 },
    ];

    const collected = await collectPagedRows(async (page) => {
      const result = pages[page - 1];
      if (!result) {
        throw new Error(`unexpected page ${page}`);
      }
      return result;
    });

    expect(collected).toEqual([1, 2, 3, 4, 5]);
  });

  it('stops when a page is empty', async () => {
    const collected = await collectPagedRows(async (page) => {
      if (page === 1) {
        return { rows: [1], total: 10 };
      }
      return { rows: [], total: 10 };
    });
    expect(collected).toEqual([1]);
  });
});
