import { useTranslation } from 'react-i18next';
import { MdCheckCircle, MdSync } from 'react-icons/md';
import { JobErrorBanner } from '../ui/JobErrorBanner.js';

export type PrecomputeUiEvent =
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
      readonly summary: {
        readonly ok: number;
        readonly total: number;
      };
    }
  | { readonly type: 'error'; readonly message: string };

type PrecomputeProgressViewProps = {
  readonly running: boolean;
  readonly event: PrecomputeUiEvent | null;
  readonly done: boolean;
  readonly error: string | null;
};

export function PrecomputeProgressView({
  running,
  event,
  done,
  error,
}: PrecomputeProgressViewProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4 font-mono text-sm">
      {running && (
        <div className="flex items-center gap-2 text-cyan-700 dark:text-cyan-400">
          <MdSync className="size-5 animate-spin" />
          <span>{t('triage.precomputeRunning')}</span>
        </div>
      )}

      {event?.type === 'start' && (
        <p className="text-muted-foreground">
          {t('triage.precomputeStart', { total: event.total })}
        </p>
      )}

      {event?.type === 'progress' && (
        <p>
          {event.current}/{event.total} · {event.status}
        </p>
      )}

      {event?.type === 'done' && (
        <p className="text-muted-foreground">
          {t('triage.precomputeSummary', {
            ok: event.summary.ok,
            total: event.summary.total,
          })}
        </p>
      )}

      {done && (
        <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
          <MdCheckCircle className="size-5" />
          {t('triage.precomputeDone')}
        </div>
      )}

      {error && <JobErrorBanner error={error} titleKey="triage.precomputeErrorTitle" />}
    </div>
  );
}
