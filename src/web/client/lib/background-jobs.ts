import type { PrecomputeUiEvent } from '../components/classify-triage/PrecomputeProgressView.js';
import {
  applySyncEvent,
  type SyncItemCounts,
  type SyncUiEvent,
} from '../components/sync/sync-progress-events.js';
import { apiFetch, apiJson } from './api.js';
import { consumeSseStream } from './consume-sse-stream.js';

export type JobSnapshot = {
  readonly kind: 'sync' | 'precompute';
  readonly status: 'running' | 'completed' | 'failed' | 'aborted';
  readonly phase: 'sync' | 'precompute' | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly error: string | null;
  readonly params: {
    readonly forceUpsert?: boolean;
    readonly skipPrecompute?: boolean;
    readonly clearPending?: boolean;
  } | null;
  readonly precomputeProgress: PrecomputeUiEvent | null;
};

export type SyncStreamEvent =
  | SyncUiEvent
  | { readonly type: 'precompute'; readonly event: PrecomputeUiEvent }
  | {
      readonly type: 'precompute-done';
      readonly summary: { readonly ok: number; readonly total: number };
    }
  | { readonly type: 'aborted' };

type JobEvent = Record<string, unknown>;

export type SyncJobUiState = {
  readonly running: boolean;
  readonly live: SyncUiEvent | null;
  readonly trails: readonly { readonly label: string; readonly counts: SyncItemCounts }[];
  readonly error: string | null;
  readonly done: boolean;
  readonly aborted: boolean;
  readonly precomputeRunning: boolean;
  readonly precomputeEvent: PrecomputeUiEvent | null;
  readonly precomputeDone: boolean;
  readonly precomputeError: string | null;
};

export const emptySyncJobUiState = (): SyncJobUiState => ({
  running: false,
  live: null,
  trails: [],
  error: null,
  done: false,
  aborted: false,
  precomputeRunning: false,
  precomputeEvent: null,
  precomputeDone: false,
  precomputeError: null,
});

export type PrecomputeJobUiState = {
  readonly running: boolean;
  readonly event: PrecomputeUiEvent | null;
  readonly done: boolean;
  readonly error: string | null;
  readonly aborted: boolean;
};

export const emptyPrecomputeJobUiState = (): PrecomputeJobUiState => ({
  running: false,
  event: null,
  done: false,
  error: null,
  aborted: false,
});

export async function fetchCurrentJob(): Promise<JobSnapshot | null> {
  const body = await apiJson<{ active: JobSnapshot | null }>('/api/jobs/current');
  return body.active;
}

export async function startSyncJob(
  forceUpsert: boolean,
  skipPrecompute: boolean,
  clearPending = false,
): Promise<'started' | 'already-running'> {
  const params = new URLSearchParams();
  if (forceUpsert) {
    params.set('force-upsert', 'true');
  }
  if (skipPrecompute) {
    params.set('no-precompute-assist', 'true');
  }
  if (clearPending) {
    params.set('clear-pending', 'true');
  }
  const query = params.size > 0 ? `?${params.toString()}` : '';
  try {
    const response = await apiFetch(`/api/jobs/sync${query}`, { method: 'POST' });
    if (response.status === 409) {
      return 'already-running';
    }
    if (!response.ok) {
      throw new Error(await readJobStartError(response));
    }
    return 'started';
  } catch (error) {
    throw new Error(formatClientJobStartError(error, 'sync'));
  }
}

export async function startPrecomputeJob(
  clearPending = false,
): Promise<'started' | 'already-running'> {
  const query = clearPending ? '?clear-pending=true' : '';
  try {
    const response = await apiFetch(`/api/jobs/precompute${query}`, { method: 'POST' });
    if (response.status === 409) {
      return 'already-running';
    }
    if (!response.ok) {
      throw new Error(await readJobStartError(response));
    }
    return 'started';
  } catch (error) {
    throw new Error(formatClientJobStartError(error, 'precompute'));
  }
}

