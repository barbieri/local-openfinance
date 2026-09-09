import type { DatabaseSync } from 'node:sqlite';
import {
  type AssistPrecomputeOptions,
  type AssistPrecomputeSummary,
  runAssistPrecompute,
} from '../../annotation/assist-precompute.js';
import { runPostSyncAssist } from '../../intelligence/post-sync-assist.js';
import type { OpenFinanceClient } from '../../openfinance/client.js';
import { OpenFinanceClient as DefaultOpenFinanceClient } from '../../openfinance/client.js';
import type { SyncSummary } from '../../openfinance/sync/engine.js';
import { syncOpenFinanceData } from '../../openfinance/sync/engine.js';
import type { ResolvedConfig } from '../../types.js';
import { formatUnknownError } from '../../utils/format-error.js';
import { JobAbortedError } from '../../utils/job-abort.js';
import { createSseSyncProgress, type SseSyncEvent } from './sync-sse.js';

export type JobKind = 'sync' | 'precompute';
export type JobPhase = 'sync' | 'precompute';
export type JobStatus = 'running' | 'completed' | 'failed' | 'aborted';

export type JobEvent = Record<string, unknown>;

export type SyncJobParams = {
  readonly forceUpsert: boolean;
  readonly skipPrecompute: boolean;
  readonly clearPending: boolean;
};

export type PrecomputeJobParams = {
  readonly clearPending: boolean;
};

export type JobParams = SyncJobParams | PrecomputeJobParams | null;

export type JobSnapshot = {
  readonly kind: JobKind;
  readonly status: JobStatus;
  readonly phase: JobPhase | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly error: string | null;
  readonly params: JobParams;
  readonly precomputeProgress: Record<string, unknown> | null;
};

type ActiveJob = {
  kind: JobKind;
  status: JobStatus;
  phase: JobPhase | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  params: JobParams;
  events: JobEvent[];
  abortController: AbortController;
};

export type BackgroundJobRunContext = {
  readonly db: DatabaseSync;
  readonly resolved: ResolvedConfig;
  readonly createClient?: () => OpenFinanceClient;
};

type PrecomputeRunner = (
  ctx: BackgroundJobRunContext,
  signal: AbortSignal | undefined,
  clearPending: boolean,
  syncedAt?: string,
) => Promise<AssistPrecomputeSummary>;

export class BackgroundJobManager {
  private job: ActiveJob | null = null;
  private readonly subscribers = new Set<(event: JobEvent) => void>();

  getCurrent(): JobSnapshot | null {
    if (!this.job) {
      return null;
    }
    return this.toSnapshot(this.job);
  }

  isRunning(): boolean {
    return this.job?.status === 'running';
  }

  subscribe(onEvent: (event: JobEvent) => void): () => void {
    if (this.job) {
      for (const event of this.job.events) {
        onEvent(event);
      }
    }
    this.subscribers.add(onEvent);
    return () => {
      this.subscribers.delete(onEvent);
    };
  }

  startSync(ctx: BackgroundJobRunContext, params: SyncJobParams): 'started' | 'already-running' {
    return this.startSyncJob(ctx, params, this.runPrecompute.bind(this));
  }

  startBackgroundSync(
    ctx: BackgroundJobRunContext,
    params: SyncJobParams,
  ): 'started' | 'already-running' {
    return this.startSyncJob(ctx, params, this.runPostSyncPrecompute.bind(this));
  }

  private startSyncJob(
    ctx: BackgroundJobRunContext,
    params: SyncJobParams,
    runPrecompute: PrecomputeRunner,
  ): 'started' | 'already-running' {
    if (this.isRunning()) {
      return 'already-running';
    }
    this.beginJob('sync', params);
    void this.runSyncJob(ctx, params, runPrecompute);
    return 'started';
  }

  startPrecompute(
    ctx: BackgroundJobRunContext,
    params: PrecomputeJobParams,
  ): 'started' | 'already-running' {
    if (this.isRunning()) {
      return 'already-running';
    }
    this.beginJob('precompute', params);
    void this.runPrecomputeJob(ctx, params);
    return 'started';
  }

  abort(): boolean {
    if (this.job?.status !== 'running') {
      return false;
    }
    this.job.abortController.abort();
    return true;
  }

  private beginJob(kind: JobKind, params: JobParams): void {
    this.job = {
      kind,
      status: 'running',
      phase: kind === 'sync' ? 'sync' : 'precompute',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      params,
      events: [],
      abortController: new AbortController(),
    };
  }

  private toSnapshot(job: ActiveJob): JobSnapshot {
    return {
      kind: job.kind,
      status: job.status,
      phase: job.phase,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      params: job.params,
      precomputeProgress: extractLatestPrecomputeProgress(job.events, job.kind),
    };
  }

