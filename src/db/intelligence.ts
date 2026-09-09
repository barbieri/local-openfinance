import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { allSql, getSql, runSql } from './sqlite-query.js';

export type IntelligenceMemoryUpdatedBy = 'user' | 'report-agent' | 'chat-agent';

export type IntelligenceMemory = {
  readonly markdown: string;
  readonly updatedAt: string;
  readonly updatedBy: IntelligenceMemoryUpdatedBy;
};

export type IntelligenceRunRecord = {
  readonly id: string;
  readonly version: number;
  readonly reportId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly createdAt: string;
  readonly subject: string;
  readonly alertCount: number;
  readonly briefingJson: string;
  readonly markdown: string;
  readonly html: string;
  readonly memoryBefore: string | null;
  readonly memoryAfter: string | null;
  readonly citedTransactionIdsJson: string;
  readonly triggerKind: 'manual' | 'due' | null;
  readonly dueKey: string | null;
  readonly emailDeliveryStartedAt: string | null;
  readonly emailSentAt: string | null;
  readonly modelProvider: string | null;
  readonly modelName: string | null;
  readonly modelCallCount: number;
  readonly modelStepCount: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly modelDurationMs: number;
  readonly unpricedModelCallCount: number;
  readonly estimatedCostMicrousd: number | null;
};

export type IntelligenceRunChart = {
  readonly runId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
};

export type IntelligenceRunModelCall = {
  readonly runId: string;
  readonly ordinal: number;
  readonly provider: string;
  readonly model: string;
  readonly phase: 'taxonomy-policy' | 'analyst' | 'reviewer';
  readonly reviewRound: number | null;
  readonly stepNumber: number | null;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly totalTokens: number | null;
  readonly reasoningEffort: string | null;
  readonly maxOutputTokens: number | null;
  readonly durationMs: number | null;
  readonly finishReason: string | null;
  readonly toolNamesJson: string;
  readonly rawUsageJson: string | null;
  readonly providerMetadataJson: string | null;
  readonly pricingSnapshotJson: string | null;
  readonly estimatedCostMicrousd: number | null;
};

export type IntelligenceTaxonomyPolicyRecord = {
  readonly reportId: string;
  readonly taxonomyHash: string;
  readonly policyJson: string;
  readonly updatedAt: string;
};

export const INTELLIGENCE_MEMORY_SEED = '# Memory';

export function intelligenceMemorySeed(language: string): string {
  return language.toLowerCase().startsWith('pt') ? '# Memória' : INTELLIGENCE_MEMORY_SEED;
}

type MemoryRow = {
  readonly markdown: string;
  readonly updated_at: string;
  readonly updated_by: string;
};

type RunRow = {
  readonly id: string;
  readonly version: number;
  readonly report_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly created_at: string;
  readonly subject: string;
  readonly alert_count: number;
  readonly briefing_json: string;
  readonly markdown: string;
  readonly html: string;
  readonly memory_before: string | null;
  readonly memory_after: string | null;
  readonly cited_transaction_ids_json: string;
  readonly trigger_kind: string | null;
  readonly due_key: string | null;
  readonly email_delivery_started_at: string | null;
  readonly email_sent_at: string | null;
  readonly model_provider: string | null;
  readonly model_name: string | null;
  readonly model_call_count: number;
  readonly model_step_count: number;
  readonly input_tokens: number;
  readonly cached_input_tokens: number;
  readonly output_tokens: number;
  readonly reasoning_tokens: number;
  readonly total_tokens: number;
  readonly model_duration_ms: number;
  readonly unpriced_model_call_count: number;
  readonly estimated_cost_microusd: number | null;
};

function isUpdatedBy(value: string): value is IntelligenceMemoryUpdatedBy {
  return value === 'user' || value === 'report-agent' || value === 'chat-agent';
}

