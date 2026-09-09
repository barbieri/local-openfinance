import type { DatabaseSync } from 'node:sqlite';
import { confirm, input, select } from '@inquirer/prompts';
import type { ResolvedAppConfig } from '../types.js';
import { mapInParallel } from '../utils/map-in-parallel.js';
import type { AnnotatableEntry } from './feature-text.js';
import {
  type AnnotationCategory,
  ensureAnnotationCategory,
  ensureAnnotationLabel,
  listAnnotationCategories,
  listUnannotatedEntries,
  saveEntryAnnotation,
  suggestCategoriesForEntry,
} from './store.js';

export type ClassifyWizardResult = {
  readonly annotated: number;
  readonly skipped: number;
};

function formatEntrySummary(entry: {
  readonly entryType: string;
  readonly occurredAt: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly description: string | null;
  readonly accountName: string | null;
}): string {
  const amount = (entry.amountCents / 100).toFixed(2);
  return [
    `[${entry.entryType}] ${entry.occurredAt}`,
    `${entry.accountName ?? 'unknown account'} · ${entry.currency} ${amount}`,
    entry.description ?? '(no description)',
  ].join('\n');
}

export async function runClassifyWizard(
  db: DatabaseSync,
  config: ResolvedAppConfig,
  options: {
    readonly limit: number;
    readonly entryTypes: readonly ('transaction' | 'investment_transaction')[];
    readonly skipEmbedding?: boolean | undefined;
  },
): Promise<ClassifyWizardResult> {
  const entries = listUnannotatedEntries(db, {
    entryTypes: options.entryTypes,
    limit: options.limit,
  });

  let annotated = 0;
  let skipped = 0;

  const outcomes = await mapInParallel(
    entries,
    (entry) => classifySingleEntry(db, config, entry, options.skipEmbedding === true),
    1,
  );
  for (const outcome of outcomes) {
    if (outcome === 'annotated') {
      annotated += 1;
    } else {
      skipped += 1;
    }
  }

  return { annotated, skipped };
}

async function classifySingleEntry(
  db: DatabaseSync,
  config: ResolvedAppConfig,
  entry: AnnotatableEntry,
  skipEmbedding: boolean,
): Promise<'annotated' | 'skipped'> {
  const proceed = await confirm({
    message: `Classify this entry?\n${formatEntrySummary(entry)}`,
    default: true,
  });
  if (!proceed) {
    return 'skipped';
  }

  const suggestions = skipEmbedding
    ? { embeddingMatches: [], classifierCategoryId: null }
    : await suggestCategoriesForEntry(db, entry, {
        embedding: config.annotation.embedding,
        classifier: config.annotation.classifier,
        similarityThreshold: config.annotation.similarityThreshold,
      });

  const categories = listAnnotationCategories(db);
  const categoryId = await promptCategorySelection(db, categories, suggestions);
  if (categoryId === '__skip__') {
    return 'skipped';
  }

  const { subCategoryId, labelIds, notes } = await promptSubCategoryLabelsAndNotes(
    db,
    categories,
    categoryId,
  );

  await saveEntryAnnotation(db, {
    entryType: entry.entryType,
    entryId: entry.entryId,
    categoryId,
    subCategoryId,
    labelIds,
    notes: notes.length > 0 ? notes : undefined,
    source: suggestions.embeddingMatches.length > 0 ? 'suggested' : 'manual',
    embedding: skipEmbedding ? undefined : config.annotation.embedding,
  });

  return 'annotated';
}

async function promptCategorySelection(
  db: DatabaseSync,
  categories: readonly AnnotationCategory[],
  suggestions: {
    readonly embeddingMatches: readonly { readonly categoryId: string | null }[];
    readonly classifierCategoryId: string | null;
  },
): Promise<string> {
  const suggestedCategoryIds = [
    ...new Set(
      [
        suggestions.classifierCategoryId,
        ...suggestions.embeddingMatches.map((match) => match.categoryId),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];

  const categoryId = await select({
    message: 'Category',
    choices: [
      ...categories.map((category) => ({
        name: category.parentId ? `${category.name} (${category.parentId})` : category.name,
        value: category.id,
      })),
      { name: 'Create new category…', value: '__new__' },
      { name: 'Skip entry', value: '__skip__' },
    ],
    default: suggestedCategoryIds[0],
  });

  if (categoryId === '__new__') {
    const categoryName = await input({ message: 'New category name' });
    return ensureAnnotationCategory(db, categoryName).id;
  }

  return categoryId;
}

async function promptSubCategorySelection(
  db: DatabaseSync,
  categories: readonly AnnotationCategory[],
  categoryId: string,
): Promise<string | undefined> {
  const subCategories = categories.filter((item) => item.parentId === categoryId);
  if (subCategories.length === 0) {
    return undefined;
  }

  const subChoice = await select({
    message: 'Sub-category (optional)',
    choices: [
      { name: 'None', value: '__none__' },
      ...subCategories.map((item) => ({ name: item.name, value: item.id })),
      { name: 'Create new sub-category…', value: '__new__' },
    ],
    default: '__none__',
  });

  if (subChoice === '__new__') {
    const subName = await input({ message: 'New sub-category name' });
    return ensureAnnotationCategory(db, subName, categoryId).id;
  }

  return subChoice === '__none__' ? undefined : subChoice;
}

async function promptSubCategoryLabelsAndNotes(
  db: DatabaseSync,
  categories: readonly AnnotationCategory[],
  categoryId: string,
): Promise<{ subCategoryId: string | undefined; labelIds: string[]; notes: string }> {
  return promptSubCategorySelection(db, categories, categoryId).then(async (subCategoryId) => {
    const { labelIds, notes } = await promptLabelIds(db).then(async (labelIds) => {
      const notes = await input({ message: 'Notes (optional)', default: '' });
      return { labelIds, notes };
    });
    return { subCategoryId, labelIds, notes };
  });
}

async function promptLabelIds(db: DatabaseSync): Promise<string[]> {
  const labelsInput = await input({
    message: 'Labels (comma-separated, optional)',
    default: '',
  });

  return labelsInput
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => ensureAnnotationLabel(db, item).id);
}
