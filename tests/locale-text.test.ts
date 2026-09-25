import { describe, expect, it } from 'vitest';
import enUS from '../src/locales/en-US.json' with { type: 'json' };
import ptBR from '../src/locales/pt-BR.json' with { type: 'json' };
import { localText } from '../src/utils/locale-text.js';

describe('localText', () => {
  it('uses the requested Portuguese catalog', () => {
    expect(localText('pt-BR', 'reports.chart.legend.income')).toBe('Receitas');
  });

  it('falls back to English for unsupported locales', () => {
    expect(localText('fr-FR', 'reports.chart.legend.income')).toBe('Income');
  });

  it('keeps the locale catalogs on the same key set', () => {
    expect(Object.keys(ptBR).toSorted()).toEqual(Object.keys(enUS).toSorted());
  });
});
