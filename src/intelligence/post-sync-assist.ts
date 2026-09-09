import type { DatabaseSync } from 'node:sqlite';
import {
  type AssistPrecomputeOptions,
  type AssistPrecomputeSummary,
  runAssistPrecompute,
} from '../annotation/assist-precompute.js';
import { listPendingAssistSuggestionEntryIds } from '../annotation/pending-assist-suggestions.js';
import { detectRecentSyncedTransfers } from '../transfers/recent-sync.js';
import type { ResolvedConfig } from '../types.js';
import {
  type SyncSuggestionDigestResult,
  sendAssistSuggestionDigest,
} from './sync-suggestion-digest.js';

export type PostSyncAssistResult = {
  readonly precompute: AssistPrecomputeSummary;
  readonly digest: SyncSuggestionDigestResult;
};

export type PostSyncAssistDependencies = {
  readonly listPendingSuggestionEntryIds: typeof listPendingAssistSuggestionEntryIds;
  readonly runPrecompute: typeof runAssistPrecompute;
  readonly sendDigest: typeof sendAssistSuggestionDigest;
  readonly detectRecentTransfers: typeof detectRecentSyncedTransfers;
};

const PRODUCTION_DEPENDENCIES: PostSyncAssistDependencies = {
  listPendingSuggestionEntryIds: listPendingAssistSuggestionEntryIds,
  runPrecompute: runAssistPrecompute,
  sendDigest: sendAssistSuggestionDigest,
  detectRecentTransfers: detectRecentSyncedTransfers,
};

export type PostSyncAssistInput = {
  readonly db: DatabaseSync;
  readonly resolved: ResolvedConfig;
  readonly clearPending?: boolean | undefined;
  readonly onProgress?: AssistPrecomputeOptions['onProgress'];
  readonly signal?: AbortSignal | undefined;
  readonly dryRun?: boolean | undefined;
  readonly syncedAt?: string | undefined;
};

export type PostSyncAssistRunner = (input: PostSyncAssistInput) => Promise<PostSyncAssistResult>;

export function createPostSyncAssist(
  dependencies: PostSyncAssistDependencies,
): PostSyncAssistRunner {
  return async function runPostSyncAssist(
    input: PostSyncAssistInput,
  ): Promise<PostSyncAssistResult> {
    const precomputeOptions: AssistPrecomputeOptions = {
      ...(input.clearPending !== undefined ? { clearPending: input.clearPending } : {}),
      ...(input.onProgress !== undefined ? { onProgress: input.onProgress } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    };
    const previouslyPendingEntryIds = new Set(dependencies.listPendingSuggestionEntryIds(input.db));
    if (input.syncedAt) {
      await dependencies.detectRecentTransfers(input.db, input.syncedAt);
    }
    return dependencies
      .runPrecompute(input.db, input.resolved.config, precomputeOptions)
      .then((precompute) =>
        dependencies
          .sendDigest({
            db: input.db,
            resolved: input.resolved,
            previouslyPendingEntryIds,
            dryRun: input.dryRun === true,
          })
          .then((digest) => ({ precompute, digest })),
      );
  };
}

export const runPostSyncAssist = createPostSyncAssist(PRODUCTION_DEPENDENCIES);
