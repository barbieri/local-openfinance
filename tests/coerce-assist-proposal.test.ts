import { describe, expect, it } from 'vitest';
import { coerceAssistProposal } from '../src/scoring/providers.js';

describe('coerceAssistProposal', () => {
  it('fills missing label arrays for legacy stored proposals', () => {
    expect(coerceAssistProposal({ labelNames: ['Old'] })).toEqual({
      categoryOverrideId: null,
      categoryId: null,
      subCategoryId: null,
      labelIds: [],
      labelNames: ['Old'],
      notes: null,
      reasoning: null,
    });
  });

  it('returns null for non-objects', () => {
    expect(coerceAssistProposal(null)).toBeNull();
    expect(coerceAssistProposal('{"labelIds":[]}')).toBeNull();
  });
});
