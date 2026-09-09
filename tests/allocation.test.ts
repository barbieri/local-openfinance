import { describe, expect, it } from 'vitest';
import { computeAllocationPercents } from '../src/web/client/lib/allocation.js';

describe('computeAllocationPercents', () => {
  it('returns fractions that sum to one for visible rows', () => {
    const rows = [{ balance_cents: 750_000 }, { balance_cents: 250_000 }];
    const percents = computeAllocationPercents(rows, 'balance_cents');

    expect(percents.get(0)).toBeCloseTo(0.75);
    expect(percents.get(1)).toBeCloseTo(0.25);
    expect([...percents.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it('uses absolute values so mixed signs still allocate against total exposure', () => {
    const rows = [{ balance_cents: 100_000 }, { balance_cents: -100_000 }];
    const percents = computeAllocationPercents(rows, 'balance_cents');

    expect(percents.get(0)).toBeCloseTo(0.5);
    expect(percents.get(1)).toBeCloseTo(0.5);
  });
});
