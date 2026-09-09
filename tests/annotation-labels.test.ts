import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  ensureAnnotationCategory,
  ensureAnnotationLabel,
  saveEntryAnnotation,
} from '../src/annotation/store.js';
import {
  buildAnnotationLabelIndex,
  createAnnotationLabel,
  deleteAnnotationLabel,
  loadAnnotationLabelResolutionContext,
  resolveAnnotationLabelPath,
  updateAnnotationLabel,
} from '../src/db/annotation-labels.js';
import { migrateDatabase } from '../src/db/migrate.js';

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

describe('annotation labels', () => {
  it('allows sibling labels with the same name under different parents', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    const work = createAnnotationLabel(db, {
      name: 'Work',
      icon: 'MdWork',
      color: '#2563eb',
    });
    const personal = createAnnotationLabel(db, {
      name: 'Personal',
      icon: 'MdPerson',
      color: '#16a34a',
    });
    const workTravel = createAnnotationLabel(db, {
      name: 'Travel',
      parentId: work.id,
    });
    const personalTravel = createAnnotationLabel(db, {
      name: 'Travel',
      parentId: personal.id,
    });

    expect(workTravel.id).toBe('work.travel');
    expect(personalTravel.id).toBe('personal.travel');
    expect(workTravel.id).not.toBe(personalTravel.id);
  });

  it('inherits icon and color from the parent when unset', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    const parent = createAnnotationLabel(db, {
      name: 'Work',
      icon: 'MdWork',
      color: '#2563eb',
    });
    const child = createAnnotationLabel(db, {
      name: 'Travel',
      parentId: parent.id,
      icon: null,
      color: null,
    });

    expect(child.icon).toBeNull();
    expect(child.color).toBeNull();

    const index = buildAnnotationLabelIndex(db);
    expect(index.get(child.id)).toMatchObject({
      icon: 'MdWork',
      color: '#2563eb',
    });

    updateAnnotationLabel(db, parent.id, {
      name: 'Work',
      icon: 'MdWork',
      color: '#dc2626',
    });

    expect(buildAnnotationLabelIndex(db).get(child.id)).toMatchObject({
      icon: 'MdWork',
      color: '#dc2626',
    });
  });

  it('loads rows and their canonical presentations as one resolution context', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    const parent = createAnnotationLabel(db, { name: 'Work' });
    const child = createAnnotationLabel(db, { name: 'Travel', parentId: parent.id });

    const context = loadAnnotationLabelResolutionContext(db);

    expect(context.rows.map((row) => row.id)).toEqual([child.id, parent.id]);
    expect(context.index.get(child.id)?.path).toBe('Work > Travel');
  });

  it('applies migration 015 and supports nested paths', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrateDatabase(db)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
      27, 28, 29, 30, 31, 32, 33,
    ]);

    const parent = createAnnotationLabel(db, {
      name: 'Work',
      icon: 'MdWork',
      color: '#2563eb',
    });
    const child = createAnnotationLabel(db, {
      name: 'Travel',
      parentId: parent.id,
      icon: 'MdFlight',
      color: '#0ea5e9',
    });

    const index = buildAnnotationLabelIndex(db);
    expect(index.get(child.id)?.path).toBe('Work > Travel');

    const byId = new Map([parent, child].map((row) => [row.id, row] as const));
    expect(resolveAnnotationLabelPath(child, byId)).toBe('Work > Travel');
  });

  it('blocks delete when label is assigned or has children', async () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedTransaction(db, 'tx-1');

    const parent = ensureAnnotationLabel(db, 'Parent');
    createAnnotationLabel(db, { name: 'Child', parentId: parent.id });
    const used = ensureAnnotationLabel(db, 'Reimbursable');

    await saveEntryAnnotation(db, {
      entryType: 'transaction',
      entryId: 'tx-1',
      categoryId: ensureAnnotationCategory(db, 'Food').id,
      labelIds: [used.id],
      source: 'manual',
    });

    expect(() => deleteAnnotationLabel(db, used.id)).toThrow(
      'Cannot delete a label that is assigned to transactions',
    );
    expect(() => deleteAnnotationLabel(db, parent.id)).toThrow(
      'Cannot delete a label that has child labels',
    );
  });

  it('updates label presentation fields', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);

    const created = createAnnotationLabel(db, { name: 'Misc' });
    const updated = updateAnnotationLabel(db, created.id, {
      name: 'Personal',
      icon: 'MdPerson',
      color: '#16a34a',
    });

    expect(updated.name).toBe('Personal');
    expect(buildAnnotationLabelIndex(db).get(updated.id)).toMatchObject({
      name: 'Personal',
      icon: 'MdPerson',
      color: '#16a34a',
    });
  });
});
