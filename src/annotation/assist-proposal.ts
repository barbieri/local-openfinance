import type { AnnotationAssistProposal } from '../scoring/providers.js';
import {
  getAssistClassifierNotesLeakagePatterns,
  isAssistClassifierPromptNotesLeakage,
} from './assist-classifier-prompt.js';
import { normalizeMerchantText, scoreMerchantSimilarity } from './merchant-match.js';

export type AssistNotesContext = {
  readonly description: string | null | undefined;
  readonly merchantName?: string | null | undefined;
};

export const REDUNDANT_NOTES_SIMILARITY_THRESHOLD = 0.85;
export const MAX_ASSIST_PROMPT_LABELS = 3;
export const MAX_ASSIST_PROPOSAL_LABELS = 3;
export const COPY_NOTES_MERCHANT_THRESHOLD = 0.95;
export const COPY_NOTES_EMBEDDING_THRESHOLD = 0.92;
export const STALE_NOTE_SIMILARITY_THRESHOLD = 0.88;
export const STALE_NOTE_TRANSACTION_THRESHOLD = 0.95;

export type AssistExampleCategoryHint = {
  readonly categoryOverrideId: string | null;
  readonly effectiveCategoryId: string | null;
};

export type AssistExampleNotesHint = AssistExampleCategoryHint & {
  readonly notes: string | null;
  readonly merchantName?: string | null | undefined;
  readonly description?: string | null | undefined;
  /** When peer_account/peer, notes may copy even if merchant strings differ. */
  readonly matchKind?: string | undefined;
};

export type OpenFinanceCategoryRef = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
};

function normalizeCategoryMatch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function resolveOpenFinanceCategoryId(
  value: unknown,
  categories: readonly OpenFinanceCategoryRef[],
): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  if (categories.some((item) => item.id === raw)) {
    return raw;
  }

  const normalized = normalizeCategoryMatch(raw);
  for (const item of categories) {
    if (normalizeCategoryMatch(item.name) === normalized) {
      return item.id;
    }
    if (normalizeCategoryMatch(item.path) === normalized) {
      return item.id;
    }
    for (const segment of item.path.split(' > ')) {
      if (normalizeCategoryMatch(segment) === normalized) {
        return item.id;
      }
    }
  }

  return null;
}

export function resolveSuggestedCategoryOverrideId(
  targetSyncedCategoryId: string | null,
  examples: readonly AssistExampleCategoryHint[],
): string | null {
  for (const example of examples) {
    if (example.categoryOverrideId) {
      if (example.categoryOverrideId !== targetSyncedCategoryId) {
        return example.categoryOverrideId;
      }
      continue;
    }

    if (example.effectiveCategoryId && example.effectiveCategoryId !== targetSyncedCategoryId) {
      return example.effectiveCategoryId;
    }
  }

  return null;
}

export function isNotesRedundantWithTransaction(
  notes: string,
  context: AssistNotesContext,
  threshold = REDUNDANT_NOTES_SIMILARITY_THRESHOLD,
): boolean {
  const normalizedNotes = normalizeMerchantText(notes);
  if (!normalizedNotes) {
    return false;
  }

  const description = context.description?.trim();
  if (description) {
    if (normalizedNotes === normalizeMerchantText(description)) {
      return true;
    }
    if (scoreMerchantSimilarity(null, notes, null, description) >= threshold) {
      return true;
    }
  }

  const merchantName = context.merchantName?.trim();
  if (merchantName) {
    if (normalizedNotes === normalizeMerchantText(merchantName)) {
      return true;
    }
    if (scoreMerchantSimilarity(null, notes, merchantName, null) >= threshold) {
      return true;
    }
  }

  return false;
}

