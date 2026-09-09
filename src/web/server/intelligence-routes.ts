import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { backupDatabase } from '../../db/database-health.js';
import {
  getIntelligenceMemory,
  getIntelligenceRun,
  getIntelligenceRunChart,
  intelligenceMemorySeed,
  listIntelligenceRunChartNames,
  listIntelligenceRunModelCalls,
  listIntelligenceRuns,
  saveIntelligenceMemory,
} from '../../db/intelligence.js';
import {
  clearIntelligenceChat,
  getIntelligenceChat,
  listIntelligenceChatRunIds,
} from '../../db/intelligence-chat.js';
import { formatSqliteUserMessage, isSqliteQueryError } from '../../db/sqlite-query.js';
import {
  createReportChatResponse,
  getReportChatBootstrap,
  ReportChatInputError,
} from '../../intelligence/chat.js';
import {
  previewReportRegeneration,
  ReportMemoryConflictError,
  ReportRegenerationConflictError,
  type ReportRegenerationPreview,
  saveReportRegeneration,
} from '../../intelligence/report-runner.js';
import { buildReportBriefing, resolveReportQueryScope } from '../../intelligence/report-scope.js';
import { resolveReportTaxonomyPolicy } from '../../intelligence/report-taxonomy-policy.js';
import {
  executeScopedIntelligenceTool,
  IntelligenceToolError,
  isIntelligenceToolName,
} from '../../intelligence/tools.js';
import type { WebServerContext } from './context.js';
import { parseValidatedJsonBody } from './validate-body.js';

