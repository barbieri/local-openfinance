import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  type IntelligenceMemory,
  intelligenceMemorySeed,
  readIntelligenceMemory,
  saveIntelligenceMemory,
} from '../db/intelligence.js';
import { TRANSACTION_CREDIT_PURCHASE_DATE_SQL } from '../db/transaction-query.js';
import type { ModelUsage } from '../llm/generate.js';
import type { ModelConfig, ResolvedConfig } from '../types.js';
import { toLocalDateKey } from '../utils/local-date.js';
import { generateMemoryFromEvidence } from './memory-generator.js';
import {
  type BoundedMemoryEvidence,
  buildMemoryRebuildEvidence,
  type MemoryRebuildEvidenceStats,
} from './memory-rebuild-evidence.js';
import { addDaysToLocalDateKey, shiftLocalDateKeyMonths } from './period.js';
import { buildReportAnalysis } from './report-analysis.js';
import { compactReportMemoryMarkdown } from './report-document.js';
import { resolveReportQueryScope } from './report-scope.js';
import { resolveReportTaxonomyPolicyWithUsage } from './report-taxonomy-policy.js';

const memoryMarkdownSchema = z.string().trim().min(1).max(50_000);

export type RebuildMemoryQuantity = number | 'all';

export type RebuildReportMemoryInput = {
  readonly db: DatabaseSync;
  readonly resolved: ResolvedConfig;
  readonly reportId: string;
  readonly quantity: RebuildMemoryQuantity;
  readonly now?: Date | undefined;
  readonly timeZone: string;
};

export type MemoryGenerationInput = {
  readonly reportId: string;
  readonly language: string;
  readonly model: ModelConfig;
  readonly evidence: BoundedMemoryEvidence;
};

export type GeneratedMemory = {
  readonly memoryMarkdown: string;
  readonly usage?: ModelUsage | undefined;
};

export type GenerateMemory = (input: MemoryGenerationInput) => Promise<GeneratedMemory>;
type ResolveTaxonomyPolicy = typeof resolveReportTaxonomyPolicyWithUsage;

export type RebuildMemoryResult = {
  readonly reportId: string;
  readonly model: Pick<ModelConfig, 'provider' | 'model'>;
  readonly periods: number;
  readonly firstPeriod: { readonly start: string; readonly end: string } | null;
  readonly lastPeriod: { readonly start: string; readonly end: string } | null;
  readonly evidence: MemoryRebuildEvidenceStats;
  readonly providerCalls: 0 | 1 | 2;
  readonly taxonomyPolicy: {
    readonly source: 'empty' | 'cache' | 'generated';
    readonly calls: 0 | 1;
    readonly usage?: ModelUsage | undefined;
  };
  readonly memoryGeneration: {
    readonly calls: 0 | 1;
    readonly usage?: ModelUsage | undefined;
  };
  readonly markdown: string;
};

export type RebuildReportMemory = (input: RebuildReportMemoryInput) => Promise<RebuildMemoryResult>;

export class ReportMemoryConflictError extends Error {}

