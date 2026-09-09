import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  buildConfirmedTransactionClassificationSql,
  type ConfirmedTransactionClassificationState,
  isConfirmedTransactionClassification,
} from '../src/annotation/classification-policy.js';

type ClassificationCase = {
  readonly name: string;
  readonly state: ConfirmedTransactionClassificationState;
  readonly setup: (db: DatabaseSync) => void;
  readonly expected: boolean;
};

const cases: readonly ClassificationCase[] = [
  {
    name: 'empty',
    state: { categoryOverrideId: null, annotation: null },
    setup: () => undefined,
    expected: false,
  },
  {
    name: 'pending suggestion',
    state: { categoryOverrideId: null, annotation: null },
    setup: () => undefined,
    expected: false,
  },
  {
    name: 'override',
    state: { categoryOverrideId: 'override', annotation: null },
    setup: (db) =>
      db
        .prepare(
          `INSERT INTO transaction_category_overrides (transaction_id, category_id) VALUES ('tx', 'override')`,
        )
        .run(),
    expected: true,
  },
  {
    name: 'annotation category',
    state: {
      categoryOverrideId: null,
      annotation: { categoryId: 'category', subCategoryId: null, labels: [], notes: null },
    },
    setup: (db) =>
      db
        .prepare(
          `INSERT INTO entry_annotations (id, entry_type, entry_id, category_id) VALUES ('annotation', 'transaction', 'tx', 'category')`,
        )
        .run(),
    expected: true,
  },
  {
    name: 'annotation subcategory',
    state: {
      categoryOverrideId: null,
      annotation: { categoryId: null, subCategoryId: 'subcategory', labels: [], notes: null },
    },
    setup: (db) =>
      db
        .prepare(
          `INSERT INTO entry_annotations (id, entry_type, entry_id, sub_category_id) VALUES ('annotation', 'transaction', 'tx', 'subcategory')`,
        )
        .run(),
    expected: true,
  },
  {
    name: 'annotation label',
    state: {
      categoryOverrideId: null,
      annotation: { categoryId: null, subCategoryId: null, labels: ['label'], notes: null },
    },
    setup: (db) => {
      db.prepare(
        `INSERT INTO entry_annotations (id, entry_type, entry_id) VALUES ('annotation', 'transaction', 'tx')`,
      ).run();
      db.prepare(
        `INSERT INTO entry_annotation_labels (annotation_id, label_id) VALUES ('annotation', 'label')`,
      ).run();
    },
    expected: true,
  },
  {
    name: 'blank notes',
    state: {
      categoryOverrideId: null,
      annotation: { categoryId: null, subCategoryId: null, labels: [], notes: '  ' },
    },
    setup: (db) =>
      db
        .prepare(
          `INSERT INTO entry_annotations (id, entry_type, entry_id, notes) VALUES ('annotation', 'transaction', 'tx', '  ')`,
        )
        .run(),
    expected: false,
  },
  {
    name: 'nonblank notes',
    state: {
      categoryOverrideId: null,
      annotation: { categoryId: null, subCategoryId: null, labels: [], notes: 'reviewed' },
    },
    setup: (db) =>
      db
        .prepare(
          `INSERT INTO entry_annotations (id, entry_type, entry_id, notes) VALUES ('annotation', 'transaction', 'tx', 'reviewed')`,
        )
        .run(),
    expected: true,
  },
];

describe('confirmed classification policy', () => {
  it.each(cases)(
    'keeps the TypeScript evaluator and SQL compiler equivalent for $name',
    (testCase) => {
      const db = new DatabaseSync(':memory:');
      db.exec(`
      CREATE TABLE transactions (id TEXT PRIMARY KEY);
      CREATE TABLE transaction_category_overrides (transaction_id TEXT, category_id TEXT);
      CREATE TABLE entry_annotations (
        id TEXT PRIMARY KEY, entry_type TEXT, entry_id TEXT, category_id TEXT,
        sub_category_id TEXT, notes TEXT
      );
      CREATE TABLE entry_annotation_labels (annotation_id TEXT, label_id TEXT);
      INSERT INTO transactions (id) VALUES ('tx');
    `);
      testCase.setup(db);
      const row = db
        .prepare(
          `SELECT 1 FROM transactions t WHERE ${buildConfirmedTransactionClassificationSql()}`,
        )
        .get();
      expect(isConfirmedTransactionClassification(testCase.state)).toBe(testCase.expected);
      expect(row !== undefined).toBe(testCase.expected);
      db.close();
    },
  );
});
