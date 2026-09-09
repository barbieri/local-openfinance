import { describe, expect, it } from 'vitest';
import {
  enrichAssistProposal,
  isNotesRedundantWithTransaction,
  rankAssistPromptLabels,
  resolveOpenFinanceCategoryId,
  resolveSuggestedCategoryOverrideId,
  sanitizeAssistNotes,
} from '../src/annotation/assist-proposal.js';

const categories = [
  { id: '07003000', name: 'Utilities', path: 'Utilities' },
  { id: '07003001', name: 'Electricity', path: 'Utilities > Electricity' },
] as const;

describe('assist proposal helpers', () => {
  it('resolves open finance categories by id, name, or path segment', () => {
    expect(resolveOpenFinanceCategoryId('07003001', categories)).toBe('07003001');
    expect(resolveOpenFinanceCategoryId('Electricity', categories)).toBe('07003001');
    expect(resolveOpenFinanceCategoryId('Utilities > Electricity', categories)).toBe('07003001');
  });

  it('suggests category override from ranked examples', () => {
    expect(
      resolveSuggestedCategoryOverrideId('07003000', [
        { categoryOverrideId: '07003001', effectiveCategoryId: '07003001' },
      ]),
    ).toBe('07003001');
    expect(
      resolveSuggestedCategoryOverrideId('07003000', [
        { categoryOverrideId: null, effectiveCategoryId: '07003001' },
      ]),
    ).toBe('07003001');
  });

  it('drops date-only assist notes', () => {
    expect(sanitizeAssistNotes('2026-03-10')).toBeNull();
    expect(sanitizeAssistNotes('Monthly streaming')).toBe('Monthly streaming');
  });

  it('drops classifier prompt leakage in assist notes', () => {
    expect(sanitizeAssistNotes('null')).toBeNull();
    expect(sanitizeAssistNotes('NULL')).toBeNull();
    expect(
      sanitizeAssistNotes(
        'notes: null unless durable user context is missing from the target feature text.',
      ),
    ).toBeNull();
    expect(sanitizeAssistNotes('open_finance.category_id=07003001')).toBeNull();
    expect(sanitizeAssistNotes('annotation.notes=Monthly streaming')).toBeNull();
    expect(sanitizeAssistNotes('merchant=ACME\ndescription=Payment')).toBeNull();
    expect(sanitizeAssistNotes('Example 1:\ntype=transaction')).toBeNull();
  });

  it('drops notes that fuzzy-match the transaction description or merchant', () => {
    const context = {
      description: 'PIX ENVIADO - Joao Silva',
      merchantName: 'Joao Silva',
    };
    expect(isNotesRedundantWithTransaction('PIX ENVIADO - Joao Silva', context)).toBe(true);
    expect(isNotesRedundantWithTransaction('pix enviado joao silva', context)).toBe(true);
    expect(isNotesRedundantWithTransaction('Joao Silva', context)).toBe(true);
    expect(sanitizeAssistNotes('PIX ENVIADO - Joao Silva', context)).toBeNull();
    expect(sanitizeAssistNotes('Monthly rent split with roommate', context)).toBe(
      'Monthly rent split with roommate',
    );
  });

  it('drops notes copied from a dissimilar example transaction', () => {
    const context = {
      description: 'TED RECEBIDA - Empresa XYZ',
      merchantName: 'Empresa XYZ',
    };
    const examples = [
      {
        categoryOverrideId: null,
        effectiveCategoryId: null,
        notes: 'withdraw some FIXED INCOME',
        merchantName: 'Broker ABC',
        description: 'Resgate FIXED INCOME',
      },
    ];
    expect(sanitizeAssistNotes('withdraw some FIXED INCOME', context, examples)).toBeNull();
  });

  it('keeps notes copied from a very similar example transaction', () => {
    const context = {
      description: 'Resgate FIXED INCOME fundo X',
      merchantName: 'Broker ABC',
    };
    const examples = [
      {
        categoryOverrideId: null,
        effectiveCategoryId: null,
        notes: 'withdraw some FIXED INCOME',
        merchantName: 'Broker ABC',
        description: 'Resgate FIXED INCOME fundo Y',
      },
    ];
    expect(sanitizeAssistNotes('withdraw some FIXED INCOME', context, examples)).toBe(
      'withdraw some FIXED INCOME',
    );
  });

  it('ranks prompt labels from similar examples', () => {
    const ranked = rankAssistPromptLabels(
      [{ labelIds: ['travel', 'food'] }, { labelIds: ['food', 'home'] }],
      [
        { id: 'travel', name: 'Travel' },
        { id: 'food', name: 'Food' },
        { id: 'home', name: 'Home' },
        { id: 'other', name: 'Other' },
      ],
    );
    expect(ranked.map((item) => item.id)).toEqual(['food', 'travel', 'home']);
  });

  it('limits enriched proposal labels to three', () => {
    expect(
      enrichAssistProposal(
        {
          categoryOverrideId: null,
          categoryId: null,
          subCategoryId: null,
          labelIds: ['a', 'b', 'c', 'd'],
          labelNames: ['A', 'B', 'C', 'D'],
          notes: null,
          reasoning: null,
        },
        [],
        null,
      ).labelIds,
    ).toEqual(['a', 'b', 'c']);
  });

  it('fills missing category override on partial classifier proposals', () => {
    expect(
      enrichAssistProposal(
        {
          categoryOverrideId: null,
          categoryId: null,
          subCategoryId: null,
          labelIds: [],
          labelNames: ['Home'],
          notes: '2026-03-10',
          reasoning: null,
        },
        [{ categoryOverrideId: '07003001', effectiveCategoryId: '07003001', notes: null }],
        '07003000',
      ),
    ).toEqual({
      categoryOverrideId: '07003001',
      categoryId: null,
      subCategoryId: null,
      labelIds: [],
      labelNames: ['Home'],
      notes: null,
      reasoning: null,
    });
  });
});