export function registerIntelligenceRoutes(app: Hono, ctx: WebServerContext): void {
  const regenerationPreviews = new Map<
    string,
    { readonly expiresAt: number; readonly preview: ReportRegenerationPreview }
  >();
  app.get('/api/intelligence/reports', (c) => {
    return c.json({
      configPath: ctx.resolved.configPath,
      reports: ctx.resolved.config.reports.map((report) => {
        const lastRun = listIntelligenceRuns(ctx.db, report.id, 1)[0];
        return {
          id: report.id,
          name: report.name,
          schedule: report.schedule,
          lastRun: lastRun ? presentRunSummary(lastRun) : null,
        };
      }),
    });
  });

  app.get('/api/intelligence/reports/:reportId/memory', (c) => {
    const reportId = requireReportId(ctx, c.req.param('reportId'));
    const language = ctx.resolved.config.reports.find((report) => report.id === reportId)?.language;
    return c.json(
      getIntelligenceMemory(ctx.db, reportId, intelligenceMemorySeed(language ?? 'en-US')),
    );
  });

  app.put('/api/intelligence/reports/:reportId/memory', async (c) => {
    const reportId = requireReportId(ctx, c.req.param('reportId'));
    const body = await parseValidatedJsonBody<{ markdown: string }>(c, 'saveIntelligenceMemory');
    try {
      return c.json(saveIntelligenceMemory(ctx.db, reportId, body.markdown, 'user'));
    } catch (error) {
      const message = isSqliteQueryError(error)
        ? formatSqliteUserMessage(error)
        : error instanceof Error
          ? error.message
          : 'Failed to save memory';
      return c.json({ error: message }, 400);
    }
  });

  app.get('/api/intelligence/reports/:reportId/runs', (c) => {
    const reportId = requireReportId(ctx, c.req.param('reportId'));
    const chatRunIds = listIntelligenceChatRunIds(ctx.db, reportId);
    const runs = listIntelligenceRuns(ctx.db, reportId).map((run) => ({
      ...presentRunSummary(run),
      hasChat: chatRunIds.has(run.id),
    }));
    return c.json({ runs });
  });

  app.get('/api/intelligence/reports/:reportId/runs/:runId', (c) => {
    const reportId = requireReportId(ctx, c.req.param('reportId'));
    const run = getIntelligenceRun(ctx.db, reportId, c.req.param('runId'));
    if (!run) {
      throw new HTTPException(404, { message: 'Report not found' });
    }
    const chartNames = listIntelligenceRunChartNames(ctx.db, run.id);
    const modelCalls = listIntelligenceRunModelCalls(ctx.db, run.id);
    return c.json({
      run: {
        id: run.id,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        createdAt: run.createdAt,
        subject: run.subject,
        alertCount: run.alertCount,
        markdown: run.markdown,
        html: run.html,
        chartNames,
        charts: chartNames.flatMap((name) => {
          const chart = getIntelligenceRunChart(ctx.db, run.id, name);
          return chart && isPresentableReportChart(chart)
            ? [
                {
                  name: chart.name,
                  mimeType: chart.mimeType,
                  dataUrl: `data:${chart.mimeType};base64,${Buffer.from(chart.bytes).toString('base64')}`,
                },
              ]
            : [];
        }),
        citedTransactionIds: parseCitedIds(run.citedTransactionIdsJson),
        usage: {
          provider: run.modelProvider,
          model: run.modelName,
          callCount: run.modelCallCount,
          stepCount: run.modelStepCount,
          inputTokens: run.inputTokens,
          cachedInputTokens: run.cachedInputTokens,
          outputTokens: run.outputTokens,
          reasoningTokens: run.reasoningTokens,
          totalTokens: run.totalTokens,
          durationMs: run.modelDurationMs,
          unpricedCallCount: run.unpricedModelCallCount,
          estimatedCostMicrousd: run.estimatedCostMicrousd,
        },
        modelCalls,
      },
    });
  });

  app.post('/api/intelligence/reports/:reportId/runs/:runId/regenerate', async (c) => {
    const reportId = requireReportId(ctx, c.req.param('reportId'));
    const run = getIntelligenceRun(ctx.db, reportId, c.req.param('runId'));
    if (!run) {
      throw new HTTPException(404, { message: 'Report not found' });
    }
    const preview = await previewReportRegeneration({
      db: ctx.db,
      resolved: ctx.resolved,
      reportId,
      run,
    });
    discardExpiredRegenerationPreviews(regenerationPreviews);
    const previewId = randomUUID();
    regenerationPreviews.set(previewId, {
      expiresAt: Date.now() + 15 * 60_000,
      preview,
    });
    return c.json({
      previewId,
      run: presentRegenerationPreview(run, preview),
    });
  });

  app.post('/api/intelligence/reports/:reportId/runs/:runId/save-regeneration', async (c) => {
    const reportId = requireReportId(ctx, c.req.param('reportId'));
    const body = await parseValidatedJsonBody<{ previewId: string }>(c, 'saveReportRegeneration');
    const cached = regenerationPreviews.get(body.previewId);
    regenerationPreviews.delete(body.previewId);
    if (
      !cached ||
      cached.expiresAt < Date.now() ||
      cached.preview.reportId !== reportId ||
      cached.preview.runId !== c.req.param('runId')
    ) {
      throw new HTTPException(409, {
        message: 'Regeneration preview expired. Regenerate the report again.',
      });
    }
    backupBeforeReportReplacement(ctx);
    try {
      const run = saveReportRegeneration(ctx.db, cached.preview);
      return c.json({ run: presentRunSummary(run) });
    } catch (error) {
      if (
        error instanceof ReportMemoryConflictError ||
        error instanceof ReportRegenerationConflictError
      ) {
        throw new HTTPException(409, { message: error.message });
      }
      throw error;
    }
  });

  app.get('/api/intelligence/reports/:reportId/chat', async (c) => {
    const reportId = requireReportId(ctx, c.req.param('reportId'));
    const seedRunId = parseSeedRunId(c.req.query('runId'));
    try {
      return c.json(await getReportChatBootstrap(ctx.db, reportId, seedRunId));
    } catch (error) {
      throwChatHttpException(error);
    }
  });

  app.post('/api/intelligence/reports/:reportId/chat', async (c) => {
    const reportId = requireReportId(ctx, c.req.param('reportId'));
    const body = await parseBoundedChatBody(c.req.raw);
    const seedRunId = parseSeedRunId(body['runId']);
    try {
      return await createReportChatResponse({
        db: ctx.db,
        resolved: ctx.resolved,
        reportId,
        seedRunId,
        requestChatId: body['id'],
        rawMessages: body['messages'],
      });
    } catch (error) {
      throwChatHttpException(error);
    }
  });

  app.delete('/api/intelligence/reports/:reportId/chat', (c) => {
    const reportId = requireReportId(ctx, c.req.param('reportId'));
    const seedRunId = parseSeedRunId(c.req.query('runId'));
    const chat = getIntelligenceChat(ctx.db, reportId, seedRunId);
    if (!chat) {
      return c.json({ cleared: false });
    }
    const databasePath = ctx.resolved.config.storage.databasePath;
    if (databasePath !== ':memory:') {
      const stamp = new Date()
        .toISOString()
        .replaceAll(/[-:.TZ]/gu, '')
        .slice(0, 17);
      backupDatabase(
        ctx.db,
        `${databasePath}.${stamp}-${process.pid}-${randomUUID()}-before-clear-report-chat.sqlite`,
      );
    }
    if (!clearIntelligenceChat(ctx.db, reportId, seedRunId)) {
      throw new HTTPException(409, { message: 'Chat generation is still running' });
    }
    return c.json({ cleared: true });
  });

  app.post('/api/intelligence/tools/:name', async (c) => {
    const name = c.req.param('name');
    if (!isIntelligenceToolName(name)) {
      throw new HTTPException(404, { message: 'Intelligence tool not found' });
    }
    const body = await parseValidatedJsonBody<{
      readonly reportId: string;
      readonly args?: Readonly<Record<string, unknown>> | undefined;
    }>(c, 'executeIntelligenceTool');
    try {
      const scope = resolveReportQueryScope(ctx.resolved, body.reportId);
      const policy = await resolveReportTaxonomyPolicy({ db: ctx.db, scope, persist: true });
      const briefing = buildReportBriefing(ctx.db, ctx.resolved, scope, policy);
      return c.json({
        reportId: body.reportId,
        period: scope.period,
        result: executeScopedIntelligenceTool(
          { db: ctx.db, resolved: ctx.resolved, scope, briefing },
          name,
          body.args,
        ),
      });
    } catch (error) {
      if (error instanceof IntelligenceToolError) {
        throw new HTTPException(error.message === 'Report not found' ? 404 : 400, {
          message: error.message,
        });
      }
      throw error;
    }
  });
}

