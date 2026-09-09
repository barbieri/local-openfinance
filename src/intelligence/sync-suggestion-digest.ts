import type { DatabaseSync } from 'node:sqlite';
import {
  loadAnnotationLabelIds,
  resolveAssistProposalLabelIdsWithContext,
} from '../annotation/label-resolve.js';
import {
  listPendingAssistSuggestionDigestRows,
  type PendingAssistSuggestionDigestRow,
} from '../annotation/pending-assist-suggestions.js';
import { listAnnotationCategories } from '../annotation/store.js';
import { buildAnnotationHierarchyPathIndex } from '../db/annotation-hierarchy-path.js';
import {
  type AnnotationLabelPresentation,
  loadAnnotationLabelResolutionContext,
} from '../db/annotation-labels.js';
import { buildCategoryIndex, type CategoryIndexEntry } from '../db/category-display.js';
import type { AnnotationAssistProposal } from '../scoring/providers.js';
import type { ResolvedConfig } from '../types.js';
import { resolveLocalTimeZone, toLocalDateKey } from '../utils/local-date.js';
import { deliverEmail } from './email.js';
import {
  projectSuggestionDigestRows,
  type ResolvedSuggestionDigestRow,
} from './sync-suggestion-digest-projection.js';
import {
  buildSuggestionDigestText,
  renderSuggestionDigestHtml,
} from './sync-suggestion-digest-renderer.js';

export type SyncSuggestionDigestDelivery = typeof deliverEmail;

export type SyncSuggestionDigestDependencies = {
  readonly deliverEmail: SyncSuggestionDigestDelivery;
};

export type SyncSuggestionDigestInput = {
  readonly db: DatabaseSync;
  readonly resolved: ResolvedConfig;
  readonly previouslyPendingEntryIds: ReadonlySet<string>;
  readonly timeZone?: string | undefined;
  readonly dryRun?: boolean | undefined;
};

type ParsedSuggestionDigestRow = {
  readonly row: PendingAssistSuggestionDigestRow;
  readonly proposal: AnnotationAssistProposal;
  readonly suggestedLabelIds: readonly string[];
};

export type SyncSuggestionDigestResult =
  | { readonly kind: 'sent'; readonly suggestionCount: number }
  | { readonly kind: 'dry-run'; readonly suggestionCount: number }
  | { readonly kind: 'skipped'; readonly reason: 'smtp-not-configured' | 'no-pending-suggestions' }
  | { readonly kind: 'failed'; readonly error: Error; readonly suggestionCount: number };

export function createSyncSuggestionDigest(
  dependencies: SyncSuggestionDigestDependencies,
): (input: SyncSuggestionDigestInput) => Promise<SyncSuggestionDigestResult> {
  return async function sendAssistSuggestionDigest(
    input: SyncSuggestionDigestInput,
  ): Promise<SyncSuggestionDigestResult> {
    const smtp = input.resolved.config.notify.smtp;
    if (!smtp) {
      return {
        kind: 'skipped',
        reason: 'smtp-not-configured',
      };
    }

    let suggestionCount = 0;
    try {
      const digestRows = prepareSuggestionDigest(
        input.db,
        input.previouslyPendingEntryIds,
        input.timeZone ?? resolveLocalTimeZone(),
        input.resolved.config.web.publicBaseUrl,
      );
      suggestionCount = digestRows.newRows.length + digestRows.previousRows.length;
      if (suggestionCount === 0) {
        return {
          kind: 'skipped',
          reason: 'no-pending-suggestions',
        };
      }

      await dependencies.deliverEmail({
        smtp,
        dryRun: input.dryRun === true,
        content: {
          subject: `Digest de sugestões de classificação (${digestRows.newRows.length} novas, ${digestRows.previousRows.length} anteriores)`,
          html: renderSuggestionDigestHtml(digestRows),
          text: buildSuggestionDigestText(digestRows),
          attachments: [],
        },
      });

      return input.dryRun === true
        ? { kind: 'dry-run', suggestionCount }
        : { kind: 'sent', suggestionCount };
    } catch (error) {
      return {
        kind: 'failed',
        error: error instanceof Error ? error : new Error(String(error)),
        suggestionCount,
      };
    }
  };
}

export const sendAssistSuggestionDigest = createSyncSuggestionDigest({ deliverEmail });

