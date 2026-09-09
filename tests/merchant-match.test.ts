import { describe, expect, it } from 'vitest';
import { scoreMerchantSimilarity } from '../src/annotation/merchant-match.js';

describe('scoreMerchantSimilarity', () => {
  it('scores exact and normalized merchant matches highly', () => {
    expect(scoreMerchantSimilarity('NETFLIX.COM', null, 'netflix com', null)).toBeGreaterThan(0.9);
    expect(
      scoreMerchantSimilarity('Uber Trip', null, 'Payment to UBER TRIP SA', null),
    ).toBeGreaterThan(0.5);
  });

  it('returns zero when merchant text is missing', () => {
    expect(scoreMerchantSimilarity(null, null, 'Market', 'Groceries')).toBe(0);
  });

  it('uses description as fallback when merchant is empty', () => {
    expect(
      scoreMerchantSimilarity(null, 'Spotify Premium', null, 'spotify premium'),
    ).toBeGreaterThan(0.9);
  });
});
