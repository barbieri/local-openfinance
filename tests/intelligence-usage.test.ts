import { describe, expect, it } from 'vitest';
import {
  aggregateReportUsage,
  estimateEmbeddingCostMicrousd,
  estimateLanguageCostMicrousd,
  type ReportModelCall,
} from '../src/intelligence/usage.js';

const pricing = { input: 0.2, cachedInput: 0.02, output: 1.2 } as const;

describe('AI usage cost', () => {
  it('prices cached input and output without charging reasoning twice', () => {
    expect(
      estimateLanguageCostMicrousd(
        {
          inputTokens: 10_000,
          cachedInputTokens: 4_000,
          outputTokens: 2_000,
          reasoningTokens: 1_500,
        },
        pricing,
      ),
    ).toBe(3_680);
  });

  it('leaves language calls unpriced when output usage or a cached rate is missing', () => {
    expect(estimateLanguageCostMicrousd({ inputTokens: 100 }, pricing)).toBeNull();
    expect(
      estimateLanguageCostMicrousd(
        { inputTokens: 100, cachedInputTokens: 50, outputTokens: 10 },
        { input: 0.2, output: 1.2 },
      ),
    ).toBeNull();
  });

  it('prices embeddings from input tokens only', () => {
    expect(estimateEmbeddingCostMicrousd(500, { input: 0.02 })).toBe(10);
    expect(estimateEmbeddingCostMicrousd(null, { input: 0.02 })).toBeNull();
  });

  it('aggregates each provider call once and keeps missing usage visible', () => {
    const calls: readonly ReportModelCall[] = [
      call('taxonomy-policy', { inputTokens: 100, outputTokens: 10, totalTokens: 110 }),
      call('analyst', {
        inputTokens: 200,
        cachedInputTokens: 50,
        outputTokens: 20,
        reasoningTokens: 5,
        totalTokens: 220,
      }),
      call('reviewer', undefined),
    ];

    expect(aggregateReportUsage(calls, pricing)).toEqual({
      callCount: 3,
      stepCount: 2,
      inputTokens: 300,
      cachedInputTokens: 50,
      outputTokens: 30,
      reasoningTokens: 5,
      totalTokens: 330,
      durationMs: 30,
      unpricedCallCount: 1,
      estimatedCostMicrousd: null,
    });
  });
});

function call(phase: ReportModelCall['phase'], usage: ReportModelCall['usage']): ReportModelCall {
  return {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    phase,
    reviewRound: phase === 'reviewer' ? 1 : null,
    stepNumber: phase === 'taxonomy-policy' ? null : 0,
    usage,
    durationMs: 10,
    reasoningEffort: 'low',
    maxOutputTokens: 8_000,
    toolNames: [],
  };
}