export function isNotesStaleExampleCopy(
  notes: string,
  target: AssistNotesContext,
  examples: readonly AssistExampleNotesHint[],
  noteSimilarityThreshold = STALE_NOTE_SIMILARITY_THRESHOLD,
  transactionSimilarityThreshold = STALE_NOTE_TRANSACTION_THRESHOLD,
): boolean {
  for (const example of examples) {
    const exampleNotes = example.notes?.trim();
    if (!exampleNotes) {
      continue;
    }
    // Same CPF/CNPJ peer is a stronger identity signal than merchant string equality.
    if (example.matchKind === 'peer_account' || example.matchKind === 'peer') {
      continue;
    }
    if (scoreMerchantSimilarity(null, notes, null, exampleNotes) < noteSimilarityThreshold) {
      continue;
    }
    const targetToExample = scoreMerchantSimilarity(
      target.merchantName ?? null,
      target.description ?? null,
      example.merchantName ?? null,
      example.description ?? null,
    );
    if (targetToExample < transactionSimilarityThreshold) {
      return true;
    }
  }
  return false;
}

function isLiteralNullAssistNote(notes: string): boolean {
  return /^(?:null|undefined|none|n\/a)$/i.test(notes.trim());
}

export function rankAssistPromptLabels(
  examples: readonly { readonly labelIds: readonly string[] }[],
  labels: readonly { readonly id: string; readonly name: string }[],
  limit = MAX_ASSIST_PROMPT_LABELS,
): readonly { readonly id: string; readonly name: string }[] {
  const weights = new Map<string, number>();
  for (let index = 0; index < examples.length; index += 1) {
    const example = examples[index];
    if (!example) {
      continue;
    }
    const rankWeight = examples.length - index;
    for (const labelId of example.labelIds) {
      weights.set(labelId, (weights.get(labelId) ?? 0) + rankWeight);
    }
  }

  const ranked: { readonly id: string; readonly name: string }[] = [];
  const seen = new Set<string>();
  const labelsById = new Map(labels.map((item) => [item.id, item]));
  const weightEntries = [...weights.entries()];
  weightEntries.sort((left, right) => right[1] - left[1]);
  for (const [labelId] of weightEntries) {
    if (seen.has(labelId)) {
      continue;
    }
    const label = labelsById.get(labelId);
    if (!label) {
      continue;
    }
    ranked.push(label);
    seen.add(labelId);
    if (ranked.length >= limit) {
      break;
    }
  }
  return ranked;
}

export function sanitizeAssistNotes(
  notes: string | null | undefined,
  context?: AssistNotesContext,
  examples?: readonly AssistExampleNotesHint[],
): string | null {
  if (!notes) {
    return null;
  }
  const trimmed = notes.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(trimmed)) {
    return null;
  }
  if (/^date=\d{4}-\d{2}-\d{2}/i.test(trimmed)) {
    return null;
  }
  if (/^(occurred|transaction date|on)\s+\d{4}-\d{2}-\d{2}/i.test(trimmed)) {
    return null;
  }
  if (isLiteralNullAssistNote(trimmed)) {
    return null;
  }
  if (isAssistClassifierPromptNotesLeakage(trimmed, getAssistClassifierNotesLeakagePatterns())) {
    return null;
  }
  if (context && isNotesRedundantWithTransaction(trimmed, context)) {
    return null;
  }
  if (
    examples &&
    examples.length > 0 &&
    context &&
    isNotesStaleExampleCopy(trimmed, context, examples)
  ) {
    return null;
  }
  return trimmed;
}

export function enrichAssistProposal(
  proposal: AnnotationAssistProposal,
  examples: readonly AssistExampleNotesHint[],
  targetSyncedCategoryId: string | null,
  notesContext?: AssistNotesContext,
): AnnotationAssistProposal {
  const labelIds = [...new Set(proposal.labelIds ?? [])].slice(0, MAX_ASSIST_PROPOSAL_LABELS);
  return {
    ...proposal,
    labelIds,
    labelNames: (proposal.labelNames ?? []).slice(0, MAX_ASSIST_PROPOSAL_LABELS),
    categoryOverrideId:
      proposal.categoryOverrideId ??
      resolveSuggestedCategoryOverrideId(targetSyncedCategoryId, examples),
    notes: sanitizeAssistNotes(proposal.notes, notesContext, examples),
  };
}
