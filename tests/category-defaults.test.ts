import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildCategoryIndex } from '../src/db/category-display.js';
import { applyCategoryDefaultLabel, upsertCategoryLabel } from '../src/db/category-labels.js';
import { migrateDatabase } from '../src/db/migrate.js';
import {
  applyOpenFinanceCategoryDefaults,
  loadOpenFinanceCategoryDefaults,
  resolveCategoryPresentation,
} from '../src/openfinance/category-defaults.js';

function openTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  return db;
}

function seedCategories(db: DatabaseSync): void {
  const syncedAt = '2026-06-11T00:00:00.000Z';
  db.prepare(
    `INSERT INTO categories (id, name, name_translated, parent_id, parent_name, raw_json, synced_at)
     VALUES (?, ?, ?, ?, ?, '{}', ?)`,
  ).run('11000000', 'Food and drinks', 'Alimentos', null, null, syncedAt);
  db.prepare(
    `INSERT INTO categories (id, name, name_translated, parent_id, parent_name, raw_json, synced_at)
     VALUES (?, ?, ?, ?, ?, '{}', ?)`,
  ).run('11020000', 'Food delivery', 'Delivery', '11000000', 'Food and drinks', syncedAt);
}

describe('openfinance category defaults', () => {
  it('validates the committed defaults document', () => {
    const defaults = loadOpenFinanceCategoryDefaults();
    expect(defaults.version).toBeGreaterThanOrEqual(1);
    expect(defaults.categories['Income']?.icon).toBe('MdTrendingUp');
    expect(defaults.categories['Food and drinks']?.color).toBe('#f97316');
  });

  it('applies defaults without overwriting manual icon or color', () => {
    const db = openTestDb();
    seedCategories(db);

    upsertCategoryLabel(db, '11000000', { icon: 'MdStar', color: '#111111' });

    const applied = applyOpenFinanceCategoryDefaults(db);
    expect(applied).toBe(1);

    const child = applyCategoryDefaultLabel(db, '11020000', {
      icon: 'MdDeliveryDining',
    });
    expect(child).toBe(true);

    const manualChild = upsertCategoryLabel(db, '11020000', { icon: 'MdLocalPizza' });
    expect(manualChild.iconManual).toBe(true);

    const partialApply = applyCategoryDefaultLabel(db, '11020000', {
      icon: 'MdDeliveryDining',
      color: '#ffffff',
    });
    expect(partialApply).toBe(true);

    const parentLabel = upsertCategoryLabel(db, '11000000', {}, { markManual: false });
    expect(parentLabel.icon).toBe('MdStar');
    expect(parentLabel.color).toBe('#111111');
  });

  it('inherits icon and color from ancestors when child label omits them', () => {
    const db = openTestDb();
    seedCategories(db);
    applyOpenFinanceCategoryDefaults(db);

    const index = buildCategoryIndex(db);
    const child = index.get('11020000');
    expect(child?.presentation.icon).toBe('MdDeliveryDining');
    expect(child?.presentation.color).toBe('#f97316');

    const partialIndex = new Map(
      [...index.entries()].map(([id, entry]) => [
        id,
        {
          id: entry.id,
          name: entry.name,
          name_translated: entry.name_translated,
          parent_id: entry.parent_id,
          label: entry.label,
        },
      ]),
    );
    const resolved = resolveCategoryPresentation('11020000', partialIndex);
    expect(resolved?.icon).toBe('MdDeliveryDining');
    expect(resolved?.color).toBe('#f97316');
  });
});