export function createReportMemoryRebuilder(dependencies: {
  readonly generateMemory: GenerateMemory;
  readonly resolveTaxonomyPolicy?: ResolveTaxonomyPolicy | undefined;
}): RebuildReportMemory {
  return async (input) => {
    const currentScope = resolveReportQueryScope(input.resolved, input.reportId, {
      now: input.now,
      timeZone: input.timeZone,
    });
    const language = currentScope.report.language;
    const memorySeed = intelligenceMemorySeed(language);
    const memoryBefore = readIntelligenceMemory(input.db, input.reportId, memorySeed);
    const earliest = readEarliestTransactionDate(input.db, input.timeZone);
    const periods = earliest
      ? resolveRebuildMemoryPeriods(
          currentScope.period,
          currentScope.report.window.kind,
          earliest,
          input.quantity,
        )
      : [];
    const taxonomyPolicy = await (
      dependencies.resolveTaxonomyPolicy ?? resolveReportTaxonomyPolicyWithUsage
    )({
      db: input.db,
      scope: currentScope,
      persist: true,
    });
    const analyses = periods.map((period) => {
      const scope = resolveReportQueryScope(input.resolved, input.reportId, {
        timeZone: input.timeZone,
        period,
      });
      return buildReportAnalysis({
        db: input.db,
        resolved: input.resolved,
        scope,
        policy: taxonomyPolicy.policy,
      });
    });
    const evidence = buildMemoryRebuildEvidence(analyses);
    let calls: 0 | 1 = 0;
    let usage: ModelUsage | undefined;
    let markdown = memorySeed;
    if (evidence.stats.includedCandidates > 0) {
      const generated = await dependencies.generateMemory({
        reportId: input.reportId,
        language,
        model: currentScope.report.model,
        evidence,
      });
      calls = 1;
      usage = generated.usage;
      markdown = compactReportMemoryMarkdown(
        memoryMarkdownSchema.parse(generated.memoryMarkdown),
        language,
      );
    }
    saveMemoryIfUnchanged(input.db, input.reportId, memoryBefore, memorySeed, markdown);
    const providerCalls = taxonomyPolicy.generation.calls === 1 ? (calls === 1 ? 2 : 1) : calls;
    return {
      reportId: input.reportId,
      model: {
        provider: currentScope.report.model.provider,
        model: currentScope.report.model.model,
      },
      periods: periods.length,
      firstPeriod: periods[0] ?? null,
      lastPeriod: periods.at(-1) ?? null,
      evidence: evidence.stats,
      providerCalls,
      taxonomyPolicy: {
        source: taxonomyPolicy.source,
        ...taxonomyPolicy.generation,
      },
      memoryGeneration: { calls, ...(usage ? { usage } : {}) },
      markdown,
    };
  };
}

export const rebuildReportMemory: RebuildReportMemory = createReportMemoryRebuilder({
  generateMemory: generateMemoryFromEvidence,
});

export function parseRebuildMemoryQuantity(value: string): RebuildMemoryQuantity {
  if (value === 'all') return 'all';
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('--quantity must be "all" or a positive integer.');
  }
  return parsed;
}

function readEarliestTransactionDate(db: DatabaseSync, timeZone: string): string | null {
  const row = db
    .prepare(
      `SELECT MIN(${TRANSACTION_CREDIT_PURCHASE_DATE_SQL}) AS occurred_at FROM transactions t`,
    )
    .get() as { readonly occurred_at?: unknown };
  return typeof row.occurred_at === 'string' ? toLocalDateKey(row.occurred_at, timeZone) : null;
}

function saveMemoryIfUnchanged(
  db: DatabaseSync,
  reportId: string,
  memoryBefore: IntelligenceMemory,
  memorySeed: string,
  markdown: string,
): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = readIntelligenceMemory(db, reportId, memorySeed);
    if (!sameMemory(current, memoryBefore)) {
      throw new ReportMemoryConflictError(
        `Report ${reportId} memory changed while rebuilding was in progress.`,
      );
    }
    saveIntelligenceMemory(db, reportId, markdown, 'report-agent');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function sameMemory(left: IntelligenceMemory, right: IntelligenceMemory): boolean {
  return (
    left.markdown === right.markdown &&
    left.updatedAt === right.updatedAt &&
    left.updatedBy === right.updatedBy
  );
}

export function resolveRebuildMemoryPeriods(
  current: { readonly start: string; readonly end: string },
  kind: 'last-complete-day' | 'last-complete-week' | 'last-complete-month',
  earliest: string,
  quantity: RebuildMemoryQuantity,
): readonly { readonly start: string; readonly end: string }[] {
  const periods: { start: string; end: string }[] = [];
  let cursor = current;
  while (cursor.end >= earliest) {
    periods.push(cursor);
    if (quantity !== 'all' && periods.length >= quantity) break;
    cursor = previousPeriod(cursor, kind);
  }
  return periods.reverse();
}

function previousPeriod(
  period: { readonly start: string; readonly end: string },
  kind: 'last-complete-day' | 'last-complete-week' | 'last-complete-month',
): { readonly start: string; readonly end: string } {
  if (kind === 'last-complete-month') {
    const start = shiftLocalDateKeyMonths(period.start, -1);
    return { start, end: addDaysToLocalDateKey(period.start, -1) };
  }
  const days = kind === 'last-complete-day' ? 1 : 7;
  return {
    start: addDaysToLocalDateKey(period.start, -days),
    end: addDaysToLocalDateKey(period.end, -days),
  };
}
