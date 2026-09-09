import { embed, generateText } from 'ai';
import {
  ASSIST_CLASSIFIER_SYSTEM,
  type AssistClassifierInput,
  buildAssistClassifierPrompt,
} from '../annotation/assist-classifier-prompt.js';
import { resolveOpenFinanceCategoryId } from '../annotation/assist-proposal.js';
import { createEmbeddingModel, createLanguageModel } from '../providers.js';
import type { ScoringModelConfig } from '../types.js';

export type EmbeddingResult = {
  readonly vector: readonly number[];
  readonly dimensions: number;
  readonly model: string;
  readonly inputTokens: number | null;
};

export type AnnotationAssistProposal = {
  readonly categoryOverrideId: string | null;
  readonly categoryId: string | null;
  readonly subCategoryId: string | null;
  readonly labelIds: readonly string[];
  readonly labelNames: readonly string[];
  readonly notes: string | null;
  readonly reasoning: string | null;
};

export function isAssistProposalEmpty(proposal: AnnotationAssistProposal | null): boolean {
  if (!proposal) {
    return true;
  }
  return (
    !proposal.categoryOverrideId &&
    !proposal.categoryId &&
    !proposal.subCategoryId &&
    (proposal.labelIds ?? []).length === 0 &&
    (proposal.labelNames ?? []).length === 0 &&
    !proposal.notes
  );
}

export function coerceAssistProposal(value: unknown): AnnotationAssistProposal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const parsed = value as Record<string, unknown>;
  return {
    categoryOverrideId:
      typeof parsed['categoryOverrideId'] === 'string' ? parsed['categoryOverrideId'] : null,
    categoryId: typeof parsed['categoryId'] === 'string' ? parsed['categoryId'] : null,
    subCategoryId: typeof parsed['subCategoryId'] === 'string' ? parsed['subCategoryId'] : null,
    labelIds: readStringArray(parsed['labelIds']),
    labelNames: readStringArray(parsed['labelNames']),
    notes: typeof parsed['notes'] === 'string' ? parsed['notes'] : null,
    reasoning: typeof parsed['reasoning'] === 'string' ? parsed['reasoning'] : null,
  };
}

export async function embedScoringText(
  config: ScoringModelConfig,
  text: string,
): Promise<EmbeddingResult> {
  const result = await embed({
    model: createEmbeddingModel(config),
    value: text,
  });

  return {
    vector: result.embedding,
    dimensions: result.embedding.length,
    model: `${config.provider}:${config.model}`,
    inputTokens:
      Number.isFinite(result.usage?.tokens) && result.usage.tokens >= 0
        ? Math.trunc(result.usage.tokens)
        : null,
  };
}

export async function classifyEntryCategory(
  config: ScoringModelConfig,
  entrySummary: string,
  categories: readonly { readonly id: string; readonly name: string }[],
): Promise<string | null> {
  if (categories.length === 0) {
    return null;
  }

  const categoryList = categories.map((item) => `- ${item.id}: ${item.name}`).join('\n');
  const result = await generateText({
    model: createLanguageModel(config),
    system: [
      'You classify personal-finance transactions into a fixed local category taxonomy.',
      'Reply with only one category id from the list. No quotes, no explanation.',
      'Prefer the most specific matching category. If unsure, pick the closest parent-level id still in the list.',
    ].join(' '),
    prompt: [
      'Categories (id: name):',
      categoryList,
      '',
      'Transaction feature text:',
      entrySummary,
      '',
      'Best category id:',
    ].join('\n'),
  });

  const candidate = result.text
    .trim()
    .split(/\s+/u)[0]
    ?.replace(/^["'`]+|["'`]+$/gu, '');
  if (!candidate) {
    return null;
  }
  return categories.some((item) => item.id === candidate) ? candidate : null;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/u);
  const source = (fenced?.[1] ?? text).trim();
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(source.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function parseAssistProposal(
  parsed: Record<string, unknown>,
  input: AssistClassifierInput,
): AnnotationAssistProposal {
  const parsedCategoryId = typeof parsed['categoryId'] === 'string' ? parsed['categoryId'] : null;
  const annotationCategoryId =
    parsedCategoryId && input.categories.some((item) => item.id === parsedCategoryId)
      ? parsedCategoryId
      : null;
  const categoryOverrideId =
    resolveOpenFinanceCategoryId(parsed['categoryOverrideId'], input.openFinanceCategories) ??
    resolveOpenFinanceCategoryId(parsed['openFinanceCategoryId'], input.openFinanceCategories) ??
    (annotationCategoryId
      ? null
      : resolveOpenFinanceCategoryId(parsedCategoryId, input.openFinanceCategories));
  const categoryId = annotationCategoryId;
  const subCategoryId =
    typeof parsed['subCategoryId'] === 'string' &&
    input.categories.some((item) => item.id === parsed['subCategoryId'])
      ? parsed['subCategoryId']
      : null;

  const labelIds = readStringArray(parsed['labelIds'])
    .filter((id) => input.labels.some((item) => item.id === id))
    .slice(0, 3);
  const labelNames = readStringArray(parsed['labelNames']).slice(0, 3);

  return {
    categoryOverrideId,
    categoryId,
    subCategoryId,
    labelIds,
    labelNames,
    notes: typeof parsed['notes'] === 'string' ? parsed['notes'] : null,
    reasoning: typeof parsed['reasoning'] === 'string' ? parsed['reasoning'] : null,
  };
}

export async function proposeAnnotationFromExamples(
  config: ScoringModelConfig,
  input: AssistClassifierInput,
): Promise<AnnotationAssistProposal | null> {
  if (
    input.examples.length === 0 &&
    input.openFinanceCategories.length === 0 &&
    input.labels.length === 0 &&
    input.categories.length === 0
  ) {
    return null;
  }

  const result = await generateText({
    model: createLanguageModel(config),
    system: ASSIST_CLASSIFIER_SYSTEM,
    prompt: buildAssistClassifierPrompt(input),
  });

  const parsed = extractJsonObject(result.text);
  if (!parsed) {
    return null;
  }

  return parseAssistProposal(parsed, input);
}
