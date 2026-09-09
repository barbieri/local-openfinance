import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildAnnotationFeatureText } from '../src/annotation/feature-text.js';
import { buildNestedAnnotationId } from '../src/annotation/nested-annotation-id.js';
import {
  ensureAnnotationCategory,
  ensureAnnotationLabel,
  listUnannotatedEntries,
  saveEntryAnnotation,
} from '../src/annotation/store.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { cosineSimilarity, vectorToBlob } from '../src/scoring/vector.js';

function seedTransaction(db: DatabaseSync, id: string): void {
  db.prepare(
    `INSERT INTO connections (item_id, connector_id, connector_name, status, raw_json, synced_at)
     VALUES ('item-1', '601', 'Itau', 'UPDATED', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_item_id, type, name, currency, raw_json, synced_at)
     VALUES ('acct-1', 'item-1', 'BANK', 'Checking', 'BRL', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO transactions (
      id, account_id, occurred_at, amount_cents, currency, description, raw_json, synced_at
    ) VALUES (?, 'acct-1', '2026-06-10T12:00:00.000Z', -5000, 'BRL', 'Coffee shop', '{}', '2026-06-10T00:00:00.000Z')`,
  ).run(id);
}

describe('annotation store', () => {
  it('applies annotation migration and tracks unannotated entries', async () => {
    const db = new DatabaseSync(':memory:');
    expect(migrateDatabase(db)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
      27, 28, 29, 30, 31, 32, 33,
    ]);

    seedTransaction(db, 'tx-1');
    expect(listUnannotatedEntries(db, { entryTypes: ['transaction'], limit: 10 })).toHaveLength(1);

    const category = ensureAnnotationCategory(db, 'Food');
    const label = ensureAnnotationLabel(db, 'Reimbursable');

    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-1',
      categoryId: category.id,
      labelIds: [label.id],
      notes: 'Team lunch',
      source: 'manual',
    });

    expect(listUnannotatedEntries(db, { entryTypes: ['transaction'], limit: 10 })).toHaveLength(0);
  });

  it('allows sub-categories with the same name under different parents', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    const food = ensureAnnotationCategory(db, 'Food');
    const travel = ensureAnnotationCategory(db, 'Travel');
    const foodMisc = ensureAnnotationCategory(db, 'Misc', food.id);
    const travelMisc = ensureAnnotationCategory(db, 'Misc', travel.id);

    expect(foodMisc.id).toBe('food.misc');
    expect(travelMisc.id).toBe('travel.misc');
    expect(foodMisc.id).not.toBe(travelMisc.id);
    expect(buildNestedAnnotationId('Misc', food.id)).toBe('food.misc');
  });

  it('builds stable feature text and compares vectors', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db, 'tx-2');

    const entry = listUnannotatedEntries(db, { entryTypes: ['transaction'], limit: 1 })[0];
    if (!entry) {
      throw new Error('expected seeded transaction');
    }
    const featureText = buildAnnotationFeatureText(entry);
    expect(featureText).toContain('Coffee shop');
    expect(featureText).toContain('amount_sign=debit');
    expect(featureText).toContain('amount_bucket=20_100');

    const left = vectorToBlob([1, 0, 0]);
    const right = vectorToBlob([1, 0, 0]);
    expect(cosineSimilarity(new Float32Array(left.buffer), new Float32Array(right.buffer))).toBe(1);
  });
});
