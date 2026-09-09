import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ReportHtml } from '../components/ReportHtml.js';
import { apiJson } from '../lib/api.js';
import type { ReportsSection } from '../lib/app-hash.js';
import { useAppNavigation } from '../lib/navigation.js';
import { formatGenerateCommand } from '../lib/report-command.js';

const ReportChat = lazy(() =>
  import('./ReportChat.js').then((module) => ({ default: module.ReportChat })),
);

type MemoryResponse = {
  readonly markdown: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
};

type RunListItem = {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly createdAt: string;
  readonly subject: string;
  readonly alertCount: number;
  readonly hasChat: boolean;
};

type RunDetail = Omit<RunListItem, 'hasChat'> & {
  readonly markdown: string;
  readonly html: string;
  readonly chartNames: readonly string[];
  readonly charts: readonly {
    readonly name: string;
    readonly mimeType: string;
    readonly dataUrl: string;
  }[];
  readonly citedTransactionIds: readonly string[];
};

type RegenerationPreview = {
  readonly previewId: string;
  readonly run: Pick<RunDetail, 'subject' | 'html' | 'charts'>;
};

type ReportSchedule =
  | { readonly kind: 'daily'; readonly time: string }
  | { readonly kind: 'weekly'; readonly weekday: string; readonly time: string }
  | { readonly kind: 'monthly'; readonly day: number | 'last'; readonly time: string }
  | { readonly kind: 'manual' };

type ReportListItem = {
  readonly id: string;
  readonly name: string;
  readonly schedule: ReportSchedule;
  readonly lastRun: RunListItem | null;
};

type ReportsResponse = {
  readonly configPath: string;
  readonly reports: readonly ReportListItem[];
};

type MemoryEditorState = {
  readonly markdown: string;
  readonly originUpdatedAt: string | null;
  readonly dirty: boolean;
};

const REPORT_SECTIONS = [
  { id: 'current', labelKey: 'reports.sectionCurrent' },
] as const satisfies ReadonlyArray<{ readonly id: ReportsSection; readonly labelKey: string }>;

export function ReportsPage() {
  const { t } = useTranslation();
  const { reportsSection, reportsReportId, reportsRunId, setReportsSection } = useAppNavigation();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['intelligence-reports'],
    queryFn: () => apiJson<ReportsResponse>('/api/intelligence/reports'),
  });

  const reports = data?.reports;
  const legacySection = reportsReportId === null && reportsSection !== 'catalog';
  useEffect(() => {
    if (legacySection && reports?.length === 1) {
      setReportsSection(reports[0]?.id ?? null, reportsSection ?? 'current', reportsRunId);
    }
  }, [legacySection, reports, reportsRunId, reportsSection, setReportsSection]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t('reports.loading')}</p>;
  }
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : t('toast.error')}
      </p>
    );
  }
  if (legacySection) {
    return (
      <p className="text-sm text-destructive">
        {reports?.length === 1 ? t('reports.loading') : t('reports.legacyRouteUnavailable')}
      </p>
    );
  }
  if (!reportsReportId || reportsSection === 'catalog') {
    return <ReportsCatalog reports={reports ?? []} />;
  }

  const report = reports?.find((item) => item.id === reportsReportId);
  if (!report) {
    return <p className="text-sm text-destructive">{t('reports.notFound')}</p>;
  }

  return (
    <ReportPage
      configPath={data?.configPath ?? ''}
      report={report}
      section={reportsSection ?? 'current'}
      runId={reportsRunId}
    />
  );
}

