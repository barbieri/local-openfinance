import type {
  SyncItemCounts,
  SyncPhase,
  SyncProgressReporter,
} from '../../openfinance/sync/progress.js';

export type SseSyncEvent =
  | { readonly type: 'phase'; readonly phase: SyncPhase; readonly detail?: string }
  | {
      readonly type: 'step';
      readonly current: number;
      readonly total?: number;
      readonly detail?: string;
    }
  | { readonly type: 'trail'; readonly label: string; readonly counts: SyncItemCounts }
  | { readonly type: 'done'; readonly summary: Record<string, unknown> }
  | { readonly type: 'error'; readonly message: string };

export function createSseSyncProgress(emit: (event: SseSyncEvent) => void): SyncProgressReporter {
  return {
    setPhase(phase, detail) {
      if (detail) {
        emit({ type: 'phase', phase, detail });
      } else {
        emit({ type: 'phase', phase });
      }
    },
    setStep(current, total, detail) {
      if (total !== undefined && detail) {
        emit({ type: 'step', current, total, detail });
      } else if (total !== undefined) {
        emit({ type: 'step', current, total });
      } else if (detail) {
        emit({ type: 'step', current, detail });
      } else {
        emit({ type: 'step', current });
      }
    },
    writeTrail(label, counts) {
      emit({ type: 'trail', label, counts });
    },
    finish() {},
  };
}
