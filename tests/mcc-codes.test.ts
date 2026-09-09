import { describe, expect, it } from 'vitest';
import { listMccCodes, mccCodesDocumentVersion, resolveMccName } from '../src/data/mcc-codes.js';

describe('mcc codes', () => {
  it('resolves known codes in English and Portuguese', () => {
    expect(resolveMccName(5941, 'en-US')).toBe('Sporting Goods Stores');
    expect(resolveMccName('5941', 'pt-BR')).toBe('Lojas de artigos esportivos');
    expect(resolveMccName('5941', 'pt')).toBe('Lojas de artigos esportivos');
    expect(resolveMccName('5941', 'fr-FR')).toBe('Sporting Goods Stores');
  });

  it('normalizes numeric strings and falls back for unknown codes', () => {
    expect(resolveMccName('41', 'en')).toBe('MCC 0041');
    expect(resolveMccName(null, 'en')).toBeNull();
  });

  it('ships a versioned embedded document', () => {
    const codes = listMccCodes();
    expect(mccCodesDocumentVersion()).toBeGreaterThan(0);
    expect(codes['5941']?.en).toBeTruthy();
    const untranslated = Object.values(codes).filter((entry) => entry.pt === entry.en);
    expect(untranslated).toHaveLength(0);
  });
});
