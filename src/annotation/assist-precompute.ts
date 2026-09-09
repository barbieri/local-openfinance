import type { DatabaseSync } from 'node:sqlite';
import type { ResolvedAppConfig } from '../types.js';
import { throwIfAborted } from '../utils/job-abort.js';
import { mapInParallel } from '../utils/map-in-parallel.js';
import { computeAnnotationAssist } from './assist.js';
import {
  ASSIST_SUGGESTION_ALGORITHM_VERSION,
  clearUnannotatedAssistSuggestions,
  loadAssistSuggestion,
  upsertAssistSuggestion,
} from './assist-suggestions.js';
import { backfillAssistableAnnotationEmbeddings } from './entry-embeddings.js';
import { listUnannotatedEntries } from './store.js';

export type AssistPrecomputeProgressEvent =
  | { readonly type: 'start'; readonly total: number }
  | {
      readonly type: 'progress';
      readonly current: number;
      readonly total: number;
      readonly entryId: string;
      readonly status: string;
    }
  | {
      readonly type: 'done';
      readonly summary: AssistPrecomputeSummary;
    }
  | { readonly type: 'error'; readonly message: string };

export type AssistPrecomputeSummary = {
  readonly cleared: number;
  readonly backfilledEmbeddings: number;
  readonly total: number;
  readonly ok: number;
  readonly noSuggestion: number;
  readonly noCandidates: number;
  readonly skippedExisting: number;
  readonly skippedMissingConfig: boolean;
};

export type AssistPrecomputeOptions = {
  readonly limit?: number | undefined;
  readonly clearPending?: boolean | undefined;
  readonly onProgress?: (event: AssistPrecomputeProgressEvent) => void;
  readonly signal?: AbortSignal | undefined;
};

function resolveAssistPrecomputeSkipStatus(
  existing: ReturnType<typeof loadAssistSuggestion>,
  clearPending: boolean,
): string | null {
  if (existing?.reviewStatus === 'applied' || existing?.reviewStatus === 'dismissed') {
    return `skipped_${existing.reviewStatus}`;
  }
  if (
    !clearPending &&
    existing?.reviewStatus === 'pending' &&
    existing.algorithmVersion === ASSIST_SUGGESTION_ALGORITHM_VERSION
  ) {
    return 'skipped_existing';
  }
  return null;
}

async function processAssistPrecomputeEntry(
  db: DatabaseSync,
  entry: NonNullable<ReturnType<typeof listUnannotatedEntries>[number]>,
  options: {
    readonly embedding: NonNullable<ResolvedAppConfig['annotation']['embedding']>;
    readonly classifier: ResolvedAppConfig['annotation']['classifier'];
    readonly clearPending: boolean;
    readonly computedAt: string;
    readonly onProgress?: AssistPrecomputeOptions['onProgress'];
    readonly index: number;
    readonly total: number;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<'ok' | 'no_suggestion' | 'no_candidates' | 'skipped_existing' | 'skipped_reviewed'> {
  throwIfAborted(options.signal);

  const existing = loadAssistSuggestion(db, entry.entryId);
  const skipStatus = resolveAssistPrecomputeSkipStatus(existing, options.clearPending);
  if (skipStatus) {
    options.onProgress?.({
      type: 'progress',
      current: options.index + 1,
      total: options.total,
      entryId: entry.entryId,
      status: skipStatus,
    });
    return skipStatus === 'skipped_existing' ? 'skipped_existing' : 'skipped_reviewed';
  }

  const result = await computeAnnotationAssist(db, entry, {
    embedding: options.embedding,
    classifier: options.classifier,
  });

  upsertAssistSuggestion(db, {
    entryType: 'transaction',
    entryId: entry.entryId,
    status: result.status,
    proposal: result.proposal,
    examples: result.examples,
    confidence: result.confidence,
    usedClassifier: result.usedClassifier,
    embeddingModel: options.embedding.model,
    classifierModel: options.classifier?.model ?? null,
    algorithmVersion: ASSIST_SUGGESTION_ALGORITHM_VERSION,
    computedAt: options.computedAt,
    reviewStatus: 'pending',
    reviewedAt: null,
  });

  options.onProgress?.({
    type: 'progress',
    current: options.index + 1,
    total: options.total,
    entryId: entry.entryId,
    status: result.status,
  });

  if (result.status === 'ok') {
    return 'ok';
  }
  if (result.status === 'no_suggestion') {
    return 'no_suggestion';
  }
  return 'no_candidates';
}

export async function runAssistPrecompute(
  db: DatabaseSync,
  config: ResolvedAppConfig,
  options: AssistPrecomputeOptions = {},
): Promise<AssistPrecomputeSummary> {
  const embedding = config.annotation.embedding;
  if (!embedding) {
    const summary: AssistPrecomputeSummary = {
      cleared: 0,
      backfilledEmbeddings: 0,
      total: 0,
      ok: 0,
      noSuggestion: 0,
      noCandidates: 0,
      skippedExisting: 0,
      skippedMissingConfig: true,
    };
    options.onProgress?.({ type: 'done', summary });
    return summary;
  }

  const entries = listUnannotatedEntries(db, {
    entryTypes: ['transaction'],
    limit: options.limit ?? 10_000,
  });

  const clearPending = options.clearPending === true;
  const cleared = clearPending ? clearUnannotatedAssistSuggestions(db) : 0;
  const backfilledEmbeddings = await backfillAssistableAnnotationEmbeddings(db, embedding);

  let ok = 0;
  let noSuggestion = 0;
  let noCandidates = 0;
  let skippedExisting = 0;
  const total = entries.length;
  const computedAt = new Date().toISOString();
  const classifier = config.annotation.classifier;

  options.onProgress?.({ type: 'start', total });

  const outcomes = await mapInParallel(
    entries,
    async (entry, index) =>
      processAssistPrecomputeEntry(db, entry, {
        embedding,
        classifier,
        clearPending,
        computedAt,
        onProgress: options.onProgress,
        index,
        total,
        signal: options.signal,
      }),
    8,
  );

  for (const outcome of outcomes) {
    if (outcome === 'ok') {
      ok += 1;
    } else if (outcome === 'no_suggestion') {
      noSuggestion += 1;
    } else if (outcome === 'no_candidates') {
      noCandidates += 1;
    } else if (outcome === 'skipped_existing') {
      skippedExisting += 1;
    }
  }

  const summary: AssistPrecomputeSummary = {
    cleared,
    backfilledEmbeddings,
    total,
    ok,
    noSuggestion,
    noCandidates,
    skippedExisting,
    skippedMissingConfig: false,
  };
  options.onProgress?.({ type: 'done', summary });
  return summary;
}
