import { describe, expect, it } from 'vitest';
import { matchesTaxonomyDecisionFilter } from '../src/web/client/lib/report-taxonomy-filter.js';

const decision = {
  treatment: 'reportable' as const,
  kind: 'category' as const,
  path: 'Alimentação > Refeições',
};

describe('matchesTaxonomyDecisionFilter', () => {
  it('matches paths without case or diacritic sensitivity', () => {
    expect(
      matchesTaxonomyDecisionFilter(decision, {
        treatment: 'all',
        kind: 'all',
        search: 'ALIMENTACAO > refeicoes',
      }),
    ).toBe(true);
  });

  it('filters by effective treatment and kind', () => {
    expect(
      matchesTaxonomyDecisionFilter(decision, {
        treatment: 'reportable',
        kind: 'category',
        search: '',
      }),
    ).toBe(true);
    expect(
      matchesTaxonomyDecisionFilter(decision, {
        treatment: 'uncertain',
        kind: 'category',
        search: '',
      }),
    ).toBe(false);
    expect(
      matchesTaxonomyDecisionFilter(decision, {
        treatment: 'reportable',
        kind: 'label',
        search: '',
      }),
    ).toBe(false);
  });
});