  private emit(event: JobEvent): void {
    if (!this.job) {
      return;
    }
    this.job.events.push(event);
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  private finish(status: JobStatus, error: string | null = null): void {
    if (!this.job) {
      return;
    }
    this.job.status = status;
    this.job.finishedAt = new Date().toISOString();
    this.job.error = error;
    this.job.phase = null;
  }

  private handleFailure(error: unknown): void {
    if (error instanceof JobAbortedError) {
      this.emit({ type: 'aborted' });
      this.finish('aborted');
      return;
    }
    const message = formatUnknownError(error);
    this.emit({ type: 'error', message });
    this.finish('failed', message);
  }

  private async runSyncJob(
    ctx: BackgroundJobRunContext,
    params: SyncJobParams,
    runPrecompute: PrecomputeRunner,
  ): Promise<void> {
    const signal = this.job?.abortController.signal;
    const progress = createSseSyncProgress((event: SseSyncEvent) => {
      this.emit(event as JobEvent);
    });

    try {
      const client = ctx.createClient?.() ?? new DefaultOpenFinanceClient();
      const summary = await syncOpenFinanceData(ctx.db, client, {
        ...ctx.resolved.config.sync,
        forceUpsert: params.forceUpsert,
        progress,
        signal,
      });
      this.emit({ type: 'done', summary: summary as unknown as Record<string, unknown> });

      if (!params.skipPrecompute) {
        if (signal?.aborted) {
          throw new JobAbortedError();
        }
        this.setPhase('precompute');
        const precomputeSummary = await runPrecompute(
          ctx,
          signal,
          params.clearPending,
          summary.syncedAt,
        );
        this.emit({
          type: 'precompute-done',
          summary: precomputeSummary as unknown as Record<string, unknown>,
        });
      }

      this.finish('completed');
    } catch (error) {
      this.handleFailure(error);
    }
  }

  private async runPrecomputeJob(
    ctx: BackgroundJobRunContext,
    params: PrecomputeJobParams,
  ): Promise<void> {
    const signal = this.job?.abortController.signal;

    try {
      const summary = await this.runPrecompute(ctx, signal, params.clearPending);
      this.emit({ type: 'done', summary: summary as unknown as Record<string, unknown> });
      this.finish('completed');
    } catch (error) {
      this.handleFailure(error);
    }
  }

  private async runPrecompute(
    ctx: BackgroundJobRunContext,
    signal: AbortSignal | undefined,
    clearPending: boolean,
  ): Promise<AssistPrecomputeSummary> {
    const commonInput = {
      db: ctx.db,
      resolved: ctx.resolved,
      signal,
      clearPending,
      onProgress: (event: Parameters<NonNullable<AssistPrecomputeOptions['onProgress']>>[0]) => {
        if (this.job?.kind === 'sync') {
          this.emit({ type: 'precompute', event });
          return;
        }
        this.emit(event as JobEvent);
      },
    };
    return runAssistPrecompute(ctx.db, ctx.resolved.config, commonInput);
  }

  private async runPostSyncPrecompute(
    ctx: BackgroundJobRunContext,
    signal: AbortSignal | undefined,
    clearPending: boolean,
    syncedAt: string | undefined,
  ): Promise<AssistPrecomputeSummary> {
    const result = await runPostSyncAssist({
      db: ctx.db,
      resolved: ctx.resolved,
      signal,
      clearPending,
      syncedAt,
      onProgress: (event) => {
        this.emit({ type: 'precompute', event });
      },
    });
    if (result.digest.kind === 'failed') {
      this.emit({ type: 'suggestion-digest-error', message: result.digest.error.message });
      throw result.digest.error;
    }
    return result.precompute;
  }

  private setPhase(phase: JobPhase): void {
    if (!this.job) {
      return;
    }
    this.job.phase = phase;
  }
}

export function isPrecomputeJobActive(snapshot: JobSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }
  if (snapshot.kind === 'precompute') {
    return snapshot.status === 'running';
  }
  return (
    snapshot.kind === 'sync' && snapshot.phase === 'precompute' && snapshot.status === 'running'
  );
}

export function isSyncJobActive(snapshot: JobSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }
  return snapshot.kind === 'sync' && snapshot.status === 'running';
}

function extractLatestPrecomputeProgress(
  events: readonly JobEvent[],
  kind: JobKind,
): Record<string, unknown> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) {
      continue;
    }
    if (kind === 'sync' && event['type'] === 'precompute' && event['event']) {
      return event['event'] as Record<string, unknown>;
    }
    if (
      kind === 'precompute' &&
      (event['type'] === 'progress' || event['type'] === 'start' || event['type'] === 'done')
    ) {
      return event;
    }
  }
  return null;
}

export type ParsedSyncSummary = SyncSummary;
