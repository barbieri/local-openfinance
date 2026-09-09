import type { DatabaseSync } from 'node:sqlite';
import { stripVTControlCharacters } from 'node:util';
import {
  claimIntelligenceRunEmailDelivery,
  deleteIntelligenceRunCharts,
  deleteIntelligenceRunModelCalls,
  getIntelligenceRunByDueKey,
  getIntelligenceRunChart,
  type IntelligenceRunRecord,
  insertIntelligenceRun,
  intelligenceMemorySeed,
  markIntelligenceRunEmailSent,
  readIntelligenceMemory,
  releaseIntelligenceRunEmailDelivery,
  replaceIntelligenceRun,
  saveIntelligenceMemory,
  saveIntelligenceRunChart,
  saveIntelligenceRunModelCall,
} from '../db/intelligence.js';
import type { ResolvedConfig, ResolvedReportConfig } from '../types.js';
import {
  type IntelligenceChart,
  loadIntelligenceChartLabels,
  renderReportAnalysisCharts,
  reportChartAltText,
} from './charts.js';
import type { ReportEmailContent, ReportEmailDelivery } from './email.js';
import { deliverReportEmail } from './email.js';
import type { LocalDatePeriod } from './period.js';
import {
  type GeneratedReport,
  type GenerateReportWithAgent,
  generateReportWithAgent,
  maximumReportProviderCalls,
} from './report-agent.js';
import { resolveReportDateStyle } from './report-date-format.js';
import {
  ensureVisibleReportBody,
  reportHtmlToText,
  sanitizeReportBodyHtml,
} from './report-document.js';
import { compileReportInstructions } from './report-instructions.js';
import {
  buildReportBriefing,
  loadReportTransactionChartDataset,
  type ReportBriefing,
  type ReportQueryScope,
  resolveReportQueryScope,
} from './report-scope.js';
import { resolveReportTaxonomyPolicyWithUsage } from './report-taxonomy-policy.js';
import {
  aggregateReportUsage,
  estimateLanguageCostMicrousd,
  type ReportModelCall,
  type ReportUsageMetrics,
} from './usage.js';

export {
  type GeneratedReport,
  type GenerateReportWithAgent,
  generateReportWithAgent,
} from './report-agent.js';

export type DeliverReport = (
  input: Parameters<typeof deliverReportEmail>[0],
) => Promise<ReportEmailDelivery>;

export type ExecuteReportInput = {
  readonly db: DatabaseSync;
  readonly resolved: ResolvedConfig;
  readonly reportId: string;
  readonly period?: LocalDatePeriod | undefined;
  readonly now?: Date | undefined;
  readonly timeZone?: string | undefined;
  readonly triggerKind: 'manual' | 'due';
  readonly dueKey?: string | null | undefined;
  readonly send: boolean;
  readonly dryRun: boolean;
};

export type ExecutedReport = {
  readonly reportId: string;
  readonly period: LocalDatePeriod;
  readonly subject: string;
  readonly alertCount: number;
  readonly markdown: string;
  readonly html: string;
  readonly memoryBefore: string;
  readonly memoryAfter: string;
  readonly charts: readonly IntelligenceChart[];
  readonly run: IntelligenceRunRecord | null;
  readonly emailSent: boolean;
  readonly usage: ReportUsageMetrics;
  readonly generated: GeneratedReportData | null;
};

export class DueReportAlreadyRunError extends Error {}

export class ReportMemoryConflictError extends Error {}

export class ReportRegenerationConflictError extends Error {}

export type ReportRegenerationPreview = {
  readonly reportId: string;
  readonly runId: string;
  readonly runVersion: number;
  readonly period: LocalDatePeriod;
  readonly subject: string;
  readonly alertCount: number;
  readonly markdown: string;
  readonly html: string;
  readonly memoryBefore: string;
  readonly memoryAfter: string;
  readonly memorySeed: string;
  readonly charts: readonly IntelligenceChart[];
  readonly briefing: ReportBriefing;
  readonly citedTransactionIds: readonly string[];
  readonly usage: ReportUsageMetrics;
  readonly modelCalls: readonly ReportModelCall[];
  readonly model: ResolvedReportConfig['model'];
};

export type GeneratedReportData = {
  readonly briefing: ReportBriefing;
  readonly citedTransactionIds: readonly string[];
  readonly modelCalls: readonly ReportModelCall[];
  readonly model: ResolvedReportConfig['model'];
  readonly memorySeed: string;
};