function ReportsCatalog({ reports }: { readonly reports: readonly ReportListItem[] }) {
  const { t } = useTranslation();
  const { setReportsSection } = useAppNavigation();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h2 className="text-lg font-semibold">{t('reports.title')}</h2>
      {reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('reports.catalogEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {reports.map((report) => (
            <li key={report.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-accent"
                onClick={() => setReportsSection(report.id, 'current')}
              >
                <span className="font-medium">{formatReportName(report, t)}</span>
                <span className="font-mono text-xs text-muted-foreground">{report.id}</span>
                <span className="text-sm text-muted-foreground">
                  {formatSchedule(report.schedule, t)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {report.lastRun
                    ? t('reports.lastRunWithAlerts', {
                        at: report.lastRun.createdAt,
                        count: report.lastRun.alertCount,
                      })
                    : t('reports.neverRun')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportPage({
  configPath,
  report,
  section,
  runId,
}: {
  readonly configPath: string;
  readonly report: ReportListItem;
  readonly section: ReportsSection;
  readonly runId: string | null;
}) {
  const { t } = useTranslation();
  const { setReportsSection } = useAppNavigation();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm hover:bg-accent"
          onClick={() => setReportsSection(null, 'catalog')}
        >
          {t('reports.backToCatalog')}
        </button>
        <h2 className="text-lg font-semibold">{formatReportName(report, t)}</h2>
      </div>
      <nav className="flex flex-wrap gap-1">
        {REPORT_SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded px-3 py-1.5 text-sm ${
              section === item.id || (item.id === 'current' && section === 'run')
                ? 'bg-primary text-primary-foreground'
                : 'border hover:bg-accent'
            }`}
            onClick={() => setReportsSection(report.id, item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}
        <button
          type="button"
          className={`ml-auto rounded px-3 py-1.5 text-sm ${
            section === 'memory' ? 'bg-primary text-primary-foreground' : 'border hover:bg-accent'
          }`}
          onClick={() => setReportsSection(report.id, 'memory')}
        >
          {t('reports.sectionMemory')}
        </button>
      </nav>
      {section === 'memory' ? (
        <ReportsMemorySection key={report.id} reportId={report.id} />
      ) : section === 'chat' ? (
        <Suspense
          fallback={<p className="text-sm text-muted-foreground">{t('reports.loading')}</p>}
        >
          <ReportChat reportId={report.id} reportName={formatReportName(report, t)} runId={runId} />
        </Suspense>
      ) : (
        <ReportsCurrentSection
          configPath={configPath}
          reportId={report.id}
          runId={section === 'run' ? runId : null}
        />
      )}
    </div>
  );
}

function ReportsCurrentSection({
  configPath,
  reportId,
  runId,
}: {
  readonly configPath: string;
  readonly reportId: string;
  readonly runId: string | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { setReportsSection } = useAppNavigation();
  const [preview, setPreview] = useState<RegenerationPreview | null>(null);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['intelligence-runs', reportId],
    queryFn: () =>
      apiJson<{ runs: readonly RunListItem[] }>(
        `/api/intelligence/reports/${encodeURIComponent(reportId)}/runs`,
      ),
  });
  const selectedId = runId ?? data?.runs[0]?.id ?? null;
  const { data: selectedRun, isError: isRunError } = useQuery({
    queryKey: ['intelligence-run', reportId, selectedId],
    queryFn: () =>
      apiJson<{ run: RunDetail }>(
        `/api/intelligence/reports/${encodeURIComponent(reportId)}/runs/${encodeURIComponent(selectedId ?? '')}`,
      ),
    enabled: selectedId !== null,
  });
  const regenerateMutation = useMutation({
    mutationFn: () =>
      apiJson<RegenerationPreview>(
        `/api/intelligence/reports/${encodeURIComponent(reportId)}/runs/${encodeURIComponent(selectedId ?? '')}/regenerate`,
        { method: 'POST' },
      ),
    onSuccess: (regenerationPreview) => {
      setPreview(regenerationPreview);
      void queryClient.invalidateQueries({ queryKey: ['intelligence-run', reportId, selectedId] });
    },
    onError: (regenerateError: Error) =>
      toast.error(t('toast.error'), { description: regenerateError.message }),
  });
  const saveMutation = useMutation({
    mutationFn: (previewId: string) =>
      apiJson(
        `/api/intelligence/reports/${encodeURIComponent(reportId)}/runs/${encodeURIComponent(selectedId ?? '')}/save-regeneration`,
        { method: 'POST', body: JSON.stringify({ previewId }) },
      ),
    onSuccess: () => {
      setPreview(null);
      void queryClient.invalidateQueries({ queryKey: ['intelligence-runs', reportId] });
      void queryClient.invalidateQueries({ queryKey: ['intelligence-run', reportId, selectedId] });
      toast.success(t('reports.regenerationSaved'));
    },
    onError: (saveError: Error) =>
      toast.error(t('toast.error'), { description: saveError.message }),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t('reports.loading')}</p>;
  }
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : t('toast.error')}
      </p>
    );
  }

  const runs = data?.runs ?? [];
  if (runs.length === 0) {
    const command = formatGenerateCommand(configPath, reportId);
    return (
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm text-muted-foreground">{t('reports.historyEmpty')}</p>
        <code className="block overflow-x-auto rounded bg-muted p-3 text-xs">{command}</code>
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm hover:bg-accent"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              toast.success(t('reports.generateCommandCopied'));
            } catch {
              toast.error(t('toast.error'));
            }
          }}
        >
          {t('reports.copyGenerateCommand')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isRunError ? <p className="text-sm text-destructive">{t('toast.error')}</p> : null}
      {selectedRun ? (
        <article className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{selectedRun.run.subject}</h3>
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm"
              onClick={() => setReportsSection(reportId, 'chat', selectedRun.run.id)}
            >
              {t('reports.continueInChat')}
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={regenerateMutation.isPending}
              onClick={() => regenerateMutation.mutate()}
            >
              {t('reports.regenerate')}
            </button>
          </div>
          <div className="space-y-3 text-sm [&_.report-dashboard]:space-y-4 [&_.report-evidence]:text-muted-foreground [&_.report-finding-attention]:border-l-destructive [&_.report-finding-positive]:border-l-emerald-600 [&_.report-finding]:space-y-1 [&_.report-finding]:border-l-4 [&_.report-finding]:pl-3 [&_.report-findings]:space-y-4 [&_.report-metric-delta]:text-muted-foreground [&_.report-metric-label]:text-muted-foreground [&_.report-metric-value]:text-lg [&_.report-metric-value]:font-semibold [&_.report-metric]:rounded-md [&_.report-metric]:border [&_.report-metric]:p-3 [&_.report-metrics]:grid [&_.report-metrics]:gap-2 [&_.report-metrics]:sm:grid-cols-3 [&_.report-note]:text-muted-foreground [&_.report-table]:w-full [&_.report-table_td]:border-b [&_.report-table_td]:p-2 [&_.report-table_th]:border-b [&_.report-table_th]:p-2 [&_.report-table_th]:text-left [&_a]:text-primary [&_a]:underline [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
            <ReportHtml html={selectedRun.run.html} />
          </div>
          {selectedRun.run.charts.length > 0 ? (
            <div className="grid gap-3">
              {selectedRun.run.charts.map((chart) => (
                <img
                  key={chart.name}
                  className="w-full rounded border border-border"
                  src={chart.dataUrl}
                  alt={t(`reports.chart.${chart.name}`)}
                />
              ))}
            </div>
          ) : null}
        </article>
      ) : null}
      {preview ? (
        <article className="space-y-3 rounded-lg border border-primary p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t('reports.regenerationPreview')}</h3>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded border px-3 py-1.5 text-sm"
                onClick={() => setPreview(null)}
              >
                {t('reports.cancel')}
              </button>
              <button
                type="button"
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate(preview.previewId)}
              >
                {t('reports.save')}
              </button>
            </div>
          </div>
          <h4 className="font-semibold">{preview.run.subject}</h4>
          <div className="space-y-3 text-sm [&_a]:text-primary [&_a]:underline">
            <ReportHtml html={preview.run.html} />
          </div>
        </article>
      ) : null}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t('reports.sectionHistory')}</h3>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className={`flex w-full flex-col items-start gap-1 px-3 py-2 text-left text-sm hover:bg-accent ${
                  selectedId === run.id ? 'bg-accent' : ''
                }`}
                onClick={() => setReportsSection(reportId, 'run', run.id)}
              >
                <span className="font-medium">{run.subject}</span>
                <span className="text-muted-foreground">
                  {run.periodStart} – {run.periodEnd}
                </span>
                {run.hasChat ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {t('reports.historyChat')}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ReportsMemorySection({ reportId }: { readonly reportId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const endpoint = `/api/intelligence/reports/${encodeURIComponent(reportId)}/memory`;
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['intelligence-memory', reportId],
    queryFn: () => apiJson<MemoryResponse>(endpoint),
  });
  const [editor, setEditor] = useState<MemoryEditorState>({
    markdown: '',
    originUpdatedAt: null,
    dirty: false,
  });

  if (data && data.updatedAt !== editor.originUpdatedAt && !editor.dirty) {
    setEditor({
      markdown: data.markdown,
      originUpdatedAt: data.updatedAt,
      dirty: false,
    });
  }

  const saveMutation = useMutation({
    mutationFn: (markdown: string) =>
      apiJson<MemoryResponse>(endpoint, {
        method: 'PUT',
        body: JSON.stringify({ markdown }),
      }),
    onSuccess: (saved) => {
      toast.success(t('reports.memorySaved'));
      setEditor({
        markdown: saved.markdown,
        originUpdatedAt: saved.updatedAt,
        dirty: false,
      });
      void queryClient.invalidateQueries({ queryKey: ['intelligence-memory', reportId] });
    },
    onError: (saveError: Error) => {
      toast.error(t('toast.error'), { description: saveError.message, duration: Infinity });
    },
  });

  if (isLoading && editor.originUpdatedAt === null) {
    return <p className="text-sm text-muted-foreground">{t('reports.loading')}</p>;
  }
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : t('toast.error')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('reports.memoryExplanation')}</p>
      <textarea
        aria-label={t('reports.sectionMemory')}
        className="min-h-80 w-full rounded border border-border bg-background p-3 font-mono text-sm"
        value={editor.markdown}
        onChange={(event) =>
          setEditor((prev) => ({ ...prev, markdown: event.target.value, dirty: true }))
        }
        spellCheck={false}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {data ? t('reports.memoryUpdated', { at: data.updatedAt, by: data.updatedBy }) : null}
        </p>
        <button
          type="button"
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={!editor.dirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate(editor.markdown)}
        >
          {t('reports.memorySave')}
        </button>
      </div>
    </div>
  );
}

function formatReportName(
  report: Pick<ReportListItem, 'id' | 'name'>,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  return t(`reports.name.${report.id}`, { defaultValue: report.name });
}

function formatSchedule(
  schedule: ReportSchedule,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (schedule.kind) {
    case 'daily':
      return t('reports.scheduleDaily', { time: schedule.time });
    case 'weekly':
      return t('reports.scheduleWeekly', {
        weekday: t(`reports.weekday.${schedule.weekday}`),
        time: schedule.time,
      });
    case 'monthly':
      return t('reports.scheduleMonthly', {
        day: schedule.day === 'last' ? t('reports.scheduleLastDay') : schedule.day,
        time: schedule.time,
      });
    case 'manual':
      return t('reports.scheduleManual');
  }
}
