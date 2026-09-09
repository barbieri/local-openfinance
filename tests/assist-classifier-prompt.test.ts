import { describe, expect, it } from 'vitest';
import {
  buildAssistClassifierNotesLeakagePatterns,
  buildAssistClassifierPrompt,
  extractAssistClassifierNotesLeakagePatterns,
  isAssistClassifierPromptNotesLeakage,
  stripAssistClassifierMarkdownLine,
} from '../src/annotation/assist-classifier-prompt.js';
import { buildEmbeddingFeatureText } from '../src/annotation/feature-text.js';

describe('assist classifier prompt leakage patterns', () => {
  it('strips markdown list prefixes before matching', () => {
    expect(stripAssistClassifierMarkdownLine('- Omit notes (null)')).toBe('Omit notes (null)');
  });

  it('derives key=value prefixes and instruction lines from the built prompt', () => {
    const patterns = buildAssistClassifierNotesLeakagePatterns();
    expect(patterns.keyValuePrefixes.has('merchant')).toBe(true);
    expect(patterns.keyValuePrefixes.has('description')).toBe(true);
    expect(patterns.keyValuePrefixes.has('open_finance.category_id')).toBe(true);
    expect(patterns.keyValuePrefixes.has('annotation.notes')).toBe(true);
    expect(patterns.keyValuePrefixes.has('categoryoverrideid')).toBe(true);
    expect(patterns.keyValuePrefixes.has('match_kind')).toBe(true);
    expect(
      patterns.instructionLines.has(
        'notes: null unless durable user context is missing from the target feature text.',
      ),
    ).toBe(true);
    expect(patterns.instructionLines.has('example 1:')).toBe(true);
  });

  it('detects prompt leakage in assist notes using derived patterns', () => {
    const patterns = buildAssistClassifierNotesLeakagePatterns();
    expect(
      isAssistClassifierPromptNotesLeakage(
        'notes: null unless durable user context is missing from the target feature text.',
        patterns,
      ),
    ).toBe(true);
    expect(
      isAssistClassifierPromptNotesLeakage('open_finance.category_id=07003001', patterns),
    ).toBe(true);
    expect(
      isAssistClassifierPromptNotesLeakage('merchant=ACME\ndescription=Payment', patterns),
    ).toBe(true);
    expect(isAssistClassifierPromptNotesLeakage('Example 1:\ntype=transaction', patterns)).toBe(
      true,
    );
    expect(isAssistClassifierPromptNotesLeakage('Monthly streaming subscription', patterns)).toBe(
      false,
    );
  });

  it('includes embedding feature-text keys present in the sample prompt', () => {
    const featureText = buildEmbeddingFeatureText({
      entryType: 'transaction',
      entryId: 'tx',
      occurredAt: '2026-01-15T12:00:00.000Z',
      amountCents: -100,
      currency: 'BRL',
      description: 'Coffee',
      merchantName: 'Cafe',
      categoryId: null,
      categoryName: null,
      parentCategoryId: null,
      parentCategoryName: null,
      accountId: 'acct',
      accountName: 'Checking',
      accountType: 'BANK',
      accountSubtype: 'CHECKING',
      connectionItemId: 'item',
      connectionName: 'Bank',
      rawJson: JSON.stringify({
        creditCardMetadata: { payeeMCC: 5411 },
        paymentData: { payer: { type: 'CPF', value: '12345678901' } },
      }),
    });
    const prompt = buildAssistClassifierPrompt({
      targetFeatureText: featureText,
      currentState: {
        categoryId: null,
        subCategoryId: null,
        labelIds: [],
        labelNames: [],
        notes: null,
      },
      examples: [],
      openFinanceCategories: [],
      categories: [],
      labels: [],
    });
    const patterns = extractAssistClassifierNotesLeakagePatterns(prompt);
    expect(patterns.keyValuePrefixes.has('payee_mcc')).toBe(true);
    expect(patterns.keyValuePrefixes.has('payer_document')).toBe(true);
  });
});
