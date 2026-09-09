import {
  buildConfirmedTransactionClassificationSql,
  confirmedAnnotationSql,
  confirmedOverrideSql,
} from './classification-policy.js';

export { isConfirmedTransactionClassification } from './classification-policy.js';

export function classifiedEntryAnnotationSql(annotationAlias: string, labelsAlias: string): string {
  return confirmedAnnotationSql(annotationAlias, labelsAlias);
}

/** For assist neighbor queries that already join `tco` and `ea`. */
export const ASSISTABLE_CLASSIFICATION_WHERE = `(
  ${confirmedOverrideSql('tco')}
  OR ${classifiedEntryAnnotationSql('ea', 'eal')}
)`;

/** Standalone predicate for transaction list filters (no required joins). */
export const TRANSACTION_IS_CLASSIFIED_WHERE = buildConfirmedTransactionClassificationSql();
