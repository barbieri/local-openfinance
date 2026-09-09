import { describe, expect, it } from 'vitest';
import { buildTransactionFtsMatch, combineFtsMatches } from '../src/db/transaction-fts.js';

describe('transaction fts query builder', () => {
  it('tokenizes multi-word queries with AND prefix matching', () => {
    expect(buildTransactionFtsMatch('pix enviado')).toBe('"pix"* AND "enviado"*');
  });

  it('scopes merchant and description columns', () => {
    expect(buildTransactionFtsMatch('netflix', 'merchant_name')).toBe(
      'merchant_name : ("netflix"*)',
    );
    expect(buildTransactionFtsMatch('rent', 'description')).toBe('description : ("rent"*)');
  });

  it('combines multiple fts clauses with AND', () => {
    expect(
      combineFtsMatches([
        buildTransactionFtsMatch('uber', 'merchant_name'),
        buildTransactionFtsMatch('trip', 'description'),
      ]),
    ).toBe('merchant_name : ("uber"*) AND description : ("trip"*)');
  });
});