function presentMemory(row: MemoryRow): IntelligenceMemory {
  if (!isUpdatedBy(row.updated_by)) {
    throw new Error(`Invalid intelligence memory updated_by: ${row.updated_by}`);
  }
  return {
    markdown: row.markdown,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function presentRun(row: RunRow): IntelligenceRunRecord {
  if (row.trigger_kind !== null && row.trigger_kind !== 'manual' && row.trigger_kind !== 'due') {
    throw new Error(`Invalid intelligence run trigger_kind: ${row.trigger_kind}`);
  }
  return {
    id: row.id,
    version: row.version,
    reportId: row.report_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at,
    subject: row.subject,
    alertCount: row.alert_count,
    briefingJson: row.briefing_json,
    markdown: row.markdown,
    html: row.html,
    memoryBefore: row.memory_before,
    memoryAfter: row.memory_after,
    citedTransactionIdsJson: row.cited_transaction_ids_json,
    triggerKind: row.trigger_kind,
    dueKey: row.due_key,
    emailDeliveryStartedAt: row.email_delivery_started_at,
    emailSentAt: row.email_sent_at,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    modelCallCount: row.model_call_count,
    modelStepCount: row.model_step_count,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    totalTokens: row.total_tokens,
    modelDurationMs: row.model_duration_ms,
    unpricedModelCallCount: row.unpriced_model_call_count,
    estimatedCostMicrousd: row.estimated_cost_microusd,
  };
}

export function readIntelligenceMemory(
  db: DatabaseSync,
  reportId: string,
  seedMarkdown = INTELLIGENCE_MEMORY_SEED,
): IntelligenceMemory {
  const existing = getSql<MemoryRow>(
    db,
    `SELECT markdown, updated_at, updated_by FROM intelligence_memory WHERE id = ?`,
    reportId,
  );
  return existing
    ? presentMemory(existing)
    : { markdown: seedMarkdown, updatedAt: '', updatedBy: 'user' };
}

export function getIntelligenceMemory(
  db: DatabaseSync,
  reportId: string,
  seedMarkdown = INTELLIGENCE_MEMORY_SEED,
): IntelligenceMemory {
  const memory = readIntelligenceMemory(db, reportId, seedMarkdown);
  if (memory.updatedAt) {
    return memory;
  }

  const updatedAt = new Date().toISOString();
  runSql(
    db,
    `INSERT INTO intelligence_memory (id, markdown, updated_at, updated_by)
     VALUES (?, ?, ?, ?)`,
    reportId,
    seedMarkdown,
    updatedAt,
    'user',
  );
  return {
    markdown: seedMarkdown,
    updatedAt,
    updatedBy: 'user',
  };
}

export function saveIntelligenceMemory(
  db: DatabaseSync,
  reportId: string,
  markdown: string,
  updatedBy: IntelligenceMemoryUpdatedBy,
): IntelligenceMemory {
  const updatedAt = new Date().toISOString();
  runSql(
    db,
    `INSERT INTO intelligence_memory (id, markdown, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       markdown = excluded.markdown,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
    reportId,
    markdown,
    updatedAt,
    updatedBy,
  );
  return { markdown, updatedAt, updatedBy };
}

export function readIntelligenceTaxonomyPolicy(
  db: DatabaseSync,
  reportId: string,
): IntelligenceTaxonomyPolicyRecord | null {
  const row = getSql<{
    readonly report_id: string;
    readonly taxonomy_hash: string;
    readonly policy_json: string;
    readonly updated_at: string;
  }>(
    db,
    `SELECT report_id, taxonomy_hash, policy_json, updated_at
     FROM intelligence_taxonomy_policies WHERE report_id = ?`,
    reportId,
  );
  return row
    ? {
        reportId: row.report_id,
        taxonomyHash: row.taxonomy_hash,
        policyJson: row.policy_json,
        updatedAt: row.updated_at,
      }
    : null;
}

export function saveIntelligenceTaxonomyPolicy(
  db: DatabaseSync,
  input: Omit<IntelligenceTaxonomyPolicyRecord, 'updatedAt'>,
): IntelligenceTaxonomyPolicyRecord {
  const updatedAt = new Date().toISOString();
  runSql(
    db,
    `INSERT INTO intelligence_taxonomy_policies (
       report_id, taxonomy_hash, policy_json, updated_at
     ) VALUES (?, ?, ?, ?)
     ON CONFLICT(report_id) DO UPDATE SET
       taxonomy_hash = excluded.taxonomy_hash,
       policy_json = excluded.policy_json,
       updated_at = excluded.updated_at`,
    input.reportId,
    input.taxonomyHash,
    input.policyJson,
    updatedAt,
  );
  return { ...input, updatedAt };
}

type InsertIntelligenceRunInput = {
  readonly id?: string | undefined;
  readonly reportId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly subject: string;
  readonly alertCount: number;
  readonly briefingJson: string;
  readonly markdown: string;
  readonly html: string;
  readonly memoryBefore?: string | null | undefined;
  readonly memoryAfter?: string | null | undefined;
  readonly citedTransactionIdsJson: string;
  readonly createdAt?: string | undefined;
  readonly triggerKind?: 'manual' | 'due' | null | undefined;
  readonly dueKey?: string | null | undefined;
  readonly modelProvider?: string | undefined;
  readonly modelName?: string | undefined;
  readonly modelCallCount?: number | undefined;
  readonly modelStepCount?: number | undefined;
  readonly inputTokens?: number | undefined;
  readonly cachedInputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly reasoningTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
  readonly modelDurationMs?: number | undefined;
  readonly unpricedModelCallCount?: number | undefined;
  readonly estimatedCostMicrousd?: number | null | undefined;
};

export type ReplaceIntelligenceRunInput = Omit<
  InsertIntelligenceRunInput,
  'id' | 'createdAt' | 'triggerKind' | 'dueKey'
> & {
  readonly id: string;
  readonly expectedVersion: number;
};

export function insertIntelligenceRun(
  db: DatabaseSync,
  input: InsertIntelligenceRunInput,
): IntelligenceRunRecord {
  const state = resolveRunState(input);
  const usage = resolveRunUsage(input);
  runSql(
    db,
    `INSERT INTO intelligence_runs (
       id, report_id, period_start, period_end, created_at, subject, alert_count,
       briefing_json, markdown, html, memory_before, memory_after,
       cited_transaction_ids_json, trigger_kind, due_key, model_provider, model_name,
       model_call_count, model_step_count, input_tokens, cached_input_tokens, output_tokens,
       reasoning_tokens, total_tokens, model_duration_ms, unpriced_model_call_count, estimated_cost_microusd
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    state.id,
    input.reportId,
    input.periodStart,
    input.periodEnd,
    state.createdAt,
    input.subject,
    input.alertCount,
    input.briefingJson,
    input.markdown,
    input.html,
    state.memoryBefore,
    state.memoryAfter,
    input.citedTransactionIdsJson,
    state.triggerKind,
    state.dueKey,
    usage.modelProvider,
    usage.modelName,
    usage.modelCallCount,
    usage.modelStepCount,
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.outputTokens,
    usage.reasoningTokens,
    usage.totalTokens,
    usage.modelDurationMs,
    usage.unpricedModelCallCount,
    usage.estimatedCostMicrousd,
  );
  const row = getSql<RunRow>(db, `SELECT * FROM intelligence_runs WHERE id = ?`, state.id);
  if (!row) {
    throw new Error('Failed to load inserted intelligence run');
  }
  return presentRun(row);
}

export function replaceIntelligenceRun(
  db: DatabaseSync,
  input: ReplaceIntelligenceRunInput,
): IntelligenceRunRecord | null {
  const usage = resolveRunUsage(input);
  const result = runSql(
    db,
    `UPDATE intelligence_runs
     SET subject = ?, alert_count = ?, briefing_json = ?, markdown = ?, html = ?,
         memory_before = ?, memory_after = ?, cited_transaction_ids_json = ?,
         model_provider = ?, model_name = ?, model_call_count = ?, model_step_count = ?,
         input_tokens = ?, cached_input_tokens = ?, output_tokens = ?, reasoning_tokens = ?,
         total_tokens = ?, model_duration_ms = ?, unpriced_model_call_count = ?,
         estimated_cost_microusd = ?, version = version + 1
     WHERE id = ? AND report_id = ? AND period_start = ? AND period_end = ? AND version = ?`,
    input.subject,
    input.alertCount,
    input.briefingJson,
    input.markdown,
    input.html,
    input.memoryBefore ?? null,
    input.memoryAfter ?? null,
    input.citedTransactionIdsJson,
    usage.modelProvider,
    usage.modelName,
    usage.modelCallCount,
    usage.modelStepCount,
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.outputTokens,
    usage.reasoningTokens,
    usage.totalTokens,
    usage.modelDurationMs,
    usage.unpricedModelCallCount,
    usage.estimatedCostMicrousd,
    input.id,
    input.reportId,
    input.periodStart,
    input.periodEnd,
    input.expectedVersion,
  );
  if (result.changes === 0) {
    return null;
  }
  const row = getSql<RunRow>(db, `SELECT * FROM intelligence_runs WHERE id = ?`, input.id);
  if (!row) {
    throw new Error('Failed to load replaced intelligence run');
  }
  return presentRun(row);
}

export function deleteIntelligenceRunModelCalls(db: DatabaseSync, runId: string): void {
  runSql(db, `DELETE FROM intelligence_run_model_calls WHERE run_id = ?`, runId);
}

export function deleteIntelligenceRunCharts(db: DatabaseSync, runId: string): void {
  runSql(db, `DELETE FROM intelligence_run_charts WHERE run_id = ?`, runId);
}

function resolveRunState(input: InsertIntelligenceRunInput) {
  return {
    id: input.id ?? randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    memoryBefore: input.memoryBefore ?? null,
    memoryAfter: input.memoryAfter ?? null,
    triggerKind: input.triggerKind ?? null,
    dueKey: input.dueKey ?? null,
  };
}

function resolveRunUsage(input: InsertIntelligenceRunInput) {
  return {
    modelProvider: input.modelProvider ?? null,
    modelName: input.modelName ?? null,
    modelCallCount: input.modelCallCount ?? 0,
    modelStepCount: input.modelStepCount ?? 0,
    inputTokens: input.inputTokens ?? 0,
    cachedInputTokens: input.cachedInputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    reasoningTokens: input.reasoningTokens ?? 0,
    totalTokens: input.totalTokens ?? 0,
    modelDurationMs: input.modelDurationMs ?? 0,
    unpricedModelCallCount: input.unpricedModelCallCount ?? 0,
    estimatedCostMicrousd: input.estimatedCostMicrousd ?? null,
  };
}

export function getIntelligenceRunByDueKey(
  db: DatabaseSync,
  reportId: string,
  dueKey: string,
): IntelligenceRunRecord | null {
  const row = getSql<RunRow>(
    db,
    `SELECT * FROM intelligence_runs WHERE report_id = ? AND due_key = ?`,
    reportId,
    dueKey,
  );
  return row ? presentRun(row) : null;
}

export function markIntelligenceRunEmailSent(
  db: DatabaseSync,
  runId: string,
  claimToken: string,
  sentAt = new Date().toISOString(),
): IntelligenceRunRecord {
  const result = runSql(
    db,
    `UPDATE intelligence_runs
     SET email_sent_at = ?, email_delivery_started_at = NULL, email_delivery_token = NULL
     WHERE id = ? AND email_sent_at IS NULL AND email_delivery_token = ?`,
    sentAt,
    runId,
    claimToken,
  );
  if (result.changes === 0) {
    throw new Error('Report email delivery claim expired before completion.');
  }
  const row = getSql<RunRow>(db, `SELECT * FROM intelligence_runs WHERE id = ?`, runId);
  if (!row) {
    throw new Error('Failed to load emailed intelligence run');
  }
  return presentRun(row);
}

export function claimIntelligenceRunEmailDelivery(
  db: DatabaseSync,
  runId: string,
  startedAt = new Date().toISOString(),
): string | null {
  const staleBefore = new Date(Date.parse(startedAt) - 15 * 60_000).toISOString();
  const claimToken = randomUUID();
  const result = runSql(
    db,
    `UPDATE intelligence_runs
     SET email_delivery_started_at = ?, email_delivery_token = ?
     WHERE id = ?
       AND email_sent_at IS NULL
       AND (email_delivery_started_at IS NULL OR email_delivery_started_at < ?)`,
    startedAt,
    claimToken,
    runId,
    staleBefore,
  );
  return result.changes > 0 ? claimToken : null;
}

export function releaseIntelligenceRunEmailDelivery(
  db: DatabaseSync,
  runId: string,
  claimToken: string,
): void {
  runSql(
    db,
    `UPDATE intelligence_runs
     SET email_delivery_started_at = NULL, email_delivery_token = NULL
     WHERE id = ? AND email_sent_at IS NULL AND email_delivery_token = ?`,
    runId,
    claimToken,
  );
}

export function listIntelligenceRuns(
  db: DatabaseSync,
  reportId: string,
  limit = 50,
): readonly IntelligenceRunRecord[] {
  const rows = allSql<RunRow>(
    db,
    `SELECT * FROM intelligence_runs WHERE report_id = ? ORDER BY created_at DESC LIMIT ?`,
    reportId,
    limit,
  );
  return rows.map(presentRun);
}

export function getIntelligenceRun(
  db: DatabaseSync,
  reportId: string,
  id: string,
): IntelligenceRunRecord | null {
  const row = getSql<RunRow>(
    db,
    `SELECT * FROM intelligence_runs WHERE report_id = ? AND id = ?`,
    reportId,
    id,
  );
  return row ? presentRun(row) : null;
}

export function saveIntelligenceRunModelCall(
  db: DatabaseSync,
  call: IntelligenceRunModelCall,
): void {
  runSql(
    db,
    `INSERT INTO intelligence_run_model_calls (
       run_id, ordinal, provider, model, phase, review_round, step_number,
       input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens,
       reasoning_effort, max_output_tokens, duration_ms, finish_reason, tool_names_json, raw_usage_json,
       provider_metadata_json, pricing_snapshot_json, estimated_cost_microusd
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    call.runId,
    call.ordinal,
    call.provider,
    call.model,
    call.phase,
    call.reviewRound,
    call.stepNumber,
    call.inputTokens,
    call.cachedInputTokens,
    call.outputTokens,
    call.reasoningTokens,
    call.totalTokens,
    call.reasoningEffort,
    call.maxOutputTokens,
    call.durationMs,
    call.finishReason,
    call.toolNamesJson,
    call.rawUsageJson,
    call.providerMetadataJson,
    call.pricingSnapshotJson,
    call.estimatedCostMicrousd,
  );
}

export function listIntelligenceRunModelCalls(
  db: DatabaseSync,
  runId: string,
): readonly IntelligenceRunModelCall[] {
  return allSql<IntelligenceRunModelCall>(
    db,
    `SELECT run_id AS runId, ordinal, provider, model, phase, review_round AS reviewRound,
       step_number AS stepNumber, input_tokens AS inputTokens,
       cached_input_tokens AS cachedInputTokens, output_tokens AS outputTokens,
       reasoning_tokens AS reasoningTokens, total_tokens AS totalTokens,
       reasoning_effort AS reasoningEffort, max_output_tokens AS maxOutputTokens,
       duration_ms AS durationMs, finish_reason AS finishReason, tool_names_json AS toolNamesJson,
       raw_usage_json AS rawUsageJson,
       provider_metadata_json AS providerMetadataJson,
       pricing_snapshot_json AS pricingSnapshotJson,
       estimated_cost_microusd AS estimatedCostMicrousd
     FROM intelligence_run_model_calls WHERE run_id = ? ORDER BY ordinal`,
    runId,
  );
}

export function saveIntelligenceRunChart(db: DatabaseSync, chart: IntelligenceRunChart): void {
  runSql(
    db,
    `INSERT INTO intelligence_run_charts (run_id, name, mime_type, bytes)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(run_id, name) DO UPDATE SET
       mime_type = excluded.mime_type,
       bytes = excluded.bytes`,
    chart.runId,
    chart.name,
    chart.mimeType,
    chart.bytes,
  );
}

export function listIntelligenceRunChartNames(db: DatabaseSync, runId: string): readonly string[] {
  const rows = allSql<{ readonly name: string }>(
    db,
    `SELECT name FROM intelligence_run_charts WHERE run_id = ? ORDER BY name`,
    runId,
  );
  return rows.map((row) => row.name);
}

export function getIntelligenceRunChart(
  db: DatabaseSync,
  runId: string,
  name: string,
): IntelligenceRunChart | null {
  const row = getSql<{
    readonly run_id: string;
    readonly name: string;
    readonly mime_type: string;
    readonly bytes: Uint8Array;
  }>(
    db,
    `SELECT run_id, name, mime_type, bytes FROM intelligence_run_charts
     WHERE run_id = ? AND name = ?`,
    runId,
    name,
  );
  if (!row) {
    return null;
  }
  return {
    runId: row.run_id,
    name: row.name,
    mimeType: row.mime_type,
    bytes: row.bytes,
  };
}

export function adoptLegacyIntelligenceReport(
  db: DatabaseSync,
  configuredReportIds: readonly string[],
): void {
  if (!configuredReportIds.includes('weekly')) {
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    runSql(
      db,
      `UPDATE intelligence_memory
       SET id = 'weekly'
       WHERE id = 'default'
         AND NOT EXISTS (SELECT 1 FROM intelligence_memory WHERE id = 'weekly')`,
    );
    runSql(db, `UPDATE intelligence_runs SET report_id = 'weekly' WHERE report_id = 'default'`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
