import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  resolveAnnotationLabelReference,
  resolveAnnotationLabelReferences,
  resolveAnnotationLabelReferenceWithContext,
  resolveAssistProposalLabelIds,
  resolveAssistProposalLabelIdsWithContext,
} from '../src/annotation/label-resolve.js';
import { ensureAnnotationLabel } from '../src/annotation/store.js';
import { loadAnnotationLabelResolutionContext } from '../src/db/annotation-labels.js';
import { migrateDatabase } from '../src/db/migrate.js';

function seedLabels(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO annotation_labels (id, name, parent_id, icon, color, created_at)
     VALUES ('lazer.e.esportes', 'Lazer e Esportes', NULL, 'MdLabel', '#64748b', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO annotation_labels (id, name, parent_id, icon, color, created_at)
     VALUES ('lazer.e.esportes.academia', 'Academia', 'lazer.e.esportes', 'MdLabel', '#64748b', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO annotation_labels (id, name, parent_id, icon, color, created_at)
     VALUES ('educa.o', 'Educação', NULL, 'MdLabel', '#64748b', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO annotation_labels (id, name, parent_id, icon, color, created_at)
     VALUES ('educa.o.amanda', 'Amanda', 'educa.o', 'MdLabel', '#64748b', '2026-01-01')`,
  ).run();
}

describe('resolveAnnotationLabelReference', () => {
  it('resolves nested labels by path instead of creating roots', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedLabels(db);

    expect(resolveAnnotationLabelReference(db, 'Educação > Amanda')).toBe('educa.o.amanda');
    expect(resolveAnnotationLabelReference(db, 'Amanda')).toBe('educa.o.amanda');
    const context = loadAnnotationLabelResolutionContext(db);
    expect(resolveAnnotationLabelReferenceWithContext(context, 'Educação > Amanda')).toBe(
      'educa.o.amanda',
    );
    expect(
      resolveAnnotationLabelReferenceWithContext(context, 'Amanda', {
        hintLabelIds: ['educa.o.amanda'],
      }),
    ).toBe('educa.o.amanda');
    expect(
      resolveAssistProposalLabelIdsWithContext(context, {
        labelNames: ['Educação > Amanda'],
      }),
    ).toEqual(['educa.o.amanda']);
    expect(resolveAssistProposalLabelIds(db, { labelNames: ['Educação > Amanda'] })).toEqual([
      'educa.o.amanda',
    ]);
    expect(ensureAnnotationLabel(db, 'Amanda').id).toBe('educa.o.amanda');
    expect(context.index.get('educa.o.amanda')?.path).toBe('Educação > Amanda');
  });

  it('creates a root label only when no nested match exists', () => {
    const db = new DatabaseSync(':memory:');
    migrateDatabase(db);
    seedLabels(db);

    const id = ensureAnnotationLabel(db, 'Streaming').id;
    expect(id).toBe('streaming');
    expect(resolveAnnotationLabelReferences(db, ['Streaming'], { createMissing: false })).toEqual([
      'streaming',
    ]);
  });
});