export async function executeReport(
  input: ExecuteReportInput,
  generateReport: GenerateReportWithAgent = generateReportWithAgent,
  deliverEmail: DeliverReport = deliverReportEmail,
): Promise<ExecutedReport> {
  const scope = resolveReportQueryScope(input.resolved, input.reportId, input);
  if (input.triggerKind === 'due' && !input.dueKey) {
    throw new Error('A due report run requires a due key.');
  }
  const existingRun = input.dueKey
    ? getIntelligenceRunByDueKey(input.db, scope.report.id, input.dueKey)
    : null;
  if (existingRun) {
    return retryDueDelivery(input, scope, existingRun, deliverEmail);
  }

  const memorySeed = intelligenceMemorySeed(scope.report.language);
  const memoryBefore = readIntelligenceMemory(input.db, scope.report.id, memorySeed).markdown;
  const [instructions, policyResolution] = await Promise.all([
    compileReportInstructions(scope.report),
    resolveReportTaxonomyPolicyWithUsage({
      db: input.db,
      scope,
      persist: !input.dryRun,
    }),
  ]);
  const policy = policyResolution.policy;
  const briefing = buildReportBriefing(input.db, input.resolved, scope, policy);
  const generatedOutput = await generateReport({
    db: input.db,
    resolved: input.resolved,
    scope,
    instructions,
    memoryBefore,
    briefing,
  });
  const generated: GeneratedReport = {
    ...generatedOutput,
    subject: sanitizeReportSubject(generatedOutput.subject),
  };
  const taxonomyCalls: readonly ReportModelCall[] =
    policyResolution.generation.calls === 0
      ? []
      : [
          {
            provider: scope.report.model.provider,
            model: scope.report.model.model,
            phase: 'taxonomy-policy',
            reviewRound: null,
            stepNumber: null,
            usage: policyResolution.generation.usage,
            durationMs: policyResolution.generation.durationMs ?? null,
            reasoningEffort: scope.report.model.reasoningEffort,
            maxOutputTokens: scope.report.model.maxOutputTokens,
            toolNames: [],
            providerMetadata: policyResolution.generation.providerMetadata,
          },
        ];
  const modelCalls = [...taxonomyCalls, ...generated.modelCalls];
  const providerCallLimit = maximumReportProviderCalls(scope.report.agentBudget);
  if (modelCalls.length > providerCallLimit) {
    throw new Error(
      `Report ${scope.report.id} exceeded its ${providerCallLimit}-call provider budget.`,
    );
  }
  const usage = aggregateReportUsage(modelCalls, scope.report.model.pricing);
  const sanitizedHtml = ensureVisibleReportBody(
    sanitizeReportBodyHtml(generated.html, input.resolved.config.web.publicBaseUrl),
    scope.report.language,
  );
  const markdown = reportHtmlToText(sanitizedHtml);
  assertSemanticReportPermalinks(sanitizedHtml);
  const html = qualifyReportPermalinks(sanitizedHtml, input.resolved.config.web.publicBaseUrl);
  const charts = renderCharts(input.db, scope, briefing);
  const citedTransactionIds = collectCitedTransactionIds(html);
  const alertCount = briefing.analysis.mustReport.length;
  const run = input.dryRun
    ? null
    : persistReport(
        input,
        scope,
        generated,
        markdown,
        html,
        charts,
        briefing,
        alertCount,
        citedTransactionIds,
        memoryBefore,
        memorySeed,
        usage,
        modelCalls,
      );

  const shouldSend = input.send && reportSendPolicyAllows(scope.report, alertCount);
  const emailContent: ReportEmailContent = {
    reportName: scope.report.name,
    subject: generated.subject,
    period: scope.period,
    dateStyle: resolveReportDateStyle(scope.report.window.kind),
    language: scope.report.language,
    html,
    text: markdown,
    charts,
  };
  let deliveredRun = run;
  let email: ReportEmailDelivery | null = null;
  if (shouldSend) {
    if (input.dryRun) {
      email = await deliverEmail({
        smtp: input.resolved.config.notify.smtp,
        dryRun: true,
        content: emailContent,
      });
    } else if (run) {
      const delivered = await deliverPersistedReport(input, run, emailContent, deliverEmail);
      deliveredRun = delivered.run;
      email = delivered.email;
    }
  }

  return {
    reportId: scope.report.id,
    period: scope.period,
    subject: generated.subject,
    alertCount,
    markdown,
    html,
    memoryBefore,
    memoryAfter: generated.memoryAfter,
    charts,
    run: deliveredRun,
    emailSent: email?.sent ?? false,
    usage,
    generated: { briefing, citedTransactionIds, modelCalls, model: scope.report.model, memorySeed },
  };
}