function discardExpiredRegenerationPreviews(
  previews: Map<
    string,
    { readonly expiresAt: number; readonly preview: ReportRegenerationPreview }
  >,
): void {
  const now = Date.now();
  for (const [id, preview] of previews) {
    if (preview.expiresAt < now) {
      previews.delete(id);
    }
  }
}

function presentRegenerationPreview(
  run: { readonly id: string; readonly createdAt: string },
  preview: ReportRegenerationPreview,
) {
  return {
    id: run.id,
    periodStart: preview.period.start,
    periodEnd: preview.period.end,
    createdAt: run.createdAt,
    subject: preview.subject,
    alertCount: preview.alertCount,
    markdown: preview.markdown,
    html: preview.html,
    chartNames: preview.charts.map((chart) => chart.name),
    charts: preview.charts.flatMap((chart) =>
      isPresentableReportChart(chart)
        ? [
            {
              name: chart.name,
              mimeType: chart.mimeType,
              dataUrl: `data:${chart.mimeType};base64,${Buffer.from(chart.bytes).toString('base64')}`,
            },
          ]
        : [],
    ),
    citedTransactionIds: preview.citedTransactionIds,
    usage: {
      provider: preview.model.provider,
      model: preview.model.model,
      callCount: preview.usage.callCount,
      stepCount: preview.usage.stepCount,
      inputTokens: preview.usage.inputTokens,
      cachedInputTokens: preview.usage.cachedInputTokens,
      outputTokens: preview.usage.outputTokens,
      reasoningTokens: preview.usage.reasoningTokens,
      totalTokens: preview.usage.totalTokens,
      durationMs: preview.usage.durationMs,
      unpricedCallCount: preview.usage.unpricedCallCount,
      estimatedCostMicrousd: preview.usage.estimatedCostMicrousd,
    },
    modelCalls: preview.modelCalls,
  };
}

function backupBeforeReportReplacement(ctx: WebServerContext): void {
  const databasePath = ctx.resolved.config.storage.databasePath;
  if (databasePath === ':memory:') {
    return;
  }
  const stamp = new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/gu, '')
    .slice(0, 17);
  backupDatabase(
    ctx.db,
    `${databasePath}.${stamp}-${process.pid}-${randomUUID()}-before-replace-report.sqlite`,
  );
}

function isPresentableReportChart(chart: {
  readonly name: string;
  readonly mimeType: string;
}): boolean {
  return (
    chart.mimeType === 'image/png' &&
    (chart.name === 'balance' ||
      chart.name === 'allocation' ||
      chart.name === 'cashflow' ||
      chart.name === 'categories' ||
      chart.name === 'labels')
  );
}

function requireReportId(ctx: WebServerContext, reportId: string): string {
  if (!ctx.resolved.config.reports.some((report) => report.id === reportId)) {
    throw new HTTPException(404, { message: 'Report not found' });
  }
  return reportId;
}

function presentRunSummary(run: {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly createdAt: string;
  readonly subject: string;
  readonly alertCount: number;
}) {
  return {
    id: run.id,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    createdAt: run.createdAt,
    subject: run.subject,
    alertCount: run.alertCount,
  };
}

function parseCitedIds(raw: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

function parseSeedRunId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || value.length > 200) {
    throw new HTTPException(400, { message: 'Invalid report run id' });
  }
  return value;
}

async function parseBoundedChatBody(request: Request): Promise<Readonly<Record<string, unknown>>> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 1_000_000) {
    throw new HTTPException(413, { message: 'Chat request is too large' });
  }
  const text = await request.text();
  if (text.length > 1_000_000) {
    throw new HTTPException(413, { message: 'Chat request is too large' });
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Readonly<Record<string, unknown>>;
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' });
  }
}

function throwChatHttpException(error: unknown): never {
  if (error instanceof ReportChatInputError) {
    throw new HTTPException(error.status, { message: error.message });
  }
  throw error;
}
