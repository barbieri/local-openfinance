import { describe, expect, it } from 'vitest';
import {
  formatTransferConfidencePercent,
  linearTransferComponentScore,
  scoreTransferPairComponents,
} from '../src/transfers/score.js';

describe('transfer confidence scoring', () => {
  it('scores amount component linearly up to the configured maximum', () => {
    expect(linearTransferComponentScore(0, 500)).toBe(1);
    expect(linearTransferComponentScore(250, 500)).toBe(0.5);
    expect(linearTransferComponentScore(500, 500)).toBe(0);
    expect(linearTransferComponentScore(501, 500)).toBe(0);
  });

  it('combines amount and time components into the final confidence', () => {
    const score = scoreTransferPairComponents(
      {
        amountCentsLeft: -100_000,
        amountCentsRight: 100_000,
        occurredAtLeft: '2026-06-10T10:00:00.000Z',
        occurredAtRight: '2026-06-10T22:00:00.000Z',
      },
      { maxAmountDiffCents: 500, maxTimeMs: 24 * 60 * 60 * 1000 },
    );

    expect(score.amount).toBe(1);
    expect(score.time).toBe(0.5);
    expect(score.confidence).toBe(0.75);
  });

  it('formats confidence as a percentage', () => {
    expect(formatTransferConfidencePercent(0.756)).toBe('76%');
    expect(formatTransferConfidencePercent(1)).toBe('100%');
  });
});