export async function previewReportRegeneration(
  input: Omit<ExecuteReportInput, 'period' | 'triggerKind' | 'send' | 'dryRun'> & {
    readonly run: IntelligenceRunRecord;
  },
  generateReport: GenerateReportWithAgent = generateReportWithAgent,
): Promise<ReportRegenerationPreview> {
  const executed = await executeReport(
    {
      ...input,
      reportId: input.run.reportId,
      period: { start: input.run.periodStart, end: input.run.periodEnd },
      triggerKind: 'manual',
      send: false,
      dryRun: true,
    },
    generateReport,
  );
  if (!executed.generated) {
    throw new Error('Regeneration preview did not produce report generation data.');
  }
  return {
    reportId: input.run.reportId,
    runId: input.run.id,
    runVersion: input.run.version,
    period: executed.period,
    subject: executed.subject,
    alertCount: executed.alertCount,
    markdown: executed.markdown,
    html: executed.html,
    memoryBefore: executed.memoryBefore,
    memoryAfter: executed.memoryAfter,
    charts: executed.charts,
    memorySeed: executed.generated.memorySeed,
    briefing: executed.generated.briefing,
    citedTransactionIds: executed.generated.citedTransactionIds,
    usage: executed.usage,
    modelCalls: executed.generated.modelCalls,
    model: executed.generated.model,
  };
}

