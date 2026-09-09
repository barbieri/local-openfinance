import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  buildCategoryIndex,
  resolveUpstreamCategoryDisplayName,
} from '../src/db/category-display.js';
import { migrateDatabase } from '../src/db/migrate.js';

describe('category display', () => {
  it('prefers translated names by default', () => {
    expect(resolveUpstreamCategoryDisplayName('Food and drink', 'Alimentação', true)).toBe(
      'Alimentação',
    );
  });

  it('falls back to original name when translation is missing', () => {
    expect(resolveUpstreamCategoryDisplayName('Food and drink', null, true)).toBe('Food and drink');
  });

  it('keeps original name when translation is disabled', () => {
    expect(resolveUpstreamCategoryDisplayName('Food and drink', 'Alimentação', false)).toBe(
      'Food and drink',
    );
  });

  it('builds English presentation paths when translation is disabled', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    db.prepare(
      `INSERT INTO categories (id, name, name_translated, parent_id, parent_name, raw_json, synced_at)
       VALUES ('05000000', 'Food and drinks', 'Alimentação', NULL, NULL, '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO categories (id, name, name_translated, parent_id, parent_name, raw_json, synced_at)
       VALUES ('05080000', 'Restaurants', 'Restaurantes', '05000000', 'Food and drinks', '{}', '2026-06-10T00:00:00.000Z')`,
    ).run();

    const index = buildCategoryIndex(db, { translateNames: false });
    const child = index.get('05080000');
    expect(child?.presentation.name).toBe('Restaurants');
    expect(child?.path).toBe('Food and drinks > Restaurants');
  });
});
