import {
  isReportTaxonomyKind,
  isTaxonomyTreatment,
  type ReportTaxonomyKind,
  type TaxonomyTreatment,
} from '../../../intelligence/taxonomy-treatment.js';

export type { TaxonomyTreatment } from '../../../intelligence/taxonomy-treatment.js';
export type TaxonomyKind = ReportTaxonomyKind;

export type TaxonomyDecisionFilter = {
  readonly treatment: TaxonomyTreatment | 'all';
  readonly kind: TaxonomyKind | 'all';
  readonly search: string;
};

export function parseTaxonomyTreatmentFilter(
  value: string,
): TaxonomyDecisionFilter['treatment'] | null {
  return value === 'all' || isTaxonomyTreatment(value) ? value : null;
}

export function parseTaxonomyKindFilter(value: string): TaxonomyDecisionFilter['kind'] | null {
  return value === 'all' || isReportTaxonomyKind(value) ? value : null;
}

type FilterableTaxonomyDecision = {
  readonly treatment: TaxonomyTreatment;
  readonly kind: TaxonomyKind;
  readonly path: string;
};

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

export function matchesTaxonomyDecisionFilter(
  decision: FilterableTaxonomyDecision,
  filter: TaxonomyDecisionFilter,
): boolean {
  if (filter.treatment !== 'all' && decision.treatment !== filter.treatment) return false;
  if (filter.kind !== 'all' && decision.kind !== filter.kind) return false;
  return normalizeSearchText(decision.path).includes(normalizeSearchText(filter.search.trim()));
}
