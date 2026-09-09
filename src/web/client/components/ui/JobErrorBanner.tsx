import { useTranslation } from 'react-i18next';
import { MdError } from 'react-icons/md';

type JobErrorBannerProps = {
  readonly error: string;
  readonly titleKey?: string;
};

/**
 * Surfaces multi-line job / integration errors so users can act on network vs
 * upstream Banco MCP failures (copy-friendly mono block).
 */
export function JobErrorBanner({ error, titleKey = 'jobs.errorTitle' }: JobErrorBannerProps) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
    >
      <MdError className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold">{t(titleKey)}</p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
          {error}
        </pre>
      </div>
    </div>
  );
}