export function saveReportRegeneration(
  db: DatabaseSync,
  preview: ReportRegenerationPreview,
): IntelligenceRunRecord {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (
      readIntelligenceMemory(db, preview.reportId, preview.memorySeed).markdown !==
      preview.memoryBefore
    ) {
      throw new ReportMemoryConflictError(
        `Report ${preview.reportId} memory changed after regeneration preview.`,
      );
    }
    const run = replaceIntelligenceRun(db, {
      id: preview.runId,
      expectedVersion: preview.runVersion,
      reportId: preview.reportId,
      periodStart: preview.period.start,
      periodEnd: preview.period.end,
      subject: preview.subject,
      alertCount: preview.alertCount,
      briefingJson: JSON.stringify(preview.briefing),
      markdown: preview.markdown,
      html: preview.html,
      memoryBefore: preview.memoryBefore,
      memoryAfter: preview.memoryAfter,
      citedTransactionIdsJson: JSON.stringify(preview.citedTransactionIds),
      modelProvider: preview.model.provider,
      modelName: preview.model.model,
      modelCallCount: preview.usage.callCount,
      modelStepCount: preview.usage.stepCount,
      inputTokens: preview.usage.inputTokens,
      cachedInputTokens: preview.usage.cachedInputTokens,
      outputTokens: preview.usage.outputTokens,
      reasoningTokens: preview.usage.reasoningTokens,
      totalTokens: preview.usage.totalTokens,
      modelDurationMs: preview.usage.durationMs,
      unpricedModelCallCount: preview.usage.unpricedCallCount,
      estimatedCostMicrousd: preview.usage.estimatedCostMicrousd,
    });
    if (!run) {
      throw new ReportRegenerationConflictError(
        'The stored report changed after regeneration preview.',
      );
    }
    deleteIntelligenceRunModelCalls(db, run.id);
    deleteIntelligenceRunCharts(db, run.id);
    saveReportModelCalls(db, run.id, preview.modelCalls, preview.model.pricing);
    saveReportCharts(db, run.id, preview.charts);
    db.exec('COMMIT');
    return run;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function sanitizeReportSubject(subject: string): string {
  let printable = '';
  for (const character of stripVTControlCharacters(subject)) {
    const codePoint = character.codePointAt(0) ?? 0;
    printable += codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? ' ' : character;
  }
  return printable.replaceAll(/\s+/gu, ' ').trim() || 'Report';
}
function renderCharts(
  db: DatabaseSync,
  scope: ReportQueryScope,
  briefing: ReportBriefing,
): readonly IntelligenceChart[] {
  const analysis = briefing.analysis;
  const chartStart = analysis.chart[0]?.start ?? scope.period.start;
  const dataset = loadReportTransactionChartDataset(db, {
    ...scope,
    period: { start: chartStart, end: scope.period.end },
  });
  return renderReportAnalysisCharts(
    dataset,
    analysis,
    loadIntelligenceChartLabels(db, analysis.language),
  );
}

function persistReport(
  input: ExecuteReportInput,
  scope: ReportQueryScope,
  generated: GeneratedReport,
  markdown: string,
  html: string,
  charts: readonly IntelligenceChart[],
  briefing: ReportBriefing,
  alertCount: number,
  citedTransactionIds: readonly string[],
  memoryBefore: string,
  memorySeed: string,
  usage: ReportUsageMetrics,
  modelCalls: readonly ReportModelCall[],
): IntelligenceRunRecord {
  input.db.exec('BEGIN IMMEDIATE');
  try {
    assertReportCanBePersisted(input, scope, memoryBefore, memorySeed);
    const run = insertIntelligenceRun(input.db, {
      reportId: scope.report.id,
      periodStart: scope.period.start,
      periodEnd: scope.period.end,
      subject: generated.subject,
      alertCount,
      briefingJson: JSON.stringify(briefing),
      markdown,
      html,
      memoryBefore,
      memoryAfter: generated.memoryAfter,
      citedTransactionIdsJson: JSON.stringify(citedTransactionIds),
      triggerKind: input.triggerKind,
      dueKey: input.dueKey,
      modelProvider: scope.report.model.provider,
      modelName: scope.report.model.model,
      modelCallCount: usage.callCount,
      modelStepCount: usage.stepCount,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens,
      modelDurationMs: usage.durationMs,
      unpricedModelCallCount: usage.unpricedCallCount,
      estimatedCostMicrousd: usage.estimatedCostMicrousd,
    });
    saveReportModelCalls(input.db, run.id, modelCalls, scope.report.model.pricing);
    saveReportCharts(input.db, run.id, charts);
    saveIntelligenceMemory(input.db, scope.report.id, generated.memoryAfter, 'report-agent');
    input.db.exec('COMMIT');
    return run;
  } catch (error) {
    input.db.exec('ROLLBACK');
    throw error;
  }
}

function assertReportCanBePersisted(
  input: ExecuteReportInput,
  scope: ReportQueryScope,
  memoryBefore: string,
  memorySeed: string,
): void {
  if (input.dueKey && getIntelligenceRunByDueKey(input.db, scope.report.id, input.dueKey)) {
    throw new DueReportAlreadyRunError(
      `Report ${scope.report.id} already ran for ${input.dueKey}.`,
    );
  }
  if (readIntelligenceMemory(input.db, scope.report.id, memorySeed).markdown !== memoryBefore) {
    throw new ReportMemoryConflictError(
      `Report ${scope.report.id} memory changed while generation was in progress.`,
    );
  }
}

function saveReportModelCalls(
  db: DatabaseSync,
  runId: string,
  modelCalls: readonly ReportModelCall[],
  pricing: ResolvedReportConfig['model']['pricing'],
): void {
  for (const [ordinal, call] of modelCalls.entries()) {
    saveIntelligenceRunModelCall(db, {
      runId,
      ordinal,
      provider: call.provider,
      model: call.model,
      phase: call.phase,
      reviewRound: call.reviewRound,
      stepNumber: call.stepNumber,
      inputTokens: call.usage?.inputTokens ?? null,
      cachedInputTokens: call.usage?.cachedInputTokens ?? null,
      outputTokens: call.usage?.outputTokens ?? null,
      reasoningTokens: call.usage?.reasoningTokens ?? null,
      totalTokens: call.usage?.totalTokens ?? null,
      reasoningEffort: call.reasoningEffort ?? null,
      maxOutputTokens: call.maxOutputTokens ?? null,
      durationMs: call.durationMs,
      rawUsageJson: call.usage?.raw === undefined ? null : JSON.stringify(call.usage.raw),
      providerMetadataJson:
        call.providerMetadata === undefined ? null : JSON.stringify(call.providerMetadata),
      finishReason: call.finishReason ?? null,
      toolNamesJson: JSON.stringify(call.toolNames),
      pricingSnapshotJson: pricing ? JSON.stringify(pricing) : null,
      estimatedCostMicrousd: estimateLanguageCostMicrousd(call.usage, pricing),
    });
  }
}

function saveReportCharts(
  db: DatabaseSync,
  runId: string,
  charts: readonly IntelligenceChart[],
): void {
  for (const chart of charts) {
    saveIntelligenceRunChart(db, {
      runId,
      name: chart.name,
      mimeType: chart.mimeType,
      bytes: chart.bytes,
    });
  }
}

async function retryDueDelivery(
  input: ExecuteReportInput,
  scope: ReportQueryScope,
  run: IntelligenceRunRecord,
  deliverEmail: DeliverReport,
): Promise<ExecutedReport> {
  if (
    input.dryRun ||
    !input.send ||
    run.emailSentAt !== null ||
    !reportSendPolicyAllows(scope.report, run.alertCount)
  ) {
    throw new DueReportAlreadyRunError(
      `Report ${scope.report.id} already ran for ${input.dueKey}.`,
    );
  }
  const charts = loadStoredCharts(input.db, run.id, scope.report.language);
  const delivered = await deliverPersistedReport(
    input,
    run,
    {
      reportName: scope.report.name,
      subject: run.subject,
      period: { start: run.periodStart, end: run.periodEnd },
      dateStyle: resolveReportDateStyle(scope.report.window.kind),
      language: scope.report.language,
      html: run.html,
      text: run.markdown,
      charts,
    },
    deliverEmail,
  );
  return {
    reportId: run.reportId,
    period: { start: run.periodStart, end: run.periodEnd },
    subject: run.subject,
    alertCount: run.alertCount,
    markdown: run.markdown,
    html: run.html,
    memoryBefore: run.memoryBefore ?? '',
    memoryAfter: run.memoryAfter ?? '',
    charts,
    run: delivered.run,
    emailSent: delivered.email.sent,
    usage: usageFromStoredRun(run),
    generated: null,
  };
}

function usageFromStoredRun(run: IntelligenceRunRecord): ReportUsageMetrics {
  return {
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
  };
}

async function deliverPersistedReport(
  input: ExecuteReportInput,
  run: IntelligenceRunRecord,
  content: ReportEmailContent,
  deliverEmail: DeliverReport,
): Promise<{ readonly run: IntelligenceRunRecord; readonly email: ReportEmailDelivery }> {
  const claimToken = claimIntelligenceRunEmailDelivery(input.db, run.id);
  if (!claimToken) {
    throw new DueReportAlreadyRunError(`Report ${run.reportId} delivery is already in progress.`);
  }
  try {
    const email = await deliverEmail({
      smtp: input.resolved.config.notify.smtp,
      dryRun: false,
      content,
    });
    if (!email.sent) {
      releaseIntelligenceRunEmailDelivery(input.db, run.id, claimToken);
      return { run, email };
    }
    return {
      run: markIntelligenceRunEmailSent(input.db, run.id, claimToken),
      email,
    };
  } catch (error) {
    releaseIntelligenceRunEmailDelivery(input.db, run.id, claimToken);
    throw error;
  }
}

function loadStoredCharts(
  db: DatabaseSync,
  runId: string,
  language: string,
): readonly IntelligenceChart[] {
  return [
    requireStoredChart(db, runId, 'cashflow', language),
    requireStoredChart(db, runId, 'categories', language),
    requireStoredChart(db, runId, 'labels', language),
  ];
}

function requireStoredChart(
  db: DatabaseSync,
  runId: string,
  name: IntelligenceChart['name'],
  language: string,
): IntelligenceChart {
  const stored = getIntelligenceRunChart(db, runId, name);
  if (stored?.mimeType !== 'image/png') {
    throw new Error(`Stored ${name} chart is unavailable for report delivery.`);
  }
  return {
    name,
    filename: `report-${name}.png`,
    cid: `report-${name}@local-openfinance`,
    mimeType: 'image/png',
    bytes: stored.bytes,
    altText: reportChartAltText(name, language),
  };
}

function qualifyReportPermalinks(markdown: string, publicBaseUrl: string | undefined): string {
  if (!publicBaseUrl) {
    return markdown;
  }
  const base = publicBaseUrl.replace(/\/+$/u, '');
  return markdown.replaceAll(/(?<!\/)#\/transactions?\//gu, (match) => `${base}/${match}`);
}

function assertSemanticReportPermalinks(html: string): void {
  let insideAnchor = false;
  for (const token of html.split(/(<[^>]+>)/gu)) {
    if (/^<a(?:\s|>)/iu.test(token)) {
      insideAnchor = true;
      continue;
    }
    if (/^<\/a\s*>/iu.test(token)) {
      insideAnchor = false;
      continue;
    }
    if (!token.startsWith('<') && !insideAnchor && /#\/transactions?\//u.test(token)) {
      throw new Error('Report transaction permalinks must use semantic anchors.');
    }
  }
}

function collectCitedTransactionIds(html: string): readonly string[] {
  const ids = new Set<string>();
  for (const match of html.matchAll(/#\/transaction\/([A-Za-z0-9_%+-]+)/gu)) {
    const id = match[1];
    if (id) {
      ids.add(safeDecodeURIComponent(id));
    }
  }
  return [...ids].toSorted();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function reportSendPolicyAllows(report: ResolvedReportConfig, alertCount: number): boolean {
  return report.send === 'always' || (report.send === 'alerts' && alertCount > 0);
}
