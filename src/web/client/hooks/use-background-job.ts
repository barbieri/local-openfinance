import { useEffect, useRef } from 'react';
import type { PrecomputeJobUiState, SyncJobUiState } from '../lib/background-jobs.js';
import { useBackgroundJobs } from '../providers/BackgroundJobsProvider.js';

type UseSyncBackgroundJobOptions = {
  readonly onSyncDone?: () => void;
  readonly onPrecomputeDone?: () => void;
  readonly onError?: (message: string) => void;
  readonly onAborted?: () => void;
};

function handleSyncJobSideEffects(
  previous: SyncJobUiState,
  current: SyncJobUiState,
  callbacks: UseSyncBackgroundJobOptions,
): void {
  if (!previous.done && current.done) {
    callbacks.onSyncDone?.();
  }
  if (!previous.precomputeDone && current.precomputeDone) {
    callbacks.onPrecomputeDone?.();
  }
  if (!previous.error && current.error) {
    callbacks.onError?.(current.error);
  }
  if (!previous.aborted && current.aborted) {
    callbacks.onAborted?.();
  }
}

export function useSyncBackgroundJob(options: UseSyncBackgroundJobOptions = {}) {
  const optionsRef = useRef(options);
  const previousUiRef = useRef<SyncJobUiState | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const { snapshot, syncUi, startSync, startPrecompute, abort, canAbort, syncBusy } =
    useBackgroundJobs();

  useEffect(() => {
    const previous = previousUiRef.current;
    if (previous) {
      handleSyncJobSideEffects(previous, syncUi, optionsRef.current);
    }
    previousUiRef.current = syncUi;
  }, [syncUi]);

  return {
    snapshot,
    uiState: syncUi,
    busy: syncBusy,
    startSync: (forceUpsert: boolean, skipPrecompute: boolean, clearPending = false) =>
      startSync(forceUpsert, skipPrecompute, clearPending),
    startPrecompute: (clearPending = false) => startPrecompute(clearPending),
    abort,
    canAbort,
  };
}

type UsePrecomputeBackgroundJobOptions = {
  readonly onDone?: () => void;
  readonly onError?: (message: string) => void;
  readonly onAborted?: () => void;
};

function handlePrecomputeJobSideEffects(
  previous: PrecomputeJobUiState,
  current: PrecomputeJobUiState,
  callbacks: UsePrecomputeBackgroundJobOptions,
): void {
  if (!previous.done && current.done) {
    callbacks.onDone?.();
  }
  if (!previous.error && current.error) {
    callbacks.onError?.(current.error);
  }
  if (!previous.aborted && current.aborted) {
    callbacks.onAborted?.();
  }
}

export function usePrecomputeBackgroundJob(options: UsePrecomputeBackgroundJobOptions = {}) {
  const optionsRef = useRef(options);
  const previousUiRef = useRef<PrecomputeJobUiState | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const { snapshot, precomputeUi, startPrecompute, abort, canAbort } = useBackgroundJobs();

  useEffect(() => {
    const previous = previousUiRef.current;
    if (previous) {
      handlePrecomputeJobSideEffects(previous, precomputeUi, optionsRef.current);
    }
    previousUiRef.current = precomputeUi;
  }, [precomputeUi]);

  return {
    snapshot,
    uiState: precomputeUi,
    startPrecompute: (clearPending = false) => startPrecompute(clearPending),
    abort,
    canAbort,
  };
}
