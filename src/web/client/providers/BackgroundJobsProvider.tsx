import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  abortBackgroundJob,
  applyRawJobEventToPrecomputeState,
  applyRawJobEventToSyncState,
  emptyPrecomputeJobUiState,
  emptySyncJobUiState,
  fetchCurrentJob,
  hydratePrecomputeStateFromSnapshot,
  hydrateSyncStateFromSnapshot,
  isPrecomputeJobRelevant,
  isSyncJobRelevant,
  type JobSnapshot,
  type PrecomputeJobUiState,
  type SyncJobUiState,
  startPrecomputeJob,
  startSyncJob,
  subscribeJobEvents,
} from '../lib/background-jobs.js';

type BackgroundJobsContextValue = {
  readonly snapshot: JobSnapshot | null;
  readonly syncUi: SyncJobUiState;
  readonly precomputeUi: PrecomputeJobUiState;
  readonly syncBusy: boolean;
  readonly canAbort: boolean;
  readonly startSync: (
    forceUpsert: boolean,
    skipPrecompute: boolean,
    clearPending: boolean,
  ) => Promise<void>;
  readonly startPrecompute: (clearPending: boolean) => Promise<void>;
  readonly abort: () => Promise<void>;
};

const BackgroundJobsContext = createContext<BackgroundJobsContextValue | null>(null);

export function BackgroundJobsProvider({ children }: { readonly children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);
  const [syncUi, setSyncUi] = useState<SyncJobUiState>(emptySyncJobUiState);
  const [precomputeUi, setPrecomputeUi] = useState<PrecomputeJobUiState>(emptyPrecomputeJobUiState);
  const subscriptionRef = useRef<AbortController | null>(null);
  const snapshotRef = useRef<JobSnapshot | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const refreshFromServer = useCallback(async (): Promise<JobSnapshot | null> => {
    const active = await fetchCurrentJob();
    setSnapshot(active);
    setSyncUi((prev) => hydrateSyncStateFromSnapshot(prev, active));
    setPrecomputeUi((prev) => hydratePrecomputeStateFromSnapshot(prev, active));
    return active;
  }, []);

  const attachSubscription = useCallback(() => {
    subscriptionRef.current?.abort();
    const controller = new AbortController();
    subscriptionRef.current = controller;
    void subscribeJobEvents((event) => {
      setSyncUi((prev) => applyRawJobEventToSyncState(prev, event));
      setPrecomputeUi((prev) =>
        applyRawJobEventToPrecomputeState(prev, event, snapshotRef.current),
      );
    }, controller.signal).finally(() => {
      void refreshFromServer();
    });
  }, [refreshFromServer]);

  useEffect(() => {
    void refreshFromServer().then((active) => {
      if (
        active?.status === 'running' &&
        (isSyncJobRelevant(active) || isPrecomputeJobRelevant(active))
      ) {
        attachSubscription();
      }
    });

    const poll = window.setInterval(() => {
      const subscribed =
        subscriptionRef.current !== null && !subscriptionRef.current.signal.aborted;
      void refreshFromServer().then((active) => {
        if (
          active?.status === 'running' &&
          !subscribed &&
          (isSyncJobRelevant(active) || isPrecomputeJobRelevant(active))
        ) {
          attachSubscription();
        }
      });
    }, 2000);

    return () => {
      window.clearInterval(poll);
    };
  }, [attachSubscription, refreshFromServer]);

  const startSync = useCallback(
    async (forceUpsert: boolean, skipPrecompute: boolean, clearPending: boolean): Promise<void> => {
      setSyncUi({
        ...emptySyncJobUiState(),
        running: true,
        precomputeRunning: !skipPrecompute,
      });
      try {
        const result = await startSyncJob(forceUpsert, skipPrecompute, clearPending);
        if (result === 'already-running') {
          await refreshFromServer();
          attachSubscription();
          return;
        }
        attachSubscription();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSyncUi({
          ...emptySyncJobUiState(),
          error: message,
        });
      }
    },
    [attachSubscription, refreshFromServer],
  );

  const startPrecompute = useCallback(
    async (clearPending: boolean): Promise<void> => {
      setPrecomputeUi({ ...emptyPrecomputeJobUiState(), running: true });
      setSyncUi((prev) => ({
        ...prev,
        precomputeRunning: true,
        precomputeDone: false,
        precomputeError: null,
        precomputeEvent: null,
      }));
      try {
        const result = await startPrecomputeJob(clearPending);
        if (result === 'already-running') {
          await refreshFromServer();
          attachSubscription();
          return;
        }
        attachSubscription();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setPrecomputeUi({
          ...emptyPrecomputeJobUiState(),
          error: message,
        });
        setSyncUi((prev) => ({
          ...prev,
          precomputeRunning: false,
          precomputeError: message,
        }));
      }
    },
    [attachSubscription, refreshFromServer],
  );

  const abort = useCallback(async (): Promise<void> => {
    await abortBackgroundJob();
  }, []);

  const value = useMemo(
    (): BackgroundJobsContextValue => ({
      snapshot,
      syncUi,
      precomputeUi,
      syncBusy: syncUi.running || syncUi.precomputeRunning,
      canAbort: snapshot?.status === 'running',
      startSync,
      startPrecompute,
      abort,
    }),
    [abort, precomputeUi, snapshot, startPrecompute, startSync, syncUi],
  );

  return <BackgroundJobsContext.Provider value={value}>{children}</BackgroundJobsContext.Provider>;
}

export function useBackgroundJobs(): BackgroundJobsContextValue {
  const context = use(BackgroundJobsContext);
  if (!context) {
    throw new Error('useBackgroundJobs must be used within BackgroundJobsProvider');
  }
  return context;
}
