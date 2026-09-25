export const REPORT_TAXONOMY_KINDS = ['category', 'label'] as const;
export type ReportTaxonomyKind = (typeof REPORT_TAXONOMY_KINDS)[number];

export const TAXONOMY_TREATMENTS = [
  'internal-own-account',
  'portfolio-movement',
  'account-settlement',
  'reportable',
  'uncertain',
] as const;
export type TaxonomyTreatment = (typeof TAXONOMY_TREATMENTS)[number];

export function isReportTaxonomyKind(value: string): value is ReportTaxonomyKind {
  return REPORT_TAXONOMY_KINDS.some((candidate) => candidate === value);
}

export function isTaxonomyTreatment(value: string): value is TaxonomyTreatment {
  return TAXONOMY_TREATMENTS.some((candidate) => candidate === value);
}