function prepareSuggestionDigest(
  db: DatabaseSync,
  previouslyPendingEntryIds: ReadonlySet<string>,
  timeZone: string,
  publicBaseUrl: string | undefined,
): ReturnType<typeof projectSuggestionDigestRows> {
  const categoryIndex = buildCategoryIndex(db);
  const annotationCategoryIndex = buildAnnotationHierarchyPathIndex(listAnnotationCategories(db));
  const labelContext = loadAnnotationLabelResolutionContext(db);

  const rows = listPendingAssistSuggestionDigestRows(db);
  const parsedRows: ParsedSuggestionDigestRow[] = [];
  for (const row of rows) {
    if (row.proposal.kind === 'invalid') {
      throw new Error(row.proposal.reason);
    }
    const proposal = row.proposal.value;
    parsedRows.push({
      row,
      proposal,
      suggestedLabelIds: resolveAssistProposalLabelIdsWithContext(labelContext, proposal),
    });
  }
  const resolvedRows = parsedRows
    .map(({ row, proposal, suggestedLabelIds }) =>
      resolveSuggestionDigestRow(
        db,
        row,
        proposal,
        categoryIndex,
        annotationCategoryIndex,
        labelContext.index,
        timeZone,
        suggestedLabelIds,
      ),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return projectSuggestionDigestRows(resolvedRows, previouslyPendingEntryIds, publicBaseUrl);
}

function resolveSuggestionDigestRow(
  db: DatabaseSync,
  row: PendingAssistSuggestionDigestRow,
  proposal: AnnotationAssistProposal,
  categoryIndex: Map<string, CategoryIndexEntry>,
  annotationCategoryIndex: Map<string, string>,
  labelIndex: ReadonlyMap<string, AnnotationLabelPresentation>,
  timeZone: string,
  suggestedLabelIds: readonly string[],
): ResolvedSuggestionDigestRow {
  const occurredAt = row.occurredAt;
  const localDate = toLocalDateKey(occurredAt, timeZone);
  const rawDescription = row.description;
  const rawMerchant = row.merchantName;
  const description =
    rawMerchant !== null && rawMerchant.trim().length > 0
      ? rawMerchant
      : typeof rawDescription === 'string'
        ? (rawDescription ?? 'Sem descrição')
        : 'Sem descrição';
  const accountCurrency = row.accountCurrency || 'BRL';
  const amountInAccountCurrency = row.amountInAccountCurrencyCents;
  const amountCents = amountInAccountCurrency ?? row.amountCents;
  const originalCategory = resolveOpenFinanceCategoryWithColor(
    row.categoryOverrideId ?? row.categoryId,
    categoryIndex,
  );
  const newCategory = resolveSuggestionCategory(proposal, categoryIndex, annotationCategoryIndex);
  const originalLabels = resolveOriginalLabels(db, row.annotationId, labelIndex);
  const suggestedLabels = resolveLabeledSuggestions(suggestedLabelIds, labelIndex);
  return {
    date: localDate,
    description,
    amount: {
      cents: amountCents,
      currency: accountCurrency,
    },
    originalCategory,
    newCategory: areSameCategory(originalCategory, newCategory)
      ? { text: '—', color: EMPTY_COLOR }
      : newCategory,
    originalLabels: originalLabels,
    newLabels: areSameLabelSet(originalLabels, suggestedLabels) ? [] : suggestedLabels,
    score: row.confidence,
    entryId: row.entryId,
  };
}

const EMPTY_COLOR = '#64748b';

type LabeledText = {
  readonly text: string;
  readonly color: string;
};

function resolveOpenFinanceCategoryWithColor(
  categoryId: string | null,
  categoryIndex: Map<string, CategoryIndexEntry>,
): LabeledText {
  if (!categoryId) {
    return { text: '—', color: EMPTY_COLOR };
  }
  const category = categoryIndex.get(categoryId);
  if (!category) {
    return { text: 'Categoria Open Finance removida', color: EMPTY_COLOR };
  }
  return { text: category.path, color: category.presentation.color };
}

function resolveSuggestionCategory(
  proposal: AnnotationAssistProposal,
  categoryIndex: Map<string, CategoryIndexEntry>,
  annotationCategoryIndex: Map<string, string>,
): LabeledText {
  if (proposal.categoryOverrideId) {
    return resolveOpenFinanceCategoryWithColor(proposal.categoryOverrideId, categoryIndex);
  }
  if (proposal.subCategoryId || proposal.categoryId) {
    return resolveLocalCategoryWithColor(
      proposal.subCategoryId ?? proposal.categoryId,
      annotationCategoryIndex,
    );
  }
  return { text: '—', color: EMPTY_COLOR };
}

function resolveLocalCategoryWithColor(
  categoryId: string | null,
  categoryIndex: Map<string, string>,
): LabeledText {
  if (!categoryId) {
    return { text: '—', color: EMPTY_COLOR };
  }
  const path = categoryIndex.get(categoryId);
  if (!path) {
    return { text: 'Categoria local removida', color: EMPTY_COLOR };
  }
  return { text: path, color: EMPTY_COLOR };
}

function resolveOriginalLabels(
  db: DatabaseSync,
  annotationId: string | null,
  labelIndex: ReadonlyMap<string, AnnotationLabelPresentation>,
): readonly LabeledText[] {
  if (!annotationId) {
    return [];
  }

  const labelIds = loadAnnotationLabelIds(db, annotationId);
  return labelIds
    .map((labelId) => {
      const label = labelIndex.get(labelId);
      if (!label) {
        return null;
      }
      return { text: label.path, color: label.color };
    })
    .filter((label): label is LabeledText => label !== null);
}

function resolveLabeledSuggestions(
  suggestedLabelIds: readonly string[],
  labelIndex: ReadonlyMap<string, AnnotationLabelPresentation>,
): readonly LabeledText[] {
  return suggestedLabelIds
    .map((labelId) => {
      const label = labelIndex.get(labelId);
      if (!label) {
        return null;
      }
      return { text: label.path, color: label.color };
    })
    .filter((label): label is LabeledText => label !== null);
}

function areSameCategory(left: LabeledText, right: LabeledText): boolean {
  return left.text === right.text && left.color === right.color;
}

function areSameLabelSet(left: readonly LabeledText[], right: readonly LabeledText[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftKey = toLabelKeys(left);
  const rightKey = toLabelKeys(right);
  for (let i = 0; i < leftKey.length; i += 1) {
    if (leftKey[i] !== rightKey[i]) {
      return false;
    }
  }
  return true;
}

function toLabelKeys(labels: readonly LabeledText[]): readonly string[] {
  return labels
    .map((label) => `${label.text}\u0000${label.color}`)
    .toSorted()
    .slice();
}
