import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PrecomputeProgressView } from '../components/classify-triage/PrecomputeProgressView.js';
import { SyncProgressView } from '../components/sync/SyncProgressView.js';
import { useSyncBackgroundJob } from '../hooks/use-background-job.js';

export function SyncPage() {
  const { t } = useTranslation();
  const [forceUpsert, setForceUpsert] = useState(false);
  const [skipPrecomputeAssist, setSkipPrecomputeAssist] = useState(false);
  const [clearPendingAssist, setClearPendingAssist] = useState(false);

  const { uiState, busy, startSync, startPrecompute, abort, canAbort } = useSyncBackgroundJob({
    onSyncDone: () => {
      toast.success(t('sync.done'));
    },
    onPrecomputeDone: () => {
      toast.success(t('triage.precomputeDone'));
    },
    onError: (message) => {
      toast.error(t('sync.errorTitle'), {
        description: message,
        duration: Infinity,
        classNames: { description: 'whitespace-pre-wrap break-words font-mono text-xs' },
      });
    },
    onAborted: () => {
      toast.message(t('jobs.aborted'));
    },
  });

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={forceUpsert}
            disabled={busy}
            onChange={(event) => setForceUpsert(event.target.checked)}
          />
          <span>{t('sync.forceUpsert')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={skipPrecomputeAssist}
            disabled={busy}
            onChange={(event) => setSkipPrecomputeAssist(event.target.checked)}
          />
          <span>{t('sync.skipPrecomputeAssist')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={clearPendingAssist}
            disabled={busy}
            onChange={(event) => setClearPendingAssist(event.target.checked)}
          />
          <span>{t('sync.clearPendingAssist')}</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
            onClick={() => void startSync(forceUpsert, skipPrecomputeAssist, clearPendingAssist)}
          >
            {uiState.running ? t('sync.running') : t('actions.sync')}
          </button>
          {canAbort && (
            <button
              type="button"
              className="rounded border border-destructive px-4 py-2 text-destructive"
              onClick={() => void abort()}
            >
              {t('jobs.abort')}
            </button>
          )}
        </div>
        <SyncProgressView
          running={uiState.running}
          live={uiState.live}
          trails={[...uiState.trails]}
          error={uiState.error}
          done={uiState.done}
        />
        {uiState.aborted && <p className="text-sm text-muted-foreground">{t('jobs.aborted')}</p>}
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <div>
          <h2 className="text-base font-semibold">{t('sync.precomputeTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('sync.precomputeHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded border border-border bg-background px-4 py-2 text-sm font-medium disabled:opacity-50"
            onClick={() => void startPrecompute(clearPendingAssist)}
          >
            {uiState.precomputeRunning ? t('triage.precomputeRunning') : t('triage.precompute')}
          </button>
          {canAbort && uiState.precomputeRunning && (
            <button
              type="button"
              className="rounded border border-destructive px-4 py-2 text-sm text-destructive"
              onClick={() => void abort()}
            >
              {t('jobs.abort')}
            </button>
          )}
        </div>
        {(uiState.precomputeRunning || uiState.precomputeDone || uiState.precomputeError) && (
          <PrecomputeProgressView
            running={uiState.precomputeRunning}
            event={uiState.precomputeEvent}
            done={uiState.precomputeDone}
            error={uiState.precomputeError}
          />
        )}
      </section>
    </div>
  );
}