async function readJobStartError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) {
    return `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  }
  try {
    const body = JSON.parse(text) as { error?: string; message?: string };
    return body.error ?? body.message ?? text;
  } catch {
    return text;
  }
}

function formatClientJobStartError(error: unknown, kind: 'sync' | 'precompute'): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed|fetch failed/iu.test(message)) {
    return [
      `Cannot reach the local-openfinance web server to start ${kind}.`,
      message,
      'Confirm the serve/dev process is running and this page is opened against the correct host/port.',
    ].join('\n');
  }
  return message;
}

export async function abortBackgroundJob(): Promise<boolean> {
  try {
    await apiJson('/api/jobs/abort', { method: 'POST' });
    return true;
  } catch {
    return false;
  }
}

export function subscribeJobEvents(
  onEvent: (event: JobEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return consumeSseStream('/api/jobs/events', onEvent, signal);
}

export function applySyncStreamEvent(
  state: SyncJobUiState,
  event: SyncStreamEvent,
): SyncJobUiState {
  if (event.type === 'precompute') {
    const next = applyPrecomputeStreamEvent(
      {
        running: true,
        event: state.precomputeEvent,
        done: state.precomputeDone,
        error: state.precomputeError,
        aborted: state.aborted,
      },
      event.event,
    );
    return {
      ...state,
      precomputeRunning: next.running,
      precomputeEvent: next.event,
      precomputeDone: next.done,
      precomputeError: next.error,
      aborted: next.aborted,
    };
  }
  if (event.type === 'precompute-done') {
    return {
      ...state,
      precomputeRunning: false,
      precomputeDone: true,
      precomputeEvent: { type: 'done', summary: event.summary },
    };
  }
  if (event.type === 'aborted') {
    return {
      ...state,
      running: false,
      precomputeRunning: false,
      aborted: true,
    };
  }
  if (event.type === 'error') {
    return {
      ...state,
      running: false,
      precomputeRunning: false,
      error: event.message,
    };
  }
  if (event.type === 'done') {
    return {
      ...state,
      running: false,
      done: true,
    };
  }
  const syncPart = applySyncEvent(
    {
      live: state.live,
      trails: [...state.trails],
      error: state.error,
      done: state.done,
    },
    event,
  );
  return {
    ...state,
    live: syncPart.live,
    trails: syncPart.trails,
    error: syncPart.error,
    done: syncPart.done,
  };
}

export function applyPrecomputeStreamEvent(
  state: PrecomputeJobUiState,
  event: PrecomputeUiEvent,
): PrecomputeJobUiState {
  if (event.type === 'error') {
    return {
      ...state,
      running: false,
      event,
      error: event.message,
    };
  }
  if (event.type === 'done') {
    return {
      ...state,
      running: false,
      event,
      done: true,
    };
  }
  return {
    ...state,
    running: true,
    event,
  };
}

export function applyRawJobEventToSyncState(state: SyncJobUiState, raw: JobEvent): SyncJobUiState {
  if (raw['type'] === 'precompute' && raw['event']) {
    return applySyncStreamEvent(state, {
      type: 'precompute',
      event: raw['event'] as PrecomputeUiEvent,
    });
  }
  return applySyncStreamEvent(state, raw as SyncStreamEvent);
}

export function applyRawJobEventToPrecomputeState(
  state: PrecomputeJobUiState,
  raw: JobEvent,
  snapshot: JobSnapshot | null,
): PrecomputeJobUiState {
  if (snapshot?.kind === 'sync' && raw['type'] === 'precompute' && raw['event']) {
    return applyPrecomputeStreamEvent(state, raw['event'] as PrecomputeUiEvent);
  }
  if (raw['type'] === 'aborted') {
    return { ...state, running: false, aborted: true };
  }
  if (raw['type'] === 'error') {
    return {
      ...state,
      running: false,
      error: String(raw['message'] ?? 'Unknown error'),
    };
  }
  if (raw['type'] === 'done' && raw['summary']) {
    const summary = raw['summary'] as { readonly ok: number; readonly total: number };
    return applyPrecomputeStreamEvent(state, { type: 'done', summary });
  }
  return applyPrecomputeStreamEvent(state, raw as PrecomputeUiEvent);
}

export function isPrecomputeJobRelevant(snapshot: JobSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }
  if (snapshot.kind === 'precompute') {
    return true;
  }
  return snapshot.kind === 'sync' && snapshot.phase === 'precompute';
}

export function isSyncJobRelevant(snapshot: JobSnapshot | null): boolean {
  return snapshot?.kind === 'sync';
}

export function hydrateSyncStateFromSnapshot(
  state: SyncJobUiState,
  snapshot: JobSnapshot | null,
): SyncJobUiState {
  if (snapshot?.kind !== 'sync') {
    return state;
  }
  let next = state;
  if (snapshot.status === 'running') {
    next = {
      ...state,
      running: snapshot.phase !== 'precompute',
      precomputeRunning: snapshot.phase === 'precompute',
    };
  } else if (snapshot.status === 'completed') {
    next = {
      ...state,
      running: false,
      done: snapshot.phase !== 'precompute',
      precomputeDone: snapshot.phase === 'precompute' || !snapshot.params?.skipPrecompute,
    };
  } else if (snapshot.status === 'aborted') {
    next = { ...state, running: false, precomputeRunning: false, aborted: true };
  } else if (snapshot.status === 'failed') {
    next = { ...state, running: false, precomputeRunning: false, error: snapshot.error };
  }
  const progress = snapshot.precomputeProgress;
  if (progress && next.precomputeRunning) {
    next = applySyncStreamEvent(next, { type: 'precompute', event: progress });
  }
  return next;
}

export function hydratePrecomputeStateFromSnapshot(
  state: PrecomputeJobUiState,
  snapshot: JobSnapshot | null,
): PrecomputeJobUiState {
  if (!isPrecomputeJobRelevant(snapshot) || !snapshot) {
    return state;
  }
  const progress = snapshot.precomputeProgress;
  let next = state;
  if (snapshot.status === 'running') {
    next = { ...state, running: true };
  } else if (snapshot.status === 'completed') {
    next = { ...state, running: false, done: true };
  } else if (snapshot.status === 'aborted') {
    next = { ...state, running: false, aborted: true };
  } else if (snapshot.status === 'failed') {
    next = { ...state, running: false, error: snapshot.error };
  }
  if (progress && next.running) {
    next = applyPrecomputeStreamEvent(next, progress);
  }
  return next;
}
