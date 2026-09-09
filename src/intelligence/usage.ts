import type { ModelUsage } from '../llm/generate.js';
import type { ModelPricing } from '../types.js';

export type ReportModelCallPhase = 'taxonomy-policy' | 'analyst' | 'reviewer';

export type ReportModelCall = {
  readonly provider: string;
  readonly model: string;
  readonly phase: ReportModelCallPhase;
  readonly reviewRound: number | null;
  readonly stepNumber: number | null;
  readonly usage?: ModelUsage | undefined;
  readonly durationMs: number | null;
  readonly reasoningEffort?: string | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly finishReason?: string | undefined;
  readonly toolNames: readonly string[];
  readonly providerMetadata?: unknown;
};

export type ReportUsageMetrics = {
  readonly callCount: number;
  readonly stepCount: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly durationMs: number;
  readonly unpricedCallCount: number;
  readonly estimatedCostMicrousd: number | null;
};

export function estimateLanguageCostMicrousd(
  usage: ModelUsage | undefined,
  pricing: ModelPricing | undefined,
): number | null {
  if (
    !usage ||
    !pricing ||
    usage.inputTokens === undefined ||
    usage.outputTokens === undefined ||
    pricing.output === undefined
  ) {
    return null;
  }
  const cached = usage.cachedInputTokens ?? 0;
  if (cached > 0 && pricing.cachedInput === undefined) return null;
  const uncached = Math.max(usage.inputTokens - cached, 0);
  return Math.round(
    uncached * pricing.input +
      cached * (pricing.cachedInput ?? 0) +
      usage.outputTokens * pricing.output,
  );
}

export function estimateEmbeddingCostMicrousd(
  inputTokens: number | null,
  pricing: ModelPricing | undefined,
): number | null {
  if (inputTokens === null || !pricing) return null;
  return Math.round(inputTokens * pricing.input);
}

export function aggregateReportUsage(
  calls: readonly ReportModelCall[],
  pricing: ModelPricing | undefined,
): ReportUsageMetrics {
  const priced = calls.map((call) => estimateLanguageCostMicrousd(call.usage, pricing));
  const sum = (select: (usage: ModelUsage) => number | undefined) =>
    calls.reduce((total, call) => total + (call.usage ? (select(call.usage) ?? 0) : 0), 0);
  return {
    callCount: calls.length,
    stepCount: calls.filter((call) => call.phase !== 'taxonomy-policy').length,
    inputTokens: sum((usage) => usage.inputTokens),
    cachedInputTokens: sum((usage) => usage.cachedInputTokens),
    outputTokens: sum((usage) => usage.outputTokens),
    reasoningTokens: sum((usage) => usage.reasoningTokens),
    totalTokens: sum((usage) => usage.totalTokens),
    durationMs: calls.reduce((total, call) => total + (call.durationMs ?? 0), 0),
    unpricedCallCount: priced.filter((cost) => cost === null).length,
    estimatedCostMicrousd:
      calls.length === 0 || priced.some((cost) => cost === null)
        ? null
        : priced.reduce<number>((total, cost) => total + (cost ?? 0), 0),
  };
}
